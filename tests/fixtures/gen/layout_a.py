"""`LayoutBuilder` for Layout A (`layout_a_credit`), P1-B1.

Renders synthetic ``Transactions`` tables shaped exactly like §2c's Layout A: a
``Reference Number`` / ``Account Number`` column pair, four labelled sections each closed by a
``TOTAL <SECTION> FOR THIS PERIOD`` line, and a summary block with the statement period and
opening/closing balances. Invented bank name only ("Fixture Bank"), never a real issuer (§2c).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

from tests.fixtures.gen.base import format_row, render_lines_pdf

#: Column widths in characters, matching `_COLUMN_ROLES` in `layout_a_credit.py`:
#: (transaction date, posting date, description, reference number, account number, amount, total)
_WIDTHS = (11, 11, 34, 17, 15, 10, 10)
_FONT_SIZE = 7.0
_LINE_HEIGHT = 11.0

_HEADER_CELLS = (
    "Trans Date",
    "Post Date",
    "Description",
    "Reference Number",
    "Account Number",
    "Amount",
    "Total",
)

_SECTIONS = (
    "Payments and Other Credits",
    "Purchases and Adjustments",
    "Fees",
    "Interest Charged",
)


def _money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) / 100:,.2f}"


def _date_str(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def _row(cells: tuple[str, str, str, str, str, str, str]) -> str:
    return format_row(list(cells), _WIDTHS)


def _section_lines(
    heading: str,
    rows: list[tuple[date, date, str, int]],
    *,
    running_total_start: int,
    fx: dict[int, tuple[int, str, float]] | None = None,
    extra_continuation: dict[int, str] | None = None,
) -> tuple[list[str], int]:
    """Render one section's lines. Returns (lines, section_total_minor)."""
    fx = fx or {}
    extra_continuation = extra_continuation or {}
    lines = [heading]
    running = running_total_start
    section_total = 0
    for i, (tx_date, post_date, desc, amount_minor) in enumerate(rows):
        running += amount_minor
        section_total += amount_minor
        ref = f"REF{1000 + i:07d}"
        acct = f"XXXX{5678 + i:04d}"[-8:]
        lines.append(
            _row(
                (
                    _date_str(tx_date),
                    _date_str(post_date),
                    desc,
                    ref,
                    acct,
                    _money(amount_minor),
                    _money(running),
                )
            )
        )
        if i in extra_continuation:
            lines.append(_row(("", "", extra_continuation[i], "", "", "", "")))
        if i in fx:
            fx_minor, fx_currency, fx_rate = fx[i]
            lines.append(f"{fx_minor / 100:,.2f} {fx_currency} X {fx_rate}")
    lines.append(f"TOTAL {heading.upper()} FOR THIS PERIOD    {_money(section_total)}")
    return lines, running


def _summary_lines(
    period_start: date, period_end: date, opening_minor: int, closing_minor: int
) -> list[str]:
    return [
        "",
        f"Statement Period: {_date_str(period_start)} - {_date_str(period_end)}",
        f"Previous Balance: ${opening_minor / 100:,.2f}",
        f"New Balance: ${closing_minor / 100:,.2f}",
    ]


