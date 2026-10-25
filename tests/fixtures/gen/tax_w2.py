"""Synthetic Form W-2 fixtures (IRS box layout), layout id ``tax_w2``.

Variants: ``normal`` (all boxes, state and local), ``two_employers`` (two W-2s on two pages),
``copies`` (Copy B / Copy C / Copy 2 on one page), ``two_states`` (two box 15-17 lines),
``corrected`` (CORRECTED box checked), ``no_box1`` (box 1 blank: parse error) and ``no_year`` (no
year printed: parse error unless the year is supplied). All identities are invented (see
`tax_common`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from spend_analyzer.core.tax_types import (
    ParsedIncomeItem,
    ParsedTaxDocument,
    ParsedTaxForm,
    ParsedTaxItem,
)
from tests.fixtures.gen.irs_boxes import money_text
from tests.fixtures.gen.tax_common import (
    EMPLOYER_A,
    EMPLOYER_B,
    RECIPIENT_ADDRESS_LINES,
    RECIPIENT_SSN,
    BoxItem,
    Entity,
    build_golden,
    cell,
    last4,
    render_boxes_pdf,
    text_item,
)

_YEAR = 2024
_SRC = "W-2"
_PITCH = 19.0
_X0, _X0_LAST, _X1, _X2 = 36.0, 190.0, 236.0, 400.0
_W0, _W1, _W2 = 196.0, 160.0, 162.0
_CORRECTED_WARNING = "Form is marked as corrected; it may replace a form imported earlier."


@dataclass(frozen=True)
class StateLine:
    code: str
    state_id: str
    wages: int
    tax: int


@dataclass(frozen=True)
class W2Data:
    employer: Entity
    box1: int | None
    box2: int
    box3: int
    box4: int
    box5: int
    box6: int
    box12: str = ""
    states: tuple[StateLine, ...] = ()
    local: tuple[int, int, str] | None = None  # wages, tax, locality name
    corrected: bool = False
    copy_label: str = "Copy B - To Be Filed With Employee's FEDERAL Tax Return."
    show_year: bool = True
    employee_first: str = "Jordan Q."
    employee_last: str = "Testperson"
    extra: dict[str, str] = field(default_factory=dict)


def _w2_items(y_top: float, data: W2Data) -> list[BoxItem]:
    def y(row: int) -> float:
        return y_top + 14.0 + row * _PITCH

    def val(amount: int) -> str:
        return money_text(amount)

    year = f" {_YEAR}" if data.show_year else ""
    items: list[BoxItem] = []
    items += text_item(_X0, y_top, f"W-2 Wage and Tax Statement{year}")
    items += text_item(_X1, y_top, data.copy_label)

    # R1: a / OMB, VOID, CORRECTED
    items += cell(_X0, y(0), "a Employee's social security number", RECIPIENT_SSN, width=_W0 - 4)
    items += text_item(_X1, y(0), "OMB No. 1545-0008")
    corrected_box = "[X]" if data.corrected else "[ ]"
    items += text_item(_X2, y(0), f"[ ] VOID  {corrected_box} CORRECTED")
    # R2: b / 1 / 2
    items += cell(
        _X0, y(1), "b Employer identification number (EIN)", data.employer.ein, width=_W0 - 4
    )
    items += cell(
        _X1,
        y(1),
        "1 Wages, tips, other compensation",
        "" if data.box1 is None else val(data.box1),
        width=_W1 - 4,
    )
    items += cell(_X2, y(1), "2 Federal income tax withheld", val(data.box2), width=_W2 - 4)
    # R3-R5: c block lines coincide with value rows of boxes 3-8
    items += cell(
        _X0, y(2), "c Employer's name, address, and ZIP code", data.employer.name, width=_W0 - 4
    )
    items += cell(_X1, y(2), "3 Social security wages", val(data.box3), width=_W1 - 4)
    items += cell(_X2, y(2), "4 Social security tax withheld", val(data.box4), width=_W2 - 4)
    items += text_item(_X0, y(3) + 10.0, data.employer.address_lines[0])
    items += cell(_X1, y(3), "5 Medicare wages and tips", val(data.box5), width=_W1 - 4)
    items += cell(_X2, y(3), "6 Medicare tax withheld", val(data.box6), width=_W2 - 4)
    items += text_item(_X0, y(4) + 10.0, data.employer.address_lines[1])
    items += cell(_X1, y(4), "7 Social security tips", "", width=_W1 - 4)
    items += cell(_X2, y(4), "8 Allocated tips", "", width=_W2 - 4)
    # R6-R9
    items += cell(_X0, y(5), "d Control number", "", width=_W0 - 4)
    items += cell(_X2, y(5), "10 Dependent care benefits", "", width=_W2 - 4)
    items += cell(
        _X0, y(6), "e Employee's first name and initial", data.employee_first, width=_W0 - 4
    )
    items += cell(_X0_LAST, y(6), "Last name", data.employee_last, width=44.0)
    items += cell(_X1, y(6), "11 Nonqualified plans", "", width=_W1 - 4)
    items += cell(_X2, y(6), "12a See instructions for box 12", data.box12, width=_W2 - 4)
    items += cell(
        _X0, y(7), "f Employee's address and ZIP code", RECIPIENT_ADDRESS_LINES[0], width=_W0 - 4
    )
    items += cell(_X1, y(7), "13 Statutory employee", "[ ]", width=_W1 - 4)
    items += cell(_X2, y(7), "12b", "", width=_W2 - 4)
    items += text_item(_X0, y(8) + 10.0, RECIPIENT_ADDRESS_LINES[1])
    items += cell(_X1, y(8), "14 Other", "", width=_W1 - 4)
    # State table: 15 / 16 / 17, one value row per state
    items += cell(_X0, y(9), "15 State Employer's state ID number", "", width=_W0 - 4)
    items += cell(_X1, y(9), "16 State wages, tips, etc.", "", width=_W1 - 4)
    items += cell(_X2, y(9), "17 State income tax", "", width=_W2 - 4)
    for index, line in enumerate(data.states):
        vy = y(9) + 10.0 + 10.0 * index
        items += text_item(_X0, vy, f"{line.code} {line.state_id}")
        items += text_item(_X1, vy, val(line.wages))
        items += text_item(_X2, vy, val(line.tax))
    extra = 10.0 * max(0, len(data.states) - 1)
    local_y = y(10) + extra
    items += cell(
        _X0,
        local_y,
        "18 Local wages, tips, etc.",
        val(data.local[0]) if data.local else "",
        width=_W0 - 4,
    )
    items += cell(
        _X1, local_y, "19 Local income tax", val(data.local[1]) if data.local else "", width=_W1 - 4
    )
    items += cell(
        _X2, local_y, "20 Locality name", data.local[2] if data.local else "", width=_W2 - 4
    )
    return items


def _expected_form(data: W2Data) -> ParsedTaxForm:
    assert data.box1 is not None
    taxes: list[ParsedTaxItem] = []
    for category, amount, box, label in (
        ("federal_income_tax_withheld", data.box2, "2", "Federal income tax withheld"),
        ("social_security_tax", data.box4, "4", "Social security tax withheld"),
        ("medicare_tax", data.box6, "6", "Medicare tax withheld"),
    ):
        if amount:
            taxes.append(ParsedTaxItem(category, amount, _SRC, box, label))  # type: ignore[arg-type]
    for line in data.states:
        taxes.append(
            ParsedTaxItem(
                "state_income_tax_withheld",
                line.tax,
                _SRC,
                "17",
                "State income tax",
                jurisdiction=line.code,
            )
        )
    if data.local:
        taxes.append(
            ParsedTaxItem(
                "local_income_tax_withheld",
                data.local[1],
                _SRC,
                "19",
                "Local income tax",
                jurisdiction=data.local[2],
            )
        )
    return ParsedTaxForm(
        form_type="w2",
        tax_year=_YEAR,
        payer_name=data.employer.name,
        payer_tin_last4=last4(data.employer.ein),
        account_last4=None,
        is_corrected=data.corrected,
        filing_status=None,
        agi_minor=None,
        taxable_income_minor=None,
        income=(
            ParsedIncomeItem(
                "salary_wages", data.box1, _SRC, "1", "Wages, tips, other compensation"
            ),
        ),
        taxes=tuple(taxes),
        warnings=(_CORRECTED_WARNING,) if data.corrected else (),
    )


_CA = StateLine("CA", "5551234", 8_543_210, 351_288)
_OR = StateLine("OR", "7771234", 3_000_000, 190_000)

_NORMAL = W2Data(
    employer=EMPLOYER_A,
    box1=8_543_210,
    box2=1_187_640,
    box3=8_863_210,
    box4=549_519,
    box5=8_863_210,
    box6=128_517,
    box12="D 3,200.00",
    states=(_CA,),
    local=(8_543_210, 21_458, "Testville"),
)
_SECOND = W2Data(
    employer=EMPLOYER_B,
    box1=2_431_050,
    box2=210_400,
    box3=2_431_050,
    box4=150_725,
    box5=2_431_050,
    box6=35_250,
    states=(StateLine("OR", "7771234", 2_431_050, 138_015),),
)


class W2Builder:
    layout_id = "tax_w2"
    variants: tuple[str, ...] = (
        "normal",
        "two_employers",
        "copies",
        "two_states",
        "corrected",
        "no_box1",
        "no_year",
    )

    def build(self, out_dir: Path, *, variant: str, seed: int) -> dict[str, Any]:
        pdf_path = out_dir / f"{self.layout_id}_{variant}.pdf"
        pages: list[list[BoxItem]]
        forms: list[W2Data]
        if variant == "normal":
            forms = [_NORMAL]
            pages = [_w2_items(30.0, _NORMAL)]
        elif variant == "two_employers":
            forms = [_NORMAL, _SECOND]
            pages = [_w2_items(30.0, _NORMAL), _w2_items(30.0, _SECOND)]
        elif variant == "copies":
            base = W2Data(**{**_NORMAL.__dict__, "local": None})
            labels = (
                "Copy B - To Be Filed With Employee's FEDERAL Tax Return.",
                "Copy C - For EMPLOYEE'S RECORDS.",
                "Copy 2 - To Be Filed With Employee's State, City, or Local Income Tax Return.",
            )
            page: list[BoxItem] = []
            for index, label in enumerate(labels):
                page += _w2_items(
                    30.0 + index * 245.0, W2Data(**{**base.__dict__, "copy_label": label})
                )
            forms = [base]
            pages = [page]
        elif variant == "two_states":
            data = W2Data(**{**_NORMAL.__dict__, "states": (_CA, _OR), "local": None})
            forms = [data]
            pages = [_w2_items(30.0, data)]
        elif variant == "corrected":
            data = W2Data(**{**_NORMAL.__dict__, "corrected": True})
            forms = [data]
            pages = [_w2_items(30.0, data)]
        elif variant == "no_box1":
            render_boxes_pdf(
                pdf_path, [_w2_items(30.0, W2Data(**{**_NORMAL.__dict__, "box1": None}))]
            )
            return {"expect_error": True}
        elif variant == "no_year":
            render_boxes_pdf(
                pdf_path, [_w2_items(30.0, W2Data(**{**_NORMAL.__dict__, "show_year": False}))]
            )
            return {"expect_error": True}
        else:
            raise ValueError(f"unknown variant {variant!r}")
        render_boxes_pdf(pdf_path, pages)
        doc = ParsedTaxDocument(
            tax_year=_YEAR,
            forms=tuple(_expected_form(d) for d in forms),
        )
        warnings = [w for f in doc.forms for w in f.warnings]
        return build_golden(doc, expected_warnings=warnings)


BUILDER = W2Builder()
