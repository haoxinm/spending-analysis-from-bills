"""Tests for the W-2 parser (`tax_w2`): fixtures + goldens, error variants, detection, tolerance."""

from __future__ import annotations

import re

import pytest

from spend_analyzer.core.errors import ParserError
from spend_analyzer.ingest.tax.parsers.f1099_div import PARSER as DIV
from spend_analyzer.ingest.tax.parsers.f1099_int import PARSER as INT
from spend_analyzer.ingest.tax.parsers.f1099_nec_misc import PARSER as NEC_MISC
from spend_analyzer.ingest.tax.parsers.w2 import PARSER
from tests.ingest.tax_support import (
    assert_matches_golden,
    doc_from_lines,
    extract_doc,
    generated_pdf,
    load_golden,
)

_ID = "tax_w2"
_GOLDEN_VARIANTS = ("normal", "two_employers", "copies", "two_states", "corrected")
_SSN_SHAPE = re.compile(r"\d{3}-\d{2}-\d{4}")
_NINE_DIGITS = re.compile(r"\d{9}")


def _parse(variant: str, **kwargs: int | None):  # type: ignore[no-untyped-def]
    return PARSER.parse(extract_doc(generated_pdf(_ID, variant)), **kwargs)


@pytest.mark.parametrize("variant", _GOLDEN_VARIANTS)
def test_matches_golden(variant: str) -> None:
    assert_matches_golden(_parse(variant), load_golden(_ID, variant))


def test_normal_items_and_signs() -> None:
    (form,) = _parse("normal").forms
    assert form.form_type == "w2"
    assert form.tax_year == 2024
    assert form.payer_name == "Pinecrest Logistics LLC"
    assert form.payer_tin_last4 == "0001"
    assert form.account_last4 is None
    assert not form.is_corrected
    (wages,) = form.income
    assert (wages.category, wages.amount_minor, wages.box) == ("salary_wages", 8_543_210, "1")
    by_category = {(t.category, t.jurisdiction): t.amount_minor for t in form.taxes}
    assert by_category == {
        ("federal_income_tax_withheld", None): 1_187_640,
        ("social_security_tax", None): 549_519,
        ("medicare_tax", None): 128_517,
        ("state_income_tax_withheld", "CA"): 351_288,
        ("local_income_tax_withheld", "Testville"): 21_458,
    }
    assert all(t.amount_minor > 0 for t in form.taxes)


def test_two_employers_gives_two_forms() -> None:
    parsed = _parse("two_employers")
    assert [f.payer_name for f in parsed.forms] == [
        "Pinecrest Logistics LLC",
        "Alder Ridge Brewing Co",
    ]
    assert [f.payer_tin_last4 for f in parsed.forms] == ["0001", "0002"]


def test_three_copies_collapse_to_one_form() -> None:
    assert len(_parse("copies").forms) == 1


def test_two_state_lines_emit_two_items() -> None:
    (form,) = _parse("two_states").forms
    states = [(t.jurisdiction, t.amount_minor) for t in form.taxes if t.box == "17"]
    assert states == [("CA", 351_288), ("OR", 190_000)]


def test_corrected_flag_and_warning() -> None:
    parsed = _parse("corrected")
    (form,) = parsed.forms
    assert form.is_corrected
    assert len(form.warnings) == 1


def test_no_box1_is_an_error_without_document_text() -> None:
    with pytest.raises(ParserError) as info:
        _parse("no_box1")
    assert not re.search(r"\d{6,}", str(info.value))


def test_no_year_errors_unless_year_given() -> None:
    with pytest.raises(ParserError) as info:
        _parse("no_year")
    assert not re.search(r"\d{6,}", str(info.value))
    parsed = _parse("no_year", tax_year=2024)
    normal = _parse("normal")
    assert parsed.tax_year == 2024
    assert parsed.forms == normal.forms


def test_invalid_year_override_is_rejected() -> None:
    with pytest.raises(ParserError):
        _parse("normal", tax_year=1999)


@pytest.mark.parametrize("variant", _GOLDEN_VARIANTS)
def test_privacy_no_identifiers_leak(variant: str) -> None:
    parsed = _parse(variant)
    text = repr(parsed) + " ".join(parsed.warnings)
    assert not _SSN_SHAPE.search(text)
    assert not _NINE_DIGITS.search(text)
    assert "Testperson" not in text
    assert "5678" not in text


@pytest.mark.parametrize("variant", [*_GOLDEN_VARIANTS, "no_box1", "no_year"])
def test_detection(variant: str) -> None:
    doc = extract_doc(generated_pdf(_ID, variant))
    assert PARSER.detect(doc) > 0.5
    for other in (INT, DIV, NEC_MISC):
        assert other.detect(doc) <= 0.5


def test_detect_scores_and_never_raises() -> None:
    assert PARSER.detect(doc_from_lines(["Hello world", "Nothing here"])) == 0.0
    title_only = doc_from_lines(
        ["W-2 Wage and Tax Statement 2024", "b Employer identification number"]
    )
    assert PARSER.detect(title_only) == 0.6


def test_tolerates_label_wording_and_same_row_layout() -> None:
    lines = [
        "Form W-2 Wage and Tax Statement 2023",
        "Employee's social security number",
        "XXX-XX-1234",
        "Employer identification number (EIN)",
        "99-0000001",
        "Employer's name, address, and ZIP code",
        "Pinecrest Logistics LLC",
        "1 Wages, tips, other comp.   52,000.00   2 Federal income tax withheld   6,100.00",
        "4 Social security tax withheld 3,224.00   6 Medicare tax withheld 754.00",
    ]
    (form,) = PARSER.parse(doc_from_lines(lines)).forms
    assert form.tax_year == 2023
    assert form.payer_name == "Pinecrest Logistics LLC"
    assert form.payer_tin_last4 == "0001"
    assert form.income[0].amount_minor == 5_200_000
    assert {t.category: t.amount_minor for t in form.taxes} == {
        "federal_income_tax_withheld": 610_000,
        "social_security_tax": 322_400,
        "medicare_tax": 75_400,
    }


def test_zero_box1_is_kept_and_zero_withholding_dropped() -> None:
    lines = [
        "Wage and Tax Statement 2024",
        "Employer identification number",
        "Employee's social security number",
        "1 Wages, tips, other compensation   0.00   2 Federal income tax withheld   0.00",
    ]
    (form,) = PARSER.parse(doc_from_lines(lines)).forms
    assert [i.amount_minor for i in form.income] == [0]
    assert form.taxes == ()


def test_state_amount_without_readable_code_warns() -> None:
    label_row = (
        "15 State Employer's state ID number   16 State wages, tips, etc.   17 State income tax"
    )
    value_row = " " * label_row.index("State income tax") + "1,500.00"
    lines = [
        "Wage and Tax Statement 2024",
        "Employer identification number",
        "Employee's social security number",
        "1 Wages, tips, other compensation",
        "50,000.00",
        label_row,
        value_row,
    ]
    doc = doc_from_lines(lines)
    (form,) = PARSER.parse(doc).forms
    (state,) = (t for t in form.taxes if t.box == "17")
    assert state.jurisdiction == "XX"
    assert state.amount_minor == 150_000
    assert len(form.warnings) == 1
