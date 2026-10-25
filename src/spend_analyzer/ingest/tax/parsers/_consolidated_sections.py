"""Same-row extraction of the INT / DIV / MISC sections of a consolidated 1099 document.

Private helper (underscore prefix: the parser registry skips it, and it exposes no parser-shaped
object). Consolidated broker layouts print ``<label> (Box n)  <amount>`` on one row, unlike the
IRS box layouts of the single-form parsers, so these functions are deliberately independent of
them. The 1099-B section is parsed by `f1099_b.parse_b_section`.

Every function takes one section block (an `ExtractedDoc` from `split_blocks`) and returns a
`SectionResult`. Income items are emitted for every labelled box that prints a value (zeros
included, memo boxes flagged); withholding only when greater than zero. Amounts are magnitudes
(only capital gains may be negative, D6).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from spend_analyzer.core.tax_types import IncomeCategory, ParsedIncomeItem, ParsedTaxItem
from spend_analyzer.core.types import ExtractedDoc
from spend_analyzer.ingest.layout import cluster_rows, parse_money
from spend_analyzer.ingest.tax.fields import compile_label, money_for_label


@dataclass(frozen=True, slots=True)
class SectionResult:
    income: tuple[ParsedIncomeItem, ...]
    taxes: tuple[ParsedTaxItem, ...]
    warnings: tuple[str, ...]

    @property
    def found_any(self) -> bool:
        return bool(self.income or self.taxes)


@dataclass(frozen=True, slots=True)
class _Box:
    pattern: re.Pattern[str]
    category: IncomeCategory
    box: str
    label: str
    is_memo: bool = False


def _pat(label: str) -> re.Pattern[str]:
    """A row-start box label that also accepts a ``Box n`` / ``1a`` prefix and a ``Total`` prefix
    (``Box 1 Interest income``, ``1a Total ordinary dividends``); a trailing ``(Box n)`` is
    skipped by the same-row amount reader."""
    return compile_label(rf"^(?:Box\s*)?(?:\d{{1,2}}[a-z]?[.):]?\s+)?(?:Total\s+)?(?:{label})\b")


_FED_WITHHELD_RE = _pat(r"Federal\s+income\s+tax\s+withheld")
_STATE_ROW = re.compile(r"^State\s+([A-Z]{2})\s+State\s+income\s+tax\s+withheld\b")

_INT_BOXES = (
    _Box(_pat(r"Interest\s+income|Taxable\s+interest"), "interest", "1", "Interest income"),
    _Box(
        _pat(r"Interest\s+on\s+U\.S\.\s+Savings\s+Bonds"),
        "interest",
        "3",
        "Interest on U.S. savings bonds and Treasury obligations",
    ),
    _Box(_pat(r"Tax-exempt\s+interest"), "other", "8", "Tax-exempt interest", True),
)
_DIV_BOXES = (
    _Box(_pat(r"Ordinary\s+dividends"), "ordinary_dividends", "1a", "Ordinary dividends"),
    _Box(
        _pat(r"Qualified\s+dividends"),
        "qualified_dividends",
        "1b",
        "Qualified dividends",
        True,
    ),
    _Box(
        _pat(r"Capital\s+gain\s+distributions"),
        "long_term_capital_gain",
        "2a",
        "Capital gain distributions",
    ),
    _Box(
        _pat(r"Exempt-interest\s+dividends"),
        "other",
        "12",
        "Exempt-interest dividends",
        True,
    ),
)
_MISC_BOXES = (
    _Box(_pat(r"Rents"), "other", "1", "Rents"),
    _Box(_pat(r"Royalties"), "other", "2", "Royalties"),
    _Box(_pat(r"Other\s+income"), "other", "3", "Other income"),
)


def _boxes(block: ExtractedDoc, boxes: tuple[_Box, ...], form: str) -> list[ParsedIncomeItem]:
    items: list[ParsedIncomeItem] = []
    for spec in boxes:
        money = money_for_label(block, spec.pattern, mode="same_row")
        if money is not None:
            items.append(
                ParsedIncomeItem(
                    spec.category,
                    money.magnitude_minor,
                    form,
                    spec.box,
                    spec.label,
                    is_memo=spec.is_memo,
                )
            )
    return items


def _withholding(block: ExtractedDoc, form: str) -> list[ParsedTaxItem]:
    taxes: list[ParsedTaxItem] = []
    fed = money_for_label(block, _FED_WITHHELD_RE, mode="same_row")
    if fed is not None and fed.magnitude_minor > 0:
        taxes.append(
            ParsedTaxItem(
                "federal_income_tax_withheld",
                fed.magnitude_minor,
                form,
                "4",
                "Federal income tax withheld",
            )
        )
    for page in block.pages:
        for row in cluster_rows(page.words):
            match = _STATE_ROW.match(row.text)
            if match is None:
                continue
            values = [m for m in (parse_money(w.text) for w in row.words) if m is not None]
            if values and values[-1].magnitude_minor > 0:
                taxes.append(
                    ParsedTaxItem(
                        "state_income_tax_withheld",
                        values[-1].magnitude_minor,
                        form,
                        "16",
                        "State income tax withheld",
                        jurisdiction=match.group(1),
                    )
                )
    return taxes


def parse_consolidated_int(block: ExtractedDoc) -> SectionResult:
    """A ``1099-INT`` section: box 1 / 3 interest, box 8 tax-exempt interest (memo), withholding."""
    return SectionResult(
        tuple(_boxes(block, _INT_BOXES, "1099-INT")),
        tuple(_withholding(block, "1099-INT")),
        (),
    )


def parse_consolidated_div(block: ExtractedDoc) -> SectionResult:
    """A ``1099-DIV`` section: 1a, 1b (memo), 2a capital gain distributions (long term), 12
    exempt-interest (memo), withholding. Warns when qualified exceeds ordinary dividends."""
    income = _boxes(block, _DIV_BOXES, "1099-DIV")
    warnings: list[str] = []
    ordinary = next((i.amount_minor for i in income if i.box == "1a"), None)
    qualified = next((i.amount_minor for i in income if i.box == "1b"), None)
    if ordinary is not None and qualified is not None and qualified > ordinary:
        warnings.append("1099-DIV qualified dividends exceed ordinary dividends.")
    return SectionResult(tuple(income), tuple(_withholding(block, "1099-DIV")), tuple(warnings))


def parse_consolidated_misc(block: ExtractedDoc) -> SectionResult:
    """A ``1099-MISC`` section: rents, royalties and other income (all ``other``), withholding."""
    return SectionResult(
        tuple(_boxes(block, _MISC_BOXES, "1099-MISC")),
        tuple(_withholding(block, "1099-MISC")),
        (),
    )
