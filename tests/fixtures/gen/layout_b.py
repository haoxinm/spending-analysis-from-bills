"""Fixture generator for Layout B — ``layout_b_credit`` (§2c, P1-B2).

Builds synthetic PDFs shaped like a dual-table, capitalized credit-card statement: an
``ACCOUNT ACTIVITY`` transaction table (``PAYMENTS AND OTHER CREDITS`` then ``PURCHASES``)
followed by an ``INTEREST CHARGED`` balance-type table that must never contribute a
transaction. Bank name is invented (``Cascade Trust Bank``) per §2c's "never use a real bank
name" rule.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from tests.fixtures.gen.base import format_row, render_lines_pdf

_ACTIVITY_WIDTHS = (20, 45, 12)
_INTEREST_WIDTHS = (34, 30, 34, 18)

_BANK_NAME = "CASCADE TRUST BANK"
_MASK = "4321"


def _summary_lines(*, include: bool, closing_balance_minor: int = 40195) -> list[str]:
    if not include:
        return [f"{_BANK_NAME}", f"Account ending in {_MASK}", ""]
    closing = closing_balance_minor / 100
    return [
        f"{_BANK_NAME}",
        f"Account ending in {_MASK}",
        "Opening Date: 01/16/2026",
        "Closing Date: 02/15/2026",
        "Previous Balance: $500.00",
        f"New Balance: ${closing:.2f}",
        "",
    ]


def _activity_header() -> list[str]:
    return [
        "ACCOUNT ACTIVITY",
        format_row(
            ["Date of Transaction", "Merchant Name or Transaction Description", "$ Amount"],
            _ACTIVITY_WIDTHS,
        ),
        "",
    ]


def _interest_table() -> list[str]:
    return [
        "",
        "INTEREST CHARGED",
        format_row(
            [
                "Balance Type",
                "Annual Percentage Rate (APR)",
                "Balance Subject To Interest Rate",
                "Interest Charged",
            ],
            _INTEREST_WIDTHS,
        ),
        format_row(["PURCHASES", "22.99%", "201.95", "3.87"], _INTEREST_WIDTHS),
        format_row(["CASH ADVANCES", "25.99%", "0.00", "0.00"], _INTEREST_WIDTHS),
        format_row(
            ["BALANCE TRANSFERS / PLATINUM LOAN", "0.00%", "0.00", "0.00"], _INTEREST_WIDTHS
        ),
    ]


def _row(date: str, description: str, amount: str) -> str:
    return format_row([date, description, amount], _ACTIVITY_WIDTHS)


def _txn(
    posted_date: str,
    description: str,
    amount_minor: int,
    kind_hint: str,
    section: str,
    *,
    fx_amount_minor: int | None = None,
    fx_currency: str | None = None,
    fx_rate: float | None = None,
) -> dict[str, Any]:
    return {
        "posted_date": posted_date,
        "transaction_date": None,
        "description": description,
        "amount_minor": amount_minor,
        "currency": "USD",
        "fx_amount_minor": fx_amount_minor,
        "fx_currency": fx_currency,
        "fx_rate": fx_rate,
        "kind_hint": kind_hint,
        "section": section,
        "issuer_category": None,
    }


def _golden(
    transactions: list[dict[str, Any]], *, closing_balance_minor: int = 40195
) -> dict[str, Any]:
    return {
        "account_hint": {"account_type": "credit", "mask": _MASK, "currency": "USD"},
        "period_start": "2026-01-16",
        "period_end": "2026-02-15",
        "stated_total_minor": None,
        "opening_balance_minor": 50000,
        "closing_balance_minor": closing_balance_minor,
        "section_totals": [],
        "warnings": [],
        "transactions": transactions,
    }


class LayoutBBuilder:
    layout_id = "layout_b_credit"
    variants = ("normal", "multiline", "fx", "refund_and_payment", "malformed", "no_summary")

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        del seed  # content is fixed; every variant is already deterministic
        builders: dict[str, Callable[[], tuple[list[list[str]], dict[str, Any]]]] = {
            "normal": self._build_normal,
            "multiline": self._build_multiline,
            "fx": self._build_fx,
            "refund_and_payment": self._build_refund_and_payment,
            "malformed": self._build_malformed,
            "no_summary": self._build_no_summary,
        }
        pages, golden = builders[variant]()
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"{self.layout_id}_{variant}.pdf"
        render_lines_pdf(pdf_path, pages)
        return golden

    def _build_normal(self) -> tuple[list[list[str]], dict[str, Any]]:
        page1 = [
            *_summary_lines(include=True),
            *_activity_header(),
            "PAYMENTS AND OTHER CREDITS",
            _row("01/20", "ONLINE PAYMENT THANK YOU", "-300.00"),
            "",
            "PURCHASES",
            _row("01/18", "COFFEE ROASTERS DOWNTOWN", "12.50"),
            _row("01/22", "GROCERY MART", "45.00"),
            _row("01/25", "HARDWARE SUPPLY CO", "92.50"),
        ]
        page2 = [
            _row("02/01", "BOOKSTORE ANNEX", "33.75"),
            _row("02/05", "GARDEN CENTER", "18.20"),
            *_interest_table(),
        ]
        transactions = [
            _txn(
                "2026-01-20",
                "ONLINE PAYMENT THANK YOU",
                -30000,
                "payment",
                "PAYMENTS AND OTHER CREDITS",
            ),
            _txn("2026-01-18", "COFFEE ROASTERS DOWNTOWN", 1250, "purchase", "PURCHASES"),
            _txn("2026-01-22", "GROCERY MART", 4500, "purchase", "PURCHASES"),
            _txn("2026-01-25", "HARDWARE SUPPLY CO", 9250, "purchase", "PURCHASES"),
            _txn("2026-02-01", "BOOKSTORE ANNEX", 3375, "purchase", "PURCHASES"),
            _txn("2026-02-05", "GARDEN CENTER", 1820, "purchase", "PURCHASES"),
        ]
        return [page1, page2], _golden(transactions)

    def _build_multiline(self) -> tuple[list[list[str]], dict[str, Any]]:
        closing = 50000 + (-30000 + 1250 + 4500 + 9250)
        page1 = [
            *_summary_lines(include=True, closing_balance_minor=closing),
            *_activity_header(),
            "PAYMENTS AND OTHER CREDITS",
            _row("01/20", "ONLINE PAYMENT THANK YOU", "-300.00"),
            "",
            "PURCHASES",
            _row("01/18", "COFFEE ROASTERS DOWNTOWN", "12.50"),
            _row("01/22", "AMZN MKTP US*ORDER 114-9928301", "45.00"),
            "AMAZON.COM SEATTLE WA",
            _row("01/25", "HARDWARE SUPPLY CO", "92.50"),
            *_interest_table(),
        ]
        transactions = [
            _txn(
                "2026-01-20",
                "ONLINE PAYMENT THANK YOU",
                -30000,
                "payment",
                "PAYMENTS AND OTHER CREDITS",
            ),
            _txn("2026-01-18", "COFFEE ROASTERS DOWNTOWN", 1250, "purchase", "PURCHASES"),
            _txn(
                "2026-01-22",
                "AMZN MKTP US*ORDER 114-9928301 AMAZON.COM SEATTLE WA",
                4500,
                "purchase",
                "PURCHASES",
            ),
            _txn("2026-01-25", "HARDWARE SUPPLY CO", 9250, "purchase", "PURCHASES"),
        ]
        return [page1], _golden(transactions, closing_balance_minor=closing)

    def _build_fx(self) -> tuple[list[list[str]], dict[str, Any]]:
        closing = 50000 + (-30000 + 1250 + 4200 + 9250)
        page1 = [
            *_summary_lines(include=True, closing_balance_minor=closing),
            *_activity_header(),
            "PAYMENTS AND OTHER CREDITS",
            _row("01/20", "ONLINE PAYMENT THANK YOU", "-300.00"),
            "",
            "PURCHASES",
            _row("01/18", "COFFEE ROASTERS DOWNTOWN", "12.50"),
            _row("01/24", "AMAZON.CO.UK LONDON GBR", "42.00"),
            "FOREIGN CURRENCY AMOUNT 35.00 GBP EXCH RATE 1.20000",
            _row("01/25", "HARDWARE SUPPLY CO", "92.50"),
            *_interest_table(),
        ]
        transactions = [
            _txn(
                "2026-01-20",
                "ONLINE PAYMENT THANK YOU",
                -30000,
                "payment",
                "PAYMENTS AND OTHER CREDITS",
            ),
            _txn("2026-01-18", "COFFEE ROASTERS DOWNTOWN", 1250, "purchase", "PURCHASES"),
            _txn(
                "2026-01-24",
                "AMAZON.CO.UK LONDON GBR",
                4200,
                "purchase",
                "PURCHASES",
                fx_amount_minor=3500,
                fx_currency="GBP",
                fx_rate=1.2,
            ),
            _txn("2026-01-25", "HARDWARE SUPPLY CO", 9250, "purchase", "PURCHASES"),
        ]
        return [page1], _golden(transactions, closing_balance_minor=closing)

    def _build_refund_and_payment(self) -> tuple[list[list[str]], dict[str, Any]]:
        closing = 50000 + (-30000 - 2500 + 1250 - 1500)
        page1 = [
            *_summary_lines(include=True, closing_balance_minor=closing),
            *_activity_header(),
            "PAYMENTS AND OTHER CREDITS",
            _row("01/20", "ONLINE PAYMENT THANK YOU", "-300.00"),
            _row("01/21", "MERCHANT REFUND CREDIT CO", "-25.00"),
            "",
            "PURCHASES",
            _row("01/18", "COFFEE ROASTERS DOWNTOWN", "12.50"),
            _row("01/30", "HARDWARE SUPPLY RETURN", "-15.00"),
            *_interest_table(),
        ]
        transactions = [
            _txn(
                "2026-01-20",
                "ONLINE PAYMENT THANK YOU",
                -30000,
                "payment",
                "PAYMENTS AND OTHER CREDITS",
            ),
            _txn(
                "2026-01-21",
                "MERCHANT REFUND CREDIT CO",
                -2500,
                "refund",
                "PAYMENTS AND OTHER CREDITS",
            ),
            _txn("2026-01-18", "COFFEE ROASTERS DOWNTOWN", 1250, "purchase", "PURCHASES"),
            _txn("2026-01-30", "HARDWARE SUPPLY RETURN", -1500, "adjustment", "PURCHASES"),
        ]
        return [page1], _golden(transactions, closing_balance_minor=closing)

    def _build_malformed(self) -> tuple[list[list[str]], dict[str, Any]]:
        # Summary block present, but every "amount" is non-numeric: no data row can be
        # recognized, so the parser must raise ParserError rather than invent rows.
        page1 = [
            *_summary_lines(include=True),
            *_activity_header(),
            "PURCHASES",
            _row("01/18", "COFFEE ROASTERS DOWNTOWN", "N/A"),
            _row("01/22", "GROCERY MART", "TBD"),
        ]
        return [page1], {"expect_error": "ParserError"}

    def _build_no_summary(self) -> tuple[list[list[str]], dict[str, Any]]:
        # A well-formed activity table, but the summary block (period + balances) is omitted.
        # Layout B's dates carry no year, so the missing period must raise ParserError.
        page1 = [
            *_summary_lines(include=False),
            *_activity_header(),
            "PURCHASES",
            _row("01/18", "COFFEE ROASTERS DOWNTOWN", "12.50"),
            _row("01/22", "GROCERY MART", "45.00"),
            _row("01/25", "HARDWARE SUPPLY CO", "92.50"),
        ]
        return [page1], {"expect_error": "ParserError"}


#: Discovered by `tests/generate_fixtures.py` (no shared registry — see `base.py`).
layout_b = LayoutBBuilder()
