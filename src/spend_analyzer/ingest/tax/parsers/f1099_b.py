"""Form 1099-B (Proceeds From Broker and Barter Exchange Transactions) parser, id ``tax_1099_b``.

Software-style layout: label and value share a visual row. Two table shapes are understood and may
both be present:

* a summary table, one row per term/category::

      Short-term (covered)   <proceeds>  <cost basis>  <wash sale adj>  <net gain/loss>

* transaction detail rows under a ``Short-term transactions ...`` / ``Long-term transactions ...``
  heading::

      <description>  <date acquired>  <date sold>  <proceeds>  <cost>  <wash adj>  <gain/loss>

Emitted (plan 2.5): net short-term gain/loss -> ``short_term_capital_gain``, net long-term ->
``long_term_capital_gain`` (both may be negative, D6); an "ordinary/undetermined" term becomes
``other`` (only when positive) with a warning. Per term the summary rows win; the detail rows are
used when no summary row exists. Box 4 federal withholding and a ``State XX State income tax
withheld`` row become tax items (only when greater than zero). Proceeds and cost are never stored.

Warnings (fixed text, no document content): ``proceeds - cost + wash adjustment != printed gain``
per term, and detail rows that do not add up to the summary.

`parse_b_section(block, year)` parses ONE 1099-B block and is reused by the consolidated parser.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from spend_analyzer.core.errors import ParserError
from spend_analyzer.core.tax_types import (
    FormType,
    ParsedIncomeItem,
    ParsedTaxDocument,
    ParsedTaxForm,
    ParsedTaxItem,
)
from spend_analyzer.core.types import ExtractedDoc
from spend_analyzer.ingest.layout import Row, cluster_rows, parse_money
from spend_analyzer.ingest.tax.common import (
    build_document,
    halve_if_other_1099,
    require_year,
    sanitize_payer_name,
)
from spend_analyzer.ingest.tax.fields import (
    compile_label,
    corrected_marker,
    money_for_label,
    signed,
    split_blocks,
    text_for_label,
)
from spend_analyzer.ingest.tax.tin import mask_tin

_TITLE_RE = re.compile(r"\bForm\s*1099-B\b")
_FORM_START_RE = re.compile(r"^\s*Form\s*1099-B\b", re.IGNORECASE)
_PROCEEDS_RE = re.compile(r"\bProceeds\b", re.IGNORECASE)
_BASIS_RE = re.compile(r"\b(?:Cost\s+basis|Wash\s+sale|Gain/Loss|Net\s+gain)", re.IGNORECASE)
_RETURN_RE = re.compile(r"U\.S\.\s+Individual\s+Income\s+Tax\s+Return", re.IGNORECASE)

_PAYER_NAME_RE = compile_label(r"^Payer(?:'s)?\s+name\b:?")
_PAYER_TIN_RE = compile_label(r"^Payer(?:'s)?\s+TIN\b:?")
_ACCOUNT_RE = compile_label(r"^Account\s+number\b:?")
_FED_WITHHELD_RE = compile_label(r"^Federal\s+income\s+tax\s+withheld\b")

_TERM_START = re.compile(
    r"^(?:detail:\s*)?(short|long)-term\b|^(?:detail:\s*)?(ordinary|undetermined)\b", re.I
)
_STATE_ROW = re.compile(r"^State\s+([A-Z]{2})\s+State\s+income\s+tax\s+withheld\b")
_DATE_TOKEN = re.compile(r"^(?:\d{1,2}/\d{1,2}/\d{2,4}|various)$", re.IGNORECASE)

_CENT_TOLERANCE = 1

_TERM_LABEL = {"short": "short-term", "long": "long-term", "other": "ordinary or undetermined-term"}


@dataclass(slots=True)
class _Totals:
    proceeds: int = 0
    cost: int = 0
    wash: int = 0
    net: int = 0
    rows: int = 0
    reconciles: bool = True

    def add(self, proceeds: int, cost: int, wash: int, net: int) -> None:
        self.proceeds += proceeds
        self.cost += cost
        self.wash += wash
        self.net += net
        self.rows += 1
        if abs(proceeds - cost + wash - net) > _CENT_TOLERANCE:
            self.reconciles = False


@dataclass(slots=True)
class _Scan:
    summary: dict[str, _Totals] = field(default_factory=dict)
    detail: dict[str, _Totals] = field(default_factory=dict)
    unreadable_rows: bool = False


def _term_key(match: re.Match[str]) -> str:
    return "other" if match.group(2) else match.group(1).lower()


def _rows(block: ExtractedDoc) -> list[Row]:
    return [row for page in block.pages for row in cluster_rows(page.words)]


def _scan(block: ExtractedDoc) -> _Scan:
    scan = _Scan()
    current: str | None = None
    for row in _rows(block):
        words = [w.text for w in row.words]
        dates = [i for i, text in enumerate(words) if _DATE_TOKEN.match(text)]
        start = _TERM_START.match(row.text)
        if not dates:
            money = [m for m in (parse_money(t) for t in words) if m is not None]
            if start is not None and len(money) >= 4:
                key = _term_key(start)
                nums = [signed(m) for m in money[-4:]]
                p, c, w, n = (0 if v is None else v for v in nums)
                scan.summary.setdefault(key, _Totals()).add(p, c, w, n)
            elif start is not None and "transactions" in row.text.lower():
                current = _term_key(start)
            continue
        if current is None:
            continue
        tail = [parse_money(t) for t in words[dates[-1] + 1 :]]
        if len(tail) != 4 or any(m is None for m in tail):
            scan.unreadable_rows = True
            continue
        p, c, w, n = (0 if v is None else v for v in (signed(m) for m in tail))
        scan.detail.setdefault(current, _Totals()).add(p, c, w, n)
    return scan


def _row_money_last(row: Row) -> int | None:
    values = [m for m in (parse_money(w.text) for w in row.words) if m is not None]
    return values[-1].magnitude_minor if values else None


def _identity(block: ExtractedDoc) -> tuple[str | None, str | None, str | None]:
    name = sanitize_payer_name(text_for_label(block, _PAYER_NAME_RE, mode="same_row"))
    tin = mask_tin(text_for_label(block, _PAYER_TIN_RE, mode="same_row"))
    account = mask_tin(text_for_label(block, _ACCOUNT_RE, mode="same_row"))
    return name, tin, account


def parse_b_section(block: ExtractedDoc, year: int) -> ParsedTaxForm:
    """Parse one 1099-B block (a whole form, or a section of a consolidated document).

    Payer name / TIN last four / account last four are filled when the block prints them (else
    ``None``; the consolidated parser overrides them). Income items are net gain or loss per term
    (`ParsedIncomeItem.amount_minor` may be negative, D6); tax items are withholding.

    Raises:
        ParserError: the block has neither a summary row nor any readable transaction row
            (generic message, no document text).
    """
    scan = _scan(block)
    if not scan.summary and not scan.detail:
        raise ParserError("No 1099-B transaction totals were found in this form.")
    warnings: list[str] = []
    income: list[ParsedIncomeItem] = []
    for key in ("short", "long", "other"):
        summary, detail = scan.summary.get(key), scan.detail.get(key)
        chosen = summary or detail
        if chosen is None:
            continue
        label = _TERM_LABEL[key]
        if not chosen.reconciles:
            warnings.append(
                f"1099-B {label} figures do not reconcile: proceeds less cost basis plus wash "
                "sale adjustment differs from the printed gain or loss."
            )
        if summary and detail and abs(summary.net - detail.net) > _CENT_TOLERANCE:
            warnings.append(f"1099-B {label} transaction rows do not add up to the summary.")
        if key == "short":
            income.append(
                ParsedIncomeItem(
                    "short_term_capital_gain",
                    chosen.net,
                    "1099-B",
                    "ST",
                    "Net short-term gain or loss",
                )
            )
        elif key == "long":
            income.append(
                ParsedIncomeItem(
                    "long_term_capital_gain",
                    chosen.net,
                    "1099-B",
                    "LT",
                    "Net long-term gain or loss",
                )
            )
        else:
            warnings.append(
                "1099-B ordinary or undetermined-term transactions are reported as other income."
            )
            if chosen.net > 0:
                income.append(
                    ParsedIncomeItem(
                        "other", chosen.net, "1099-B", None, "Ordinary or undetermined-term gain"
                    )
                )
            elif chosen.net < 0:
                warnings.append(
                    "A 1099-B ordinary or undetermined-term loss was not recorded as income."
                )
    if scan.unreadable_rows:
        warnings.append("Some 1099-B transaction rows could not be read.")
    taxes: list[ParsedTaxItem] = []
    fed = money_for_label(block, _FED_WITHHELD_RE, mode="same_row")
    if fed is not None and fed.magnitude_minor > 0:
        taxes.append(
            ParsedTaxItem(
                "federal_income_tax_withheld",
                fed.magnitude_minor,
                "1099-B",
                "4",
                "Federal income tax withheld",
            )
        )
    for row in _rows(block):
        state = _STATE_ROW.match(row.text)
        amount = _row_money_last(row) if state else None
        if state and amount:
            taxes.append(
                ParsedTaxItem(
                    "state_income_tax_withheld",
                    amount,
                    "1099-B",
                    "16",
                    "State income tax withheld",
                    jurisdiction=state.group(1),
                )
            )
    name, tin, account = _identity(block)
    form_type: FormType = "1099-b"
    return ParsedTaxForm(
        form_type=form_type,
        tax_year=year,
        payer_name=name,
        payer_tin_last4=tin,
        account_last4=account,
        is_corrected=corrected_marker(block),
        filing_status=None,
        agi_minor=None,
        taxable_income_minor=None,
        income=tuple(income),
        taxes=tuple(taxes),
        warnings=tuple(dict.fromkeys(warnings)),
    )


class Form1099BParser:
    """Standalone 1099-B (one or several forms per file)."""

    id = "tax_1099_b"
    version = "1"
    form_types: tuple[FormType, ...] = ("1099-b",)

    def detect(self, doc: ExtractedDoc) -> float:
        text = doc.full_text
        if _RETURN_RE.search(text) or not _TITLE_RE.search(text):
            return 0.0
        if not (_PROCEEDS_RE.search(text) and _BASIS_RE.search(text)):
            return 0.0
        return halve_if_other_1099(0.9, doc, "B")

    def parse(self, doc: ExtractedDoc, *, tax_year: int | None = None) -> ParsedTaxDocument:
        year = require_year(doc, tax_year)
        blocks = split_blocks(doc, _FORM_START_RE) or (doc,)
        forms = [parse_b_section(block, year) for block in blocks]
        return build_document(forms)


PARSER = Form1099BParser()
