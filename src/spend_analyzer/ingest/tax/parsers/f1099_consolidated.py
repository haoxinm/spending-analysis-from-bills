"""Consolidated 1099 (broker "Tax Information" document) parser, id ``tax_1099_consolidated``.

One document carries several sections (``1099-INT``, ``1099-DIV``, ``1099-B``, optionally
``1099-MISC``) behind a ``Form 1099 Summary``; software layout, label and value on one row. Each
account (a row starting ``Account number``) yields ONE `ParsedTaxForm` with
``form_type="1099-consolidated"``, ``account_last4`` set, and the union of its sections' items,
each keeping its own ``source_form``. Payer name and TIN (last four) are read per account: the
nearest payer row at or before the account row (else the first one inside the account block), so a
file holding several payers' statements keeps each identity. An account none of whose sections
yielded an amount is not emitted (an empty form has no identity and no value). Section headings are matched without the word "Form" (``1099-DIV  Dividends ...``) so
the single-form parsers, which key on ``Form 1099-XXX``, stay quiet. Unsupported sections
(for example ``1099-OID``) are skipped with a warning.

Detection (plan 2.4): at least two distinct 1099 section headings plus a consolidated/summary
marker scores 0.95; a single section behind that marker also 0.95; two sections without a marker
0.6; otherwise 0.0.
"""

from __future__ import annotations

import re

from spend_analyzer.core.errors import ParserError
from spend_analyzer.core.tax_types import (
    FormType,
    ParsedIncomeItem,
    ParsedTaxDocument,
    ParsedTaxForm,
    ParsedTaxItem,
)
from spend_analyzer.core.types import ExtractedDoc
from spend_analyzer.ingest.layout import cluster_rows
from spend_analyzer.ingest.tax.common import (
    build_document,
    distinct_1099_sections,
    require_year,
    sanitize_payer_name,
)
from spend_analyzer.ingest.tax.fields import (
    compile_label,
    corrected_marker,
    split_blocks,
    text_for_label,
)
from spend_analyzer.ingest.tax.parsers._boxes import payer_from_row
from spend_analyzer.ingest.tax.parsers._consolidated_sections import (
    SectionResult,
    parse_consolidated_div,
    parse_consolidated_int,
    parse_consolidated_misc,
)
from spend_analyzer.ingest.tax.parsers.f1099_b import parse_b_section
from spend_analyzer.ingest.tax.tin import mask_tin

_MARKER_RE = re.compile(
    r"Consolidated\s+Form\s+1099|Form\s+1099\s+Summary|1099\s+Composite|Tax\s+Information",
    re.IGNORECASE,
)
_SECTION_START = re.compile(r"^\s*(?:Form\s+)?1099-([A-Z]{1,4})\b")
_ACCOUNT_START = compile_label(r"^Account\s+(?:number\b|no\b\.?|#)")
_ACCOUNT_RE = compile_label(r"^Account\s+(?:number\b|no\b\.?|#)\s*:?")
_NOT_A_NAME = re.compile(
    r"\d|\bForm\b|\b1099\b|\bTax\b|\bSummary\b|\bInformation\b|\bStatement\b|\bYear\b",
    re.IGNORECASE,
)
_HEADER_INFERRED_WARNING = "Payer name was inferred from the page header."
_NO_AMOUNTS_MESSAGE = "No amounts could be read from the 1099 sections in this file."
_RETURN_RE = re.compile(r"U\.S\.\s+Individual\s+Income\s+Tax\s+Return", re.IGNORECASE)


def _section_kind(block: ExtractedDoc) -> str | None:
    for page in block.pages:
        for row in cluster_rows(page.words):
            match = _SECTION_START.match(row.text)
            return match.group(1) if match else None
    return None


def _payers_per_account(doc: ExtractedDoc, n_accounts: int) -> list[tuple[str | None, str | None]]:
    """``(payer name, payer TIN last4)`` for each account block, in order (one entry when the
    document has no account rows). Each account takes the nearest payer rows at or before its
    account row; when none precede it, the first payer rows found inside its own block."""
    snapshots: list[tuple[str | None, str | None]] = []
    inside: list[list[str | None]] = []  # first name / tin seen after each account row
    name: str | None = None
    tin: str | None = None
    first: list[str | None] = [None, None]  # first name / tin in the whole document
    for page in doc.pages:
        for row in cluster_rows(page.words):
            if n_accounts and _ACCOUNT_START.search(row.text):
                snapshots.append((name, tin))
                inside.append([None, None])
                continue
            row_name, row_tin = payer_from_row(row.text)
            if row_name is not None:
                name = sanitize_payer_name(row_name)
                if first[0] is None:
                    first[0] = name
                if inside and inside[-1][0] is None:
                    inside[-1][0] = name
            if row_tin is not None:
                tin = row_tin
                if first[1] is None:
                    first[1] = tin
                if inside and inside[-1][1] is None:
                    inside[-1][1] = tin
    if not n_accounts:
        return [(first[0], first[1])]
    return [
        (snap[0] or after[0], snap[1] or after[1])
        for snap, after in zip(snapshots, inside, strict=True)
    ]


