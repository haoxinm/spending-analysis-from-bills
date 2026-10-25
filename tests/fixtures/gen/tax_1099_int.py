"""Synthetic Form 1099-INT fixtures (IRS box layout), layout id ``tax_1099_int``.

Variants: ``normal`` (boxes 1-3), ``with_withholding_and_state`` (boxes 1, 4 and state 17),
``tax_exempt_memo`` (box 8 memo), ``zero_interest`` (every box printed as 0.00). All identities
are invented (see `tax_common`).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from spend_analyzer.core.tax_types import (
    ParsedIncomeItem,
    ParsedTaxDocument,
    ParsedTaxForm,
    ParsedTaxItem,
)
from tests.fixtures.gen.irs_boxes import Cell, Row, money_text, render_1099
from tests.fixtures.gen.tax_common import ACCOUNT_NUMBER, BANK, build_golden, last4

_YEAR = 2024
_SRC = "1099-INT"


def _int_item(
    box: str, label: str, amount: int, *, category: Any = "interest", memo: bool = False
) -> ParsedIncomeItem:
    return ParsedIncomeItem(
        category=category, amount_minor=amount, source_form=_SRC, box=box, label=label, is_memo=memo
    )


def _rows(
    *,
    b1: int,
    b2: int,
    b3: int,
    b4: int,
    b8: int,
    state: tuple[str, str, int] | None,
    show_zero: bool,
) -> list[Row]:
    def val(amount: int) -> str:
        return money_text(amount) if amount or show_zero else ""

    state_cells: tuple[Cell | None, Cell | None, Cell | None] = (
        ("15 State", None, state[0] if state else ""),
        ("16 State identification no.", None, state[1] if state else ""),
        ("17 State tax withheld", None, money_text(state[2]) if state else ""),
    )
    return [
        (None, ("1 Interest income", None, money_text(b1)), None),
        (
            None,
            ("2 Early withdrawal penalty", None, val(b2)),
            ("3 Interest on U.S. Savings Bonds", "and Treas. obligations", val(b3)),
        ),
        (
            None,
            ("4 Federal income tax withheld", None, val(b4)),
            ("5 Investment expenses", None, ""),
        ),
        (
            None,
            ("6 Foreign tax paid", None, ""),
            ("7 Foreign country or U.S. possession", None, ""),
        ),
        (
            None,
            ("8 Tax-exempt interest", None, val(b8)),
            ("9 Specified private activity", "bond interest", ""),
        ),
        (None, ("10 Market discount", None, ""), ("11 Bond premium", None, "")),
        (
            None,
            ("12 Bond premium on Treasury", "obligations", ""),
            ("13 Bond premium on", "tax-exempt bond", ""),
        ),
        (None, None, ("14 Tax-exempt and tax credit", "bond CUSIP no.", "")),
        state_cells,
    ]


def _expected(income: list[ParsedIncomeItem], taxes: list[ParsedTaxItem]) -> ParsedTaxDocument:
    form = ParsedTaxForm(
        form_type="1099-int",
        tax_year=_YEAR,
        payer_name=BANK.name,
        payer_tin_last4=last4(BANK.ein),
        account_last4=last4(ACCOUNT_NUMBER),
        is_corrected=False,
        filing_status=None,
        agi_minor=None,
        taxable_income_minor=None,
        income=tuple(income),
        taxes=tuple(taxes),
    )
    return ParsedTaxDocument(tax_year=_YEAR, forms=(form,))


class Form1099IntBuilder:
    layout_id = "tax_1099_int"
    variants: tuple[str, ...] = (
        "normal",
        "with_withholding_and_state",
        "tax_exempt_memo",
        "zero_interest",
    )

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        pdf_path = out_dir / f"{self.layout_id}_{variant}.pdf"
        income: list[ParsedIncomeItem]
        taxes: list[ParsedTaxItem] = []
        b2 = b3 = b4 = b8 = 0
        state: tuple[str, str, int] | None = None
        show_zero = False
        if variant == "normal":
            b1, b2, b3 = 123_456, 1_200, 24_580
            income = [
                _int_item("1", "Interest income", b1),
                _int_item("3", "Interest on U.S. Savings Bonds and Treasury obligations", b3),
            ]
        elif variant == "with_withholding_and_state":
            b1, b4 = 348_000, 87_000
            state = ("CA", "5551234", 12_000)
            income = [_int_item("1", "Interest income", b1)]
            taxes = [
                ParsedTaxItem(
                    "federal_income_tax_withheld", b4, _SRC, "4", "Federal income tax withheld"
                ),
                ParsedTaxItem(
                    "state_income_tax_withheld",
                    12_000,
                    _SRC,
                    "17",
                    "State tax withheld",
                    jurisdiction="CA",
                ),
            ]
        elif variant == "tax_exempt_memo":
            b1, b8 = 120_000, 64_000
            income = [
                _int_item("1", "Interest income", b1),
                _int_item("8", "Tax-exempt interest", b8, category="other", memo=True),
            ]
        elif variant == "zero_interest":
            b1 = 0
            show_zero = True
            income = [_int_item("1", "Interest income", 0)]
        else:
            raise ValueError(f"unknown variant {variant!r}")
        render_1099(
            pdf_path,
            heading="Form 1099-INT",
            subtitle="Interest Income",
            omb="OMB No. 1545-0112",
            rev="(Rev. January 2024)",
            year_text=str(_YEAR),
            corrected=False,
            payer=BANK,
            account_number=ACCOUNT_NUMBER,
            rows=_rows(b1=b1, b2=b2, b3=b3, b4=b4, b8=b8, state=state, show_zero=show_zero),
        )
        return build_golden(_expected(income, taxes))


BUILDER = Form1099IntBuilder()
