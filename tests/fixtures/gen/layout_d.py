"""Synthetic fixture generator for Layout D (`layout_d_bank`), §2c.

Renders bank-statement-shaped PDFs with `Date · Description · Withdrawals/Debits ·
Deposits/Credits · Balance` columns, section headings, and a summary block carrying
``Beginning Balance`` / ``Ending Balance`` and the statement period as
``<Month D, YYYY> through <Month D, YYYY>``. Invented bank name only (I1b, §2c).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from tests.fixtures.gen.base import format_row, render_lines_pdf

_WIDTHS = (6, 40, 20, 18, 12)
_HEADER = ("Date", "Description", "Withdrawals/Debits", "Deposits/Credits", "Balance")

_BANK_NAME = "Lakeshore Community Bank"


def _money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100:,}.{cents % 100:02d}"


def _summary_lines(*, opening: int, closing: int) -> list[str]:
    return [
        _BANK_NAME,
        "Transaction Detail",
        "Checking Account Statement",
        "March 1, 2026 through March 31, 2026",
        f"Beginning Balance ${_money(opening)}",
        f"Ending Balance ${_money(closing)}",
        "",
    ]


def _data_row(
    date_str: str, description: str, *, debit: int | None, credit: int | None, balance: int | None
) -> str:
    debit_str = _money(debit) if debit is not None else ""
    credit_str = _money(credit) if credit is not None else ""
    balance_str = _money(balance) if balance is not None else ""
    return format_row([date_str, description, debit_str, credit_str, balance_str], _WIDTHS)


class LayoutDBuilder:
    layout_id = "layout_d_bank"
    variants: tuple[str, ...] = (
        "normal",
        "multiline",
        "fx",
        "refund_and_payment",
        "malformed",
        "no_summary",
    )

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        builder = getattr(self, f"_build_{variant}")
        pdf_path = out_dir / f"{self.layout_id}_{variant}.pdf"
        return builder(pdf_path, seed=seed)  # type: ignore[no-any-return]

    # -- normal ------------------------------------------------------------------------------

    def _build_normal(self, pdf_path: Path, *, seed: int) -> dict[str, Any]:
        opening = 100_000
        page1 = [
            *_summary_lines(opening=opening, closing=305_800),
            format_row(_HEADER, _WIDTHS),
            "Deposits and Additions",
            _data_row(
                "03/02",
                "DIRECT DEPOSIT PAYROLL ACME CORP",
                debit=None,
                credit=250_000,
                balance=350_000,
            ),
            "ATM & Debit Card Withdrawals",
            _data_row(
                "03/05", "ATM WITHDRAWAL MAIN ST BRANCH", debit=20_000, credit=None, balance=330_000
            ),
        ]
        page2 = [
            "Electronic Withdrawals",
            _data_row(
                "03/10", "ELECTRIC COMPANY UTILITY BILL", debit=8_000, credit=None, balance=322_000
            ),
            "Checks Paid",
            _data_row("03/15", "CHECK #1042", debit=15_000, credit=None, balance=307_000),
            "Fees",
            _data_row(
                "03/20", "MONTHLY MAINTENANCE FEE", debit=1_200, credit=None, balance=305_800
            ),
        ]
        render_lines_pdf(pdf_path, [page1, page2])
        transactions = [
            _txn(
                "2026-03-02",
                "DIRECT DEPOSIT PAYROLL ACME CORP",
                -250_000,
                "transfer",
                "deposits and additions",
            ),
            _txn(
                "2026-03-05",
                "ATM WITHDRAWAL MAIN ST BRANCH",
                20_000,
                "purchase",
                "atm & debit card withdrawals",
            ),
            _txn(
                "2026-03-10",
                "ELECTRIC COMPANY UTILITY BILL",
                8_000,
                "purchase",
                "electronic withdrawals",
            ),
            _txn("2026-03-15", "CHECK #1042", 15_000, "purchase", "checks paid"),
            _txn("2026-03-20", "MONTHLY MAINTENANCE FEE", 1_200, "fee", "fees"),
        ]
        return _golden(opening, 305_800, transactions)

    # -- multiline -----------------------------------------------------------------------------

    def _build_multiline(self, pdf_path: Path, *, seed: int) -> dict[str, Any]:
        opening = 50_000
        page1 = [
            *_summary_lines(opening=opening, closing=42_000),
            format_row(_HEADER, _WIDTHS),
            "Electronic Withdrawals",
            _data_row(
                "03/12", "ONLINE BILL PAY XYZ CORP", debit=8_000, credit=None, balance=42_000
            ),
            "REF 998877 CONFIRMATION 4421",
        ]
        render_lines_pdf(pdf_path, [page1])
        transactions = [
            _txn(
                "2026-03-12",
                "ONLINE BILL PAY XYZ CORP REF 998877 CONFIRMATION 4421",
                8_000,
                "purchase",
                "electronic withdrawals",
            ),
        ]
        return _golden(opening, 42_000, transactions)

    # -- fx --------------------------------------------------------------------------------------

    def _build_fx(self, pdf_path: Path, *, seed: int) -> dict[str, Any]:
        opening = 80_000
        page1 = [
            *_summary_lines(opening=opening, closing=76_000),
            format_row(_HEADER, _WIDTHS),
            "Electronic Withdrawals",
            _data_row(
                "03/08", "FOREIGN PURCHASE CAFE PARIS", debit=4_000, credit=None, balance=76_000
            ),
            "FOREIGN AMOUNT 45.00 EUR RATE 1.0921",
        ]
        render_lines_pdf(pdf_path, [page1])
        transactions = [
            {
                **_txn(
                    "2026-03-08",
                    "FOREIGN PURCHASE CAFE PARIS",
                    4_000,
                    "purchase",
                    "electronic withdrawals",
                ),
                "fx_amount_minor": 4_500,
                "fx_currency": "EUR",
                "fx_rate": 1.0921,
            },
        ]
        return _golden(opening, 76_000, transactions)

    # -- refund_and_payment -----------------------------------------------------------------------

    def _build_refund_and_payment(self, pdf_path: Path, *, seed: int) -> dict[str, Any]:
        opening = 120_000
        page1 = [
            *_summary_lines(opening=opening, closing=73_000),
            format_row(_HEADER, _WIDTHS),
            "Deposits and Additions",
            _data_row(
                "03/06", "MERCHANT REFUND WIDGET CO", debit=None, credit=3_000, balance=123_000
            ),
            "Electronic Withdrawals",
            _data_row(
                "03/18", "AUTOPAY CRD PMT VISA CARD", debit=50_000, credit=None, balance=73_000
            ),
        ]
        render_lines_pdf(pdf_path, [page1])
        transactions = [
            _txn(
                "2026-03-06",
                "MERCHANT REFUND WIDGET CO",
                -3_000,
                "refund",
                "deposits and additions",
            ),
            _txn(
                "2026-03-18",
                "AUTOPAY CRD PMT VISA CARD",
                50_000,
                "transfer",
                "electronic withdrawals",
            ),
        ]
        return _golden(opening, 73_000, transactions)

    # -- malformed ------------------------------------------------------------------------------

    def _build_malformed(self, pdf_path: Path, *, seed: int) -> dict[str, Any]:
        opening = 10_000
        page1 = [
            *_summary_lines(opening=opening, closing=9_000),
            format_row(_HEADER, _WIDTHS),
            "Electronic Withdrawals",
            # A value in BOTH the debit and credit column on the same row (no balance printed):
            # unparseable per §2c, must raise ParserError.
            _data_row("03/09", "BAD ROW BOTH COLUMNS", debit=1_000, credit=1_000, balance=None),
        ]
        render_lines_pdf(pdf_path, [page1])
        return {"expect_error": True}

    # -- no_summary -------------------------------------------------------------------------------

    def _build_no_summary(self, pdf_path: Path, *, seed: int) -> dict[str, Any]:
        page1 = [
            _BANK_NAME,
            "Transaction Detail",
            "Checking Account Statement",
            "",
            format_row(_HEADER, _WIDTHS),
            "Electronic Withdrawals",
            _data_row("03/09", "SOME PAYEE", debit=1_000, credit=None, balance=9_000),
        ]
        render_lines_pdf(pdf_path, [page1])
        return {"expect_error": True}


def _txn(
    posted_date: str, description: str, amount_minor: int, kind_hint: str, section: str
) -> dict[str, Any]:
    return {
        "posted_date": posted_date,
        "transaction_date": None,
        "description": description,
        "amount_minor": amount_minor,
        "currency": "USD",
        "fx_amount_minor": None,
        "fx_currency": None,
        "fx_rate": None,
        "kind_hint": kind_hint,
        "section": section,
        "issuer_category": None,
    }


def _golden(opening: int, closing: int, transactions: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "account_hint": {"account_type": "checking", "mask": None, "currency": "USD"},
        "period_start": "2026-03-01",
        "period_end": "2026-03-31",
        "stated_total_minor": None,
        "opening_balance_minor": opening,
        "closing_balance_minor": closing,
        "section_totals": [],
        "warnings": [],
        "transactions": transactions,
    }


BUILDER = LayoutDBuilder()