def _header_payer_name(doc: ExtractedDoc) -> str | None:
    """The first non-empty line of page 1 when it looks like a company name (letters, no digits,
    not a form title); `None` otherwise."""
    if not doc.pages:
        return None
    for row in cluster_rows(doc.pages[0].words):
        text = row.text.strip()
        if not text:
            continue
        if _NOT_A_NAME.search(text) or _MARKER_RE.search(text) or not re.search(r"[A-Za-z]", text):
            return None
        return sanitize_payer_name(text)
    return None


class Form1099ConsolidatedParser:
    """Consolidated broker 1099 (INT / DIV / B / MISC sections)."""

    id = "tax_1099_consolidated"
    version = "1"
    form_types: tuple[FormType, ...] = ("1099-consolidated",)

    def detect(self, doc: ExtractedDoc) -> float:
        text = doc.full_text
        if _RETURN_RE.search(text):
            return 0.0
        sections = distinct_1099_sections(doc)
        marker = _MARKER_RE.search(text) is not None
        if sections and marker:
            return 0.95
        if len(sections) >= 2:
            return 0.6
        return 0.0

    def parse(self, doc: ExtractedDoc, *, tax_year: int | None = None) -> ParsedTaxDocument:
        year = require_year(doc, tax_year)
        corrected = corrected_marker(doc)
        accounts = split_blocks(doc, _ACCOUNT_START)
        payers = _payers_per_account(doc, len(accounts))
        header_name = _header_payer_name(doc)
        forms: list[ParsedTaxForm] = []
        found_sections = False
        for account, (name, tin) in zip(accounts or (doc,), payers, strict=True):
            form, had_sections = self._parse_account(
                account, year, name, tin, corrected, header_name
            )
            found_sections = found_sections or had_sections
            if form is not None:
                forms.append(form)
        if not forms:
            if found_sections:
                raise ParserError(_NO_AMOUNTS_MESSAGE)
            raise ParserError("No 1099 sections were found in this file.")
        return build_document(forms)

    def _parse_account(
        self,
        account: ExtractedDoc,
        year: int,
        payer: str | None,
        payer_tin: str | None,
        corrected: bool,
        header_name: str | None = None,
    ) -> tuple[ParsedTaxForm | None, bool]:
        """The account's form (None when no section yielded an amount) and whether the account
        had any section at all."""
        income: list[ParsedIncomeItem] = []
        taxes: list[ParsedTaxItem] = []
        warnings: list[str] = []
        sections = split_blocks(account, _SECTION_START)
        if not sections:
            return None, False
        for block in sections:
            kind = _section_kind(block)
            result: SectionResult
            if kind == "INT":
                result = parse_consolidated_int(block)
            elif kind == "DIV":
                result = parse_consolidated_div(block)
            elif kind == "MISC":
                result = parse_consolidated_misc(block)
            elif kind == "B":
                try:
                    form = parse_b_section(block, year)
                except ParserError:
                    warnings.append("The 1099-B section contained no readable totals.")
                    continue
                result = SectionResult(form.income, form.taxes, form.warnings)
            else:
                warnings.append(f"A 1099-{kind} section is not supported and was skipped.")
                continue
            if not result.found_any:
                warnings.append(f"The 1099-{kind} section contained no recognizable amounts.")
            income.extend(result.income)
            taxes.extend(result.taxes)
            warnings.extend(result.warnings)
        if not income and not taxes:
            return None, True  # no amounts anywhere: an empty form has no identity or value
        if payer is None and header_name is not None:
            payer = header_name
            warnings.append(_HEADER_INFERRED_WARNING)
        account_last4 = mask_tin(text_for_label(account, _ACCOUNT_RE, mode="same_row"))
        form_type: FormType = "1099-consolidated"
        form = ParsedTaxForm(
            form_type=form_type,
            tax_year=year,
            payer_name=payer,
            payer_tin_last4=payer_tin,
            account_last4=account_last4,
            is_corrected=corrected,
            filing_status=None,
            agi_minor=None,
            taxable_income_minor=None,
            income=tuple(income),
            taxes=tuple(taxes),
            warnings=tuple(dict.fromkeys(warnings)),
        )
        return form, True


PARSER = Form1099ConsolidatedParser()

__all__ = ["PARSER", "Form1099ConsolidatedParser"]
