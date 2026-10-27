"""IRS-style box layouts for the single-form 1099 fixtures (INT, DIV, NEC, MISC).

Not a builder module (no `layout_id`/`variants`/`build`). Renders the usual 1099 arrangement with
`tax_common.render_boxes_pdf`: payer block, TIN pair, recipient block and account number down the
left, the numbered boxes in two columns on the right (small label, value beneath it inside the same
x-range), and the form title block (OMB number, calendar year, form name) at the top right.
Everything printed is invented.

    Cell = (label, continuation | None, value)       value "" prints a blank box
    render_1099(path, *, heading, subtitle, omb, rev, year_text, corrected, payer, recipient_tin,
                account_number, rows)
        rows[i] = (col0_cell | None, col1_cell | None, col2_cell | None) for i in 0..N-1.
        Row i is printed at ROW_Y[i]; rows 0-5 share the page with the left-hand payer /
        TIN / recipient / address / account blocks, so col0 cells are only for rows >= 6.
    money_text(minor_units) -> "1,234.56"
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from tests.fixtures.gen.tax_common import (
    RECIPIENT_ADDRESS_LINES,
    RECIPIENT_NAME,
    RECIPIENT_SSN,
    BoxItem,
    Entity,
    cell,
    render_boxes_pdf,
    text_item,
)

Cell = tuple[str, str | None, str]
Row = tuple[Cell | None, Cell | None, Cell | None]

X0, X0B, X1, X2 = 36.0, 140.0, 254.0, 404.0
W0, W0B, W1, W2 = 214.0, 110.0, 146.0, 160.0
ROW_Y = (46.0, 100.0, 130.0, 160.0, 190.0, 220.0, 250.0, 280.0, 310.0, 340.0, 370.0, 400.0)
_CONT_DY = 8.0


def money_text(minor: int) -> str:
    """Printed amount for `minor` units: ``123456`` -> ``"1,234.56"``."""
    return f"{minor // 100:,}.{minor % 100:02d}"


def _cell(
    x: float, y: float, width: float, spec: Cell, value_dy: float, font_size: float = 7.0
) -> list[BoxItem]:
    label, continuation, value = spec
    items = cell(x, y, label, value, width=width, value_dy=value_dy, font_size=font_size)
    if continuation:
        items += cell(x, y + _CONT_DY, continuation, "", width=width, font_size=font_size)
    return items


def _payer_block(y: float, payer: Entity, x0: float = X0) -> list[BoxItem]:
    items: list[BoxItem] = []
    items += text_item(x0, y, "PAYER'S name, street address, city or town, state")
    items += text_item(x0, y + 8, "or province, country, ZIP or foreign postal")
    items += text_item(x0, y + 16, "code, and telephone no.")
    items += text_item(x0, y + 24, payer.name)
    items += text_item(x0, y + 32, payer.address_lines[0])
    items += text_item(x0, y + 40, payer.address_lines[1])
    return items


def form_items(
    *,
    heading: str,
    subtitle: str,
    omb: str,
    rev: str,
    year_text: str | None,
    corrected: bool,
    payer: Entity,
    recipient_tin: str = RECIPIENT_SSN,
    account_number: str | None,
    rows: Sequence[Row],
    x_off: float = 0.0,
    y_off: float = 0.0,
    scale: float = 1.0,
) -> list[BoxItem]:
    """The text items of one single-form 1099 page, shifted by ``(x_off, y_off)``.

    ``scale`` shrinks every x position and cell width (and the font the caller must render with:
    ``7 * scale``) so that two forms fit side by side on a landscape page; row positions (y) are
    unchanged. With the defaults the items are exactly those of the original single-form page."""
    fs = 7.0 * scale

    def sx(x: float) -> float:
        return x_off + x * scale

    def sy(y: float) -> float:
        return y_off + y

    x0, x0b, x1, x2 = sx(X0), sx(X0B), sx(X1), sx(X2)
    w0, w0b, w1, w2 = W0 * scale, W0B * scale, W1 * scale, W2 * scale
    items: list[BoxItem] = []
    items += text_item(
        x0, sy(24.0), "[X] CORRECTED (if checked)" if corrected else "[ ] CORRECTED (if checked)"
    )
    items += text_item(x2, sy(24.0), omb)
    if year_text:
        items += text_item(x2, sy(34.0), f"For calendar year {year_text}")
    items += text_item(x2, sy(44.0), heading)
    items += text_item(x2, sy(54.0), subtitle)
    items += text_item(x2, sy(64.0), rev)

    items += _payer_block(sy(ROW_Y[0]), payer, x0)
    items += cell(
        x0, sy(ROW_Y[1]), "PAYER'S TIN", payer.ein, width=w0b - 4, value_dy=18.0, font_size=fs
    )
    items += cell(
        x0b,
        sy(ROW_Y[1]),
        "RECIPIENT'S TIN",
        recipient_tin,
        width=w0b - 4,
        value_dy=18.0,
        font_size=fs,
    )
    items += cell(x0, sy(ROW_Y[2]), "RECIPIENT'S name", RECIPIENT_NAME, width=w0 - 4, font_size=fs)
    items += cell(
        x0,
        sy(ROW_Y[3]),
        "Street address (including apt. no.)",
        RECIPIENT_ADDRESS_LINES[0],
        width=w0 - 4,
        font_size=fs,
    )
    items += cell(
        x0,
        sy(ROW_Y[4]),
        "City or town, state or province, country,",
        "",
        width=w0 - 4,
        font_size=fs,
    )
    items += cell(
        x0,
        sy(ROW_Y[4] + _CONT_DY),
        "and ZIP or foreign postal code",
        RECIPIENT_ADDRESS_LINES[1],
        width=w0 - 4,
        value_dy=10.0,
        font_size=fs,
    )
    if account_number is not None:
        items += cell(
            x0,
            sy(ROW_Y[5]),
            "Account number (see instructions)",
            account_number,
            width=w0 - 4,
            font_size=fs,
        )

    for index, (c0, c1, c2) in enumerate(rows):
        specs = [(x0, w0, c0), (x1, w1, c1), (x2, w2, c2)]
        if index == 0:
            value_dy = 24.0
        elif any(spec is not None and spec[1] for _, _, spec in specs):
            value_dy = 18.0
        else:
            value_dy = 10.0
        for x, width, spec in specs:
            if spec is not None:
                items += _cell(x, sy(ROW_Y[index]), width - 4, spec, value_dy, fs)
    return items


def render_1099(
    path: Path,
    *,
    heading: str,
    subtitle: str,
    omb: str,
    rev: str,
    year_text: str | None,
    corrected: bool,
    payer: Entity,
    recipient_tin: str = RECIPIENT_SSN,
    account_number: str | None,
    rows: Sequence[Row],
) -> None:
    """Render one single-form 1099 page (see the module docstring)."""
    items = form_items(
        heading=heading,
        subtitle=subtitle,
        omb=omb,
        rev=rev,
        year_text=year_text,
        corrected=corrected,
        payer=payer,
        recipient_tin=recipient_tin,
        account_number=account_number,
        rows=rows,
    )
    render_boxes_pdf(path, [items])
