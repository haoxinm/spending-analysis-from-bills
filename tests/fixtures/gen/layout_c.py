"""Synthetic-fixture generator for Layout C (`layout_c_credit`, §2c "Layout C").

Renders a two-section statement where the section boundary is a repeated column-header row
(no section-heading lines): ``TRANS. DATE / PAYMENTS AND CREDITS / AMOUNT`` for the
payments-and-credits section, then ``TRANS DATE / PURCHASES / MERCHANT CATEGORY / AMOUNT`` for
the purchases section — deliberately exercising both header punctuation spellings in every
non-corrupted variant.

The golden returned by `build()` is a plain JSON-able dict of this generator's own design (there
is no shared golden schema across the four layout WPs): ``{"expect_error": ..., "parsed": ...}``.
``expect_error`` is `None` for a variant the parser is expected to parse successfully, or the
short name of the exception class (``"ParserError"`` / ``"UnsupportedLayoutError"``) for one that
must raise. ``parsed`` mirrors `ParsedStatement`/`RawTransaction` as plain dicts, dates as
``YYYY-MM-DD`` strings, only present when ``expect_error`` is `None`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from tests.fixtures.gen.base import format_row, render_lines_pdf

_BANK_NAME = "Fabrikam Bank"  # invented issuer name only (§2c note) — never a real bank

#: Column widths, chosen so every header AND data cell fits within its width without
#: `str.ljust` leaving it unpadded (which would shift that row's later columns out of
#: alignment with every other row's) — this is what keeps `infer_column_bands` finding the
#: same band boundaries on the header row and every data/continuation row alike.
_WIDTHS_SECTION1 = (12, 30, 12)  # TRANS. DATE | PAYMENTS AND CREDITS | AMOUNT
_WIDTHS_SECTION2 = (12, 26, 20, 12)  # TRANS DATE | PURCHASES | MERCHANT CATEGORY | AMOUNT

_HEADER1 = ("TRANS. DATE", "PAYMENTS AND CREDITS", "AMOUNT")
_HEADER2 = ("TRANS DATE", "PURCHASES", "MERCHANT CATEGORY", "AMOUNT")
_HEADER1_CORRUPT = ("TRANS. DATE", "PAYMENTS AND CREDITS", "AMT")
_HEADER2_CORRUPT = ("TRANS DATE", "PURCHASES", "MERCHANT CATEGORY", "AMT")

# Section 1 (payments and credits): printed with a leading '-' (I5: negative = inflow).
_PAYMENTS_ROWS = (
    ("01/05", "ONLINE PAYMENT THANK YOU", "-100.00"),
    ("01/10", "MERCHANDISE REFUND CO", "-25.50"),
)

# Section 2 (purchases): printed unsigned (I5: positive = outflow), with a category column.
_PURCHASES_ROWS = (
    ("01/06", "COFFEE SHOP SEATTLE WA", "DINING", "12.34"),
    ("01/07", "GROCERY STORE ANYTOWN", "GROCERIES", "56.78"),
    ("01/20", "HARDWARE STORE DOWNTOWN", "HOME IMPROVEMENT", "40.00"),
)

_PERIOD_START = "2026-01-01"
_PERIOD_END = "2026-01-31"
_OPENING_BALANCE_MINOR = 10_000  # $100.00
_ACCOUNT_MASK = "4321"

_PAYMENTS_TOTAL_MINOR = 10_000 + 2_550  # magnitudes only, sign applied below
_PURCHASES_TOTAL_MINOR = 1_234 + 5_678 + 4_000


def _summary_lines(*, include_summary: bool) -> list[str]:
    if not include_summary:
        return [_BANK_NAME, "Transactions"]
    return [
        _BANK_NAME,
        f"Billing Period: {_PERIOD_START[5:7]}/{_PERIOD_START[8:10]}/{_PERIOD_START[0:4]} - "
        f"{_PERIOD_END[5:7]}/{_PERIOD_END[8:10]}/{_PERIOD_END[0:4]}",
        f"Account Number: **** **** **** {_ACCOUNT_MASK}",
        "Previous Balance: $100.00",
        "New Balance: $83.62",
        "Transactions",
    ]


def _money_to_minor(text: str) -> int:
    negative = text.startswith("-")
    magnitude = text.lstrip("-")
    dollars, cents = magnitude.split(".")
    minor = int(dollars) * 100 + int(cents)
    return -minor if negative else minor


def _expected_transactions(
    *, multiline_extra: str | None, fx_line: tuple[int, str, float | None] | None
) -> list[dict[str, Any]]:
    transactions: list[dict[str, Any]] = []
    for tx_date, desc, amount in _PAYMENTS_ROWS:
        month, day = tx_date.split("/")
        transactions.append(
            {
                "posted_date": f"2026-{month}-{day}",
                "transaction_date": None,
                "description": desc,
                "amount_minor": _money_to_minor(amount),
                "currency": "USD",
                "fx_amount_minor": None,
                "fx_currency": None,
                "fx_rate": None,
                "kind_hint": "payment_or_refund",
                "section": "PAYMENTS AND CREDITS",
                "issuer_category": None,
            }
        )
    for idx, (tx_date, desc, category, amount) in enumerate(_PURCHASES_ROWS):
        month, day = tx_date.split("/")
        description = desc
        if multiline_extra is not None and idx == 1:
            description = f"{desc} {multiline_extra}"
        fx_amount_minor = fx_currency = fx_rate = None
        if fx_line is not None and fx_line[0] == idx:
            _, fx_currency, fx_rate = fx_line
            fx_amount_minor = 12_500
        transactions.append(
            {
                "posted_date": f"2026-{month}-{day}",
                "transaction_date": None,
                "description": description,
                "amount_minor": _money_to_minor(amount),
                "currency": "USD",
                "fx_amount_minor": fx_amount_minor,
                "fx_currency": fx_currency,
                "fx_rate": fx_rate,
                "kind_hint": "purchase",
                "section": "PURCHASES",
                "issuer_category": category,
            }
        )
    return transactions


class LayoutCBuilder:
    """`LayoutBuilder` for Layout C (P1-B3)."""

    layout_id = "layout_c_credit"
    variants = ("normal", "multiline", "fx", "refund_and_payment", "malformed", "no_summary")

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        del seed  # every variant is fully deterministic already; nothing to seed here
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"{self.layout_id}_{variant}.pdf"

        if variant == "malformed":
            self._render(pdf_path, corrupt_headers=True, include_summary=True)
            return {"expect_error": "UnsupportedLayoutError"}

        if variant == "no_summary":
            self._render(pdf_path, corrupt_headers=False, include_summary=False)
            return {"expect_error": "ParserError"}

        multiline_extra = "WEEKLY ORDER" if variant == "multiline" else None
        fx_line: tuple[int, str, float | None] | None = None
        if variant == "fx":
            fx_line = (2, "EUR", 1.0870)

        self._render(
            pdf_path,
            corrupt_headers=False,
            include_summary=True,
            multiline_extra=multiline_extra,
            fx_line=fx_line,
        )

        transactions = _expected_transactions(multiline_extra=multiline_extra, fx_line=fx_line)
        return {
            "expect_error": None,
            "parsed": {
                "account_hint": {
                    "account_type": "credit",
                    "mask": _ACCOUNT_MASK,
                    "currency": "USD",
                },
                "period_start": _PERIOD_START,
                "period_end": _PERIOD_END,
                "stated_total_minor": None,
                "opening_balance_minor": _OPENING_BALANCE_MINOR,
                "closing_balance_minor": _OPENING_BALANCE_MINOR
                - _PAYMENTS_TOTAL_MINOR
                + _PURCHASES_TOTAL_MINOR,
                "transactions": transactions,
            },
        }

    @staticmethod
    def _render(
        pdf_path: Path,
        *,
        corrupt_headers: bool,
        include_summary: bool,
        multiline_extra: str | None = None,
        fx_line: tuple[int, str, float | None] | None = None,
    ) -> None:
        header1 = _HEADER1_CORRUPT if corrupt_headers else _HEADER1
        header2 = _HEADER2_CORRUPT if corrupt_headers else _HEADER2

        page1: list[str] = [*_summary_lines(include_summary=include_summary), ""]
        page1.append(format_row(list(header1), _WIDTHS_SECTION1))
        for tx_date, desc, amount in _PAYMENTS_ROWS:
            page1.append(format_row([tx_date, desc, amount], _WIDTHS_SECTION1))

        page2: list[str] = [format_row(list(header2), _WIDTHS_SECTION2)]
        for idx, (tx_date, desc, category, amount) in enumerate(_PURCHASES_ROWS):
            page2.append(format_row([tx_date, desc, category, amount], _WIDTHS_SECTION2))
            if multiline_extra is not None and idx == 1:
                page2.append(format_row(["", multiline_extra, "", ""], _WIDTHS_SECTION2))
            if fx_line is not None and fx_line[0] == idx:
                _, currency, rate = fx_line
                rate_part = f" RATE {rate:.4f}" if rate is not None else ""
                fx_text = f"FX 125.00 {currency}{rate_part}"
                page2.append(format_row(["", fx_text, "", ""], _WIDTHS_SECTION2))

        render_lines_pdf(pdf_path, [page1, page2])


layout_c_credit = LayoutCBuilder()
