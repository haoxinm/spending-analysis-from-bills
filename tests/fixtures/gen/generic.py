"""Fixture generator for the generic fallback parser (P1-B).

Builds synthetic PDFs for both amount shapes the generic parser recognizes (§2c, A26): a single
signed-amount column (card-style) and a debit/credit column pair with a running balance (bank-
style), plus the malformed/no-summary edge cases every layout offers and the three layout-
independent fixtures P1-B additionally owns.

Directory and naming follow the orchestrator's ruling for every layout WP: fixtures and goldens
live under the parser id, i.e. ``generic_table`` (this parser's `StatementParser.id`), matching
the frozen `tests/generate_fixtures.py` (``out_root / builder.layout_id``).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.pdfgen import canvas

from tests.fixtures.gen.base import format_row, render_lines_pdf

#: Matches the generic parser's `StatementParser.id` (P1-B's `generic_table.generic_table`).
_LAYOUT_ID = "generic_table"


def _iso(printed_date: str) -> str:
    """``MM/DD/YYYY`` (as printed on every fixture row) -> ISO ``YYYY-MM-DD`` (as
    `RawTransaction.posted_date` will report it), so the golden matches the parser's output."""
    return datetime.strptime(printed_date, "%m/%d/%Y").date().isoformat()


_CARD_WIDTHS = (10, 32, 14)
_BANK_WIDTHS = (10, 26, 10, 10, 12)


def _card_row(date: str, description: str, amount: str) -> str:
    return format_row([date, description, amount], _CARD_WIDTHS)


def _bank_row(date: str, description: str, debit: str, credit: str, balance: str) -> str:
    return format_row([date, description, debit, credit, balance], _BANK_WIDTHS)


# --------------------------------------------------------------------------------------------
# Card-style (signed amount column) variants
# --------------------------------------------------------------------------------------------

#: (date, description, printed amount, expected signed amount_minor)
_NORMAL_ROWS: tuple[tuple[str, str, str, int], ...] = (
    ("01/03/2026", "GROCERY MART", "45.10", 4510),
    ("01/05/2026", "COFFEE SHOP DOWNTOWN", "12.34", 1234),
    ("01/09/2026", "ONLINE BOOKSTORE", "29.99", 2999),
    ("01/15/2026", "REFUND ONLINE STORE", "(5.00)", -500),
    ("01/20/2026", "PAYMENT THANK YOU", "15.00 CR", -1500),
    ("01/22/2026", "STREAMING SERVICE", "15.99", 1599),
    ("01/25/2026", "HARDWARE STORE", "59.95", 5995),
    ("01/28/2026", "RESTAURANT DOWNTOWN", "10.10", 1010),
)