class LayoutABuilder:
    """Synthetic fixture generator for `layout_a_credit`."""

    layout_id = "layout_a_credit"
    variants = ("normal", "multiline", "fx", "refund_and_payment", "malformed", "no_summary")

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        build_variant: Callable[..., dict[str, Any]] = getattr(self, f"_build_{variant}")
        return build_variant(out_dir, seed=seed)

    # ------------------------------------------------------------------------------------
    # Shared scaffolding
    # ------------------------------------------------------------------------------------

    def _base_case(self) -> dict[str, Any]:
        return {
            "period_start": date(2026, 1, 1),
            "period_end": date(2026, 1, 31),
            "opening_balance_minor": 100000,
            "payments": [
                (date(2026, 1, 3), date(2026, 1, 4), "ONLINE PAYMENT - THANK YOU", -50000)
            ],
            "purchases": [
                (date(2026, 1, 5), date(2026, 1, 5), "COFFEE SHOP SEATTLE WA", 1234),
                (date(2026, 1, 6), date(2026, 1, 6), "GROCERY MART ANYTOWN US", 5678),
                (date(2026, 1, 7), date(2026, 1, 7), "MERCHANDISE RETURN CREDIT", -2000),
            ],
            "fees": [(date(2026, 1, 10), date(2026, 1, 10), "LATE FEE", 3500)],
            "interest": [
                (date(2026, 1, 15), date(2026, 1, 15), "INTEREST CHARGE ON PURCHASES", 542)
            ],
        }

    def _render(
        self,
        out_dir: Path,
        variant: str,
        case: dict[str, Any],
        *,
        include_summary: bool = True,
        fx: dict[str, dict[int, tuple[int, str, float]]] | None = None,
        continuation: dict[str, dict[int, str]] | None = None,
    ) -> dict[str, Any]:
        fx = fx or {}
        continuation = continuation or {}
        lines: list[str] = ["Fixture Bank", "", "Transactions", _row(_HEADER_CELLS)]

        running = case["opening_balance_minor"]
        section_totals: list[tuple[str, int]] = []
        transactions: list[dict[str, Any]] = []
        mask = None

        rows_by_section = {
            "Payments and Other Credits": case["payments"],
            "Purchases and Adjustments": case["purchases"],
            "Fees": case["fees"],
            "Interest Charged": case["interest"],
        }
        for section in _SECTIONS:
            rows = rows_by_section[section]
            section_lines, running = _section_lines(
                section,
                rows,
                running_total_start=running,
                fx=fx.get(section),
                extra_continuation=continuation.get(section),
            )
            lines.extend(section_lines)
            section_total = sum(r[3] for r in rows)
            section_totals.append((section, section_total))
            for i, (tx_date, post_date, desc, amount_minor) in enumerate(rows):
                if mask is None:
                    mask = f"{5678 + i:04d}"
                kind_hint = _kind_hint(section, amount_minor)
                full_desc = desc
                if section in continuation and i in continuation[section]:
                    full_desc = f"{desc} {continuation[section][i]}"
                fx_fields: dict[str, Any] = {
                    "fx_amount_minor": None,
                    "fx_currency": None,
                    "fx_rate": None,
                }
                if section in fx and i in fx[section]:
                    fx_minor, fx_currency, fx_rate = fx[section][i]
                    fx_fields = {
                        "fx_amount_minor": fx_minor,
                        "fx_currency": fx_currency,
                        "fx_rate": fx_rate,
                    }
                transactions.append(
                    {
                        "posted_date": post_date.isoformat(),
                        "transaction_date": tx_date.isoformat(),
                        "description": full_desc,
                        "amount_minor": amount_minor,
                        "currency": "USD",
                        "kind_hint": kind_hint,
                        "section": section,
                        **fx_fields,
                    }
                )
        closing_balance = running

        if include_summary:
            lines.extend(
                _summary_lines(
                    case["period_start"],
                    case["period_end"],
                    case["opening_balance_minor"],
                    closing_balance,
                )
            )

        pdf_path = out_dir / f"{self.layout_id}_{variant}.pdf"
        render_lines_pdf(
            pdf_path,
            [lines],
            font_size=_FONT_SIZE,
            line_height=_LINE_HEIGHT,
        )

        return {
            "period_start": case["period_start"].isoformat() if include_summary else None,
            "period_end": case["period_end"].isoformat() if include_summary else None,
            "opening_balance_minor": case["opening_balance_minor"] if include_summary else None,
            "closing_balance_minor": closing_balance if include_summary else None,
            "section_totals": section_totals,
            "transactions": transactions,
            "mask": mask,
        }

    # ------------------------------------------------------------------------------------
    # Variants
    # ------------------------------------------------------------------------------------

    def _build_normal(self, out_dir: Path, *, seed: int) -> dict[str, Any]:
        case = self._base_case()
        # Second page: an extra, otherwise-identical purchase, to exercise multi-page tables.
        case["purchases"].append(
            (date(2026, 1, 20), date(2026, 1, 20), "HARDWARE STORE ANYTOWN US", 999)
        )
        return self._render(out_dir, "normal", case)

    def _build_multiline(self, out_dir: Path, *, seed: int) -> dict[str, Any]:
        case = self._base_case()
        case["purchases"][0] = (
            date(2026, 1, 5),
            date(2026, 1, 5),
            "AMAZON MARKETPLACE",
            1234,
        )
        continuation = {"Purchases and Adjustments": {0: "ORDER #123-4567890 SEATTLE WA"}}
        return self._render(out_dir, "multiline", case, continuation=continuation)

    def _build_fx(self, out_dir: Path, *, seed: int) -> dict[str, Any]:
        case = self._base_case()
        case["purchases"][0] = (date(2026, 1, 5), date(2026, 1, 5), "PARIS BISTRO PARIS FR", 4500)
        fx = {"Purchases and Adjustments": {0: (4000, "EUR", 1.125)}}
        return self._render(out_dir, "fx", case, fx=fx)

    def _build_refund_and_payment(self, out_dir: Path, *, seed: int) -> dict[str, Any]:
        case = self._base_case()
        case["payments"] = [
            (date(2026, 1, 3), date(2026, 1, 4), "ONLINE PAYMENT - THANK YOU", -50000),
            (date(2026, 1, 8), date(2026, 1, 9), "MERCHANDISE REFUND STORE X", -1500),
        ]
        return self._render(out_dir, "refund_and_payment", case)

    def _build_malformed(self, out_dir: Path, *, seed: int) -> dict[str, Any]:
        case = self._base_case()
        lines: list[str] = ["Fixture Bank", "", "Transactions", _row(_HEADER_CELLS)]
        lines.append("Payments and Other Credits")
        lines.append(
            _row(
                (
                    "01/03/2026",
                    "01/04/2026",
                    "ONLINE PAYMENT - THANK YOU",
                    "REF1000000",
                    "XXXX5678",
                    "N/A",  # unparseable amount -> ParserError
                    "0.00",
                )
            )
        )
        lines.append("TOTAL PAYMENTS AND OTHER CREDITS FOR THIS PERIOD    -500.00")
        lines.extend(
            _summary_lines(
                case["period_start"], case["period_end"], case["opening_balance_minor"], 0
            )
        )
        pdf_path = out_dir / f"{self.layout_id}_malformed.pdf"
        render_lines_pdf(pdf_path, [lines], font_size=_FONT_SIZE, line_height=_LINE_HEIGHT)
        return {"malformed": True}

    def _build_no_summary(self, out_dir: Path, *, seed: int) -> dict[str, Any]:
        case = self._base_case()
        return self._render(out_dir, "no_summary", case, include_summary=False)


def _kind_hint(section: str, amount_minor: int) -> str:
    if section == "Payments and Other Credits":
        return "payment_or_refund"
    if section == "Fees":
        return "fee"
    if section == "Interest Charged":
        return "interest"
    return "adjustment" if amount_minor < 0 else "purchase"


builder = LayoutABuilder()

__all__ = ["LayoutABuilder", "builder"]
