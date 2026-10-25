"""Consolidated 1099 (broker "Tax Information" document) parser, id ``tax_1099_consolidated``.

One document carries several sections (``1099-INT``, ``1099-DIV``, ``1099-B``, optionally
``1099-MISC``) behind a ``Form 1099 Summary``; software layout, label and value on one row. Each
account (a row starting ``Account number``) yields ONE `ParsedTaxForm` with
``form_type="1099-consolidated"``, ``account_last4`` set, and the union of its sections' items,
each keeping its own ``source_form``. Payer name and TIN (last four) are read once for the whole
document. Section headings are matched without the word "Form" (``1099-DIV  Dividends ...``) so
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
_ACCOUNT_START = compile_label(r"^Account\s+number\b")
_PAYER_NAME_RE = compile_label(r"^Payer(?:'s)?\s+name\b:?")
_PAYER_TIN_RE = compile_label(r"^Payer(?:'s)?\s+TIN\b:?")
_ACCOUNT_RE = compile_label(r"^Account\s+number\b:?")
_RETURN_RE = re.compile(r"U\.S\.\s+Individual\s+Income\s+Tax\s+Return", re.IGNORECASE)


def _section_kind(block: ExtractedDoc) -> str | None:
    for page in block.pages:
        for row in cluster_rows(page.words):
            match = _SECTION_START.match(row.text)
            return match.group(1) if match else None
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
        payer = sanitize_payer_name(text_for_label(doc, _PAYER_NAME_RE, mode="same_row"))
        payer_tin = mask_tin(text_for_label(doc, _PAYER_TIN_RE, mode="same_row"))
        corrected = corrected_marker(doc)
        forms: list[ParsedTaxForm] = []
        for account in split_blocks(doc, _ACCOUNT_START) or (doc,):
            form = self._parse_account(account, year, payer, payer_tin, corrected)
            if form is not None:
                forms.append(form)
        if not forms:
            raise ParserError("No 1099 sections were found in this file.")
        return build_document(forms)

    def _parse_account(
        self,
        account: ExtractedDoc,
        year: int,
        payer: str | None,
        payer_tin: str | None,
        corrected: bool,
    ) -> ParsedTaxForm | None:
        income: list[ParsedIncomeItem] = []
        taxes: list[ParsedTaxItem] = []
        warnings: list[str] = []
        sections = split_blocks(account, _SECTION_START)
        if not sections:
            return None
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
        account_last4 = mask_tin(text_for_label(account, _ACCOUNT_RE, mode="same_row"))
        form_type: FormType = "1099-consolidated"
        return ParsedTaxForm(
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


PARSER = Form1099ConsolidatedParser()

__all__ = ["PARSER", "Form1099ConsolidatedParser"]