def _build_normal(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    total = sum(row[3] for row in _NORMAL_ROWS)
    header = [
        "INVENTED CARD CO.",
        "Statement Period: 01/01/2026 to 01/31/2026",
        "Previous Balance: $0.00",
        f"New Balance: ${total / 100:.2f}",
        "",
        "",
        _card_row("Date", "Description", "Amount"),
    ]
    page1 = [*header, *(_card_row(d, desc, amt) for d, desc, amt, _ in _NORMAL_ROWS[:4])]
    page2 = [_card_row("Date", "Description", "Amount")] + [
        _card_row(d, desc, amt) for d, desc, amt, _ in _NORMAL_ROWS[4:]
    ]
    pdf_path = out_dir / f"{_LAYOUT_ID}_normal.pdf"
    render_lines_pdf(pdf_path, [page1, page2])
    golden = {
        "period_start": "2026-01-01",
        "period_end": "2026-01-31",
        "opening_balance_minor": 0,
        "closing_balance_minor": total,
        "account_type": "credit",
        "transactions": [
            {"posted_date": _iso(d), "amount_minor": amt, "description": desc}
            for d, desc, _, amt in _NORMAL_ROWS
        ],
    }
    return pdf_path, golden


def _build_multiline(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    rows = [
        ("01/02/2026", "GYM MEMBERSHIP", "40.00", 4000, "auto-renew monthly plan"),
        ("01/04/2026", "PHARMACY DOWNTOWN", "18.25", 1825, None),
        ("01/10/2026", "REFUND PHARMACY", "(18.25)", -1825, "return processed"),
        ("01/14/2026", "GROCERY MART", "22.00", 2200, None),
    ]
    total = sum(r[3] for r in rows)
    lines = [
        "Previous Balance: $0.00",
        f"New Balance: ${total / 100:.2f}",
        "",
        "",
        _card_row("Date", "Description", "Amount"),
    ]
    descriptions = []
    for date, desc, amt, _, cont in rows:
        lines.append(_card_row(date, desc, amt))
        full_desc = desc
        if cont is not None:
            lines.append(cont)
            full_desc = f"{desc} {cont}"
        descriptions.append(full_desc)
    pdf_path = out_dir / f"{_LAYOUT_ID}_multiline.pdf"
    render_lines_pdf(pdf_path, [lines])
    golden = {
        "opening_balance_minor": 0,
        "closing_balance_minor": total,
        "transactions": [
            {"posted_date": _iso(d), "amount_minor": amt, "description": desc}
            for (d, _, _, amt, _), desc in zip(rows, descriptions, strict=True)
        ],
    }
    return pdf_path, golden


def _build_fx(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    rows = [
        ("01/02/2026", "FOREIGN MERCHANT PARIS", "27.40", 2740, "orig amt 10.50 eur"),
        ("01/06/2026", "DOMESTIC MERCHANT", "15.00", 1500, None),
        ("01/12/2026", "REFUND FOREIGN MERCHANT", "(5.00)", -500, "orig amt 4.50 eur"),
        ("01/18/2026", "DOMESTIC MERCHANT TWO", "20.00", 2000, None),
    ]
    total = sum(r[3] for r in rows)
    lines = [
        "Previous Balance: $0.00",
        f"New Balance: ${total / 100:.2f}",
        "",
        "",
        _card_row("Date", "Description", "Amount"),
    ]
    descriptions = []
    for date, desc, amt, _, cont in rows:
        lines.append(_card_row(date, desc, amt))
        full_desc = desc
        if cont is not None:
            lines.append(cont)
            full_desc = f"{desc} {cont}"
        descriptions.append(full_desc)
    pdf_path = out_dir / f"{_LAYOUT_ID}_fx.pdf"
    render_lines_pdf(pdf_path, [lines])
    golden = {
        "opening_balance_minor": 0,
        "closing_balance_minor": total,
        "transactions": [
            {"posted_date": _iso(d), "amount_minor": amt, "description": desc}
            for (d, _, _, amt, _), desc in zip(rows, descriptions, strict=True)
        ],
    }
    return pdf_path, golden


def _build_refund_and_payment(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    rows: tuple[tuple[str, str, str, int], ...] = (
        ("01/02/2026", "GROCERY MART", "50.00", 5000),
        ("01/05/2026", "REFUND GROCERY MART", "(10.00)", -1000),
        ("01/10/2026", "PAYMENT THANK YOU", "25.00 CR", -2500),
        ("01/15/2026", "RESTAURANT", "30.00", 3000),
    )
    total = sum(r[3] for r in rows)
    lines = [
        "Previous Balance: $0.00",
        f"New Balance: ${total / 100:.2f}",
        "",
        "",
        _card_row("Date", "Description", "Amount"),
        *(_card_row(d, desc, amt) for d, desc, amt, _ in rows),
    ]
    pdf_path = out_dir / f"{_LAYOUT_ID}_refund_and_payment.pdf"
    render_lines_pdf(pdf_path, [lines])
    golden = {
        "opening_balance_minor": 0,
        "closing_balance_minor": total,
        "transactions": [
            {"posted_date": _iso(d), "amount_minor": amt, "description": desc}
            for d, desc, _, amt in rows
        ],
    }
    return pdf_path, golden


def _build_no_summary(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    # Same transaction content as `normal`, minus the statement period and balance lines. Every
    # date here already carries an explicit year, so the generic parser needs neither the
    # period (for year inference) nor the balances (for reconciliation) to parse successfully —
    # only the running-balance/balance-equation checks are skipped.
    lines = [
        _card_row("Date", "Description", "Amount"),
        *(_card_row(d, desc, amt) for d, desc, amt, _ in _NORMAL_ROWS),
    ]
    pdf_path = out_dir / f"{_LAYOUT_ID}_no_summary.pdf"
    render_lines_pdf(pdf_path, [lines])
    golden = {
        "period_start": None,
        "period_end": None,
        "opening_balance_minor": None,
        "closing_balance_minor": None,
        "transactions": [
            {"posted_date": _iso(d), "amount_minor": amt, "description": desc}
            for d, desc, _, amt in _NORMAL_ROWS
        ],
    }
    return pdf_path, golden


def _build_malformed(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    # Only two transaction-shaped rows: `locate_table_bands` needs a run of >= 3, so no table is
    # even located and the parser raises `UnsupportedLayoutError` (§ generic fallback item 5).
    lines = [
        _card_row("Date", "Description", "Amount"),
        _card_row("01/03/2026", "GROCERY MART", "45.10"),
        _card_row("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
    ]
    pdf_path = out_dir / f"{_LAYOUT_ID}_malformed.pdf"
    render_lines_pdf(pdf_path, [lines])
    return pdf_path, {"raises": "UnsupportedLayoutError"}


# --------------------------------------------------------------------------------------------
# Bank-style (debit/credit column pair + running balance) variant
# --------------------------------------------------------------------------------------------

#: (date, description, debit, credit, running balance, expected signed amount_minor)
_BANK_ROWS: tuple[tuple[str, str, str, str, str, int], ...] = (
    ("01/03/2026", "ATM WITHDRAWAL", "40.00", "", "960.00", 4000),
    ("01/06/2026", "PAYCHECK DEPOSIT", "", "500.00", "1,460.00", -50000),
    ("01/10/2026", "GROCERY STORE PURCHASE", "85.30", "", "1,374.70", 8530),
    ("01/15/2026", "REFUND GROCERY STORE", "", "10.00", "1,384.70", -1000),
    ("01/20/2026", "ONLINE SHOPPING", "60.00", "", "1,324.70", 6000),
    ("01/25/2026", "CARD AUTOPAY PAYMENT", "200.00", "", "1,124.70", 20000),
)


def _build_bank_debit_credit(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    opening = 100_000
    closing = 112_470
    lines = [
        "INVENTED BANK.",
        "Statement Period: 01/01/2026 through 01/31/2026",
        "Beginning Balance: $1,000.00",
        "Ending Balance: $1,124.70",
        "",
        "",
        _bank_row("Date", "Description", "Withdrawals", "Deposits", "Balance"),
        *(_bank_row(d, desc, debit, credit, bal) for d, desc, debit, credit, bal, _ in _BANK_ROWS),
    ]
    pdf_path = out_dir / f"{_LAYOUT_ID}_bank_debit_credit.pdf"
    render_lines_pdf(pdf_path, [lines])
    golden = {
        "period_start": "2026-01-01",
        "period_end": "2026-01-31",
        "opening_balance_minor": opening,
        "closing_balance_minor": closing,
        "account_type": "checking",
        "transactions": [
            {"posted_date": _iso(d), "amount_minor": amt, "description": desc}
            for d, desc, _, _, _, amt in _BANK_ROWS
        ],
    }
    return pdf_path, golden


# --------------------------------------------------------------------------------------------
# Layout-independent fixtures (P1-B additionally owns these three)
# --------------------------------------------------------------------------------------------


def _build_no_text_layer(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    """An image-only page: a filled rectangle, no drawn text, so the text layer is empty."""
    pdf_path = out_dir / f"{_LAYOUT_ID}_no_text_layer.pdf"
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(pdf_path))
    c.setFillGray(0.6)
    c.rect(50, 500, 400, 200, fill=1, stroke=0)
    c.showPage()
    c.save()
    return pdf_path, {"kind": "no_text_layer"}


def _build_encrypted(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    """A password-protected PDF (opening it without the password must raise)."""
    pdf_path = out_dir / f"{_LAYOUT_ID}_encrypted.pdf"
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    encryption = StandardEncryption("statement", ownerPassword="owner-secret", canPrint=1)
    c = canvas.Canvas(str(pdf_path), encrypt=encryption)
    c.drawString(50, 700, "This statement is password-protected.")
    c.showPage()
    c.save()
    return pdf_path, {"kind": "encrypted"}


def _build_empty(out_dir: Path, seed: int) -> tuple[Path, dict[str, Any]]:
    """A single, entirely blank page: no text, no drawing at all."""
    pdf_path = out_dir / f"{_LAYOUT_ID}_empty.pdf"
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(pdf_path))
    c.showPage()
    c.save()
    return pdf_path, {"kind": "empty"}


# --------------------------------------------------------------------------------------------
# LayoutBuilder
# --------------------------------------------------------------------------------------------

_BUILDERS = {
    "normal": _build_normal,
    "multiline": _build_multiline,
    "fx": _build_fx,
    "refund_and_payment": _build_refund_and_payment,
    "malformed": _build_malformed,
    "no_summary": _build_no_summary,
    "bank_debit_credit": _build_bank_debit_credit,
    "no_text_layer": _build_no_text_layer,
    "encrypted": _build_encrypted,
    "empty": _build_empty,
}


class GenericTableBuilder:
    """`LayoutBuilder` for the generic fallback parser (P1-B).

    Beyond the six variants every layout offers, this builder adds ``bank_debit_credit`` (the
    generic parser's second amount shape, A26) and the three layout-independent fixtures P1-B
    additionally owns: ``no_text_layer``, ``encrypted``, ``empty``.
    """

    layout_id = _LAYOUT_ID
    variants = tuple(_BUILDERS.keys())

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        builder = _BUILDERS[variant]
        _pdf_path, golden = builder(out_dir, seed)
        return golden


generic_table_builder = GenericTableBuilder()
