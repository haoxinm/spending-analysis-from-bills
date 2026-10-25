"""`import_tax_document`: persistence, idempotency, dedupe, failure statuses, PDF retention."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from spend_analyzer.config import PrivacyConfig, Settings, save_settings
from spend_analyzer.core.paths import extract_cache_dir, statements_dir
from spend_analyzer.db.models import IncomeItem, TaxDocument, TaxForm, TaxItem, User
from spend_analyzer.ingest.tax.pipeline import (
    UNSUPPORTED_MESSAGE,
    delete_tax_document,
    import_tax_document,
)
from tests.ingest.tax_support import generated_pdf

_SSN_SHAPE = re.compile(r"\d{3}-\d{2}-\d{4}")


def _user(session: Session, name: str = "alice") -> int:
    user = User(name=name)
    session.add(user)
    session.flush()
    return user.id


def _import(session: Session, layout: str, variant: str, user_id: int, **kw: int | None):  # type: ignore[no-untyped-def]
    path = generated_pdf(layout, variant)
    return import_tax_document(session, path, user_id=user_id, original_name=path.name, **kw)


_PARSE_CASES = [
    ("tax_w2", "normal", ("w2",)),
    ("tax_w2", "two_employers", ("w2", "w2")),
    ("tax_1099_int", "normal", ("1099-int",)),
    ("tax_1099_div", "normal", ("1099-div",)),
    ("tax_1099_b", "normal_summary", ("1099-b",)),
    ("tax_1099_nec_misc", "nec_normal", ("1099-nec",)),
    ("tax_1099_consolidated", "int_div_b", None),
    ("tax_1040", "with_investment_income", ("1040",)),
]


@pytest.mark.parametrize(("layout", "variant", "forms"), _PARSE_CASES)
def test_imports_each_fixture_type(
    session: Session, layout: str, variant: str, forms: tuple[str, ...] | None
) -> None:
    uid = _user(session)
    result = _import(session, layout, variant, uid)
    assert result.status == "parsed", result.error
    assert result.error is None
    assert result.tax_year is not None
    assert result.inserted_forms == len(result.form_types) >= 1
    if forms is not None:
        assert result.form_types == forms
    doc = session.get(TaxDocument, result.document_id)
    assert doc is not None
    assert (doc.status, doc.user_id, doc.tax_year) == ("parsed", uid, result.tax_year)
    assert doc.parser_id and doc.parser_version
    n_income = session.scalar(select(func.count()).select_from(IncomeItem))
    n_tax = session.scalar(select(func.count()).select_from(TaxItem))
    assert (n_income, n_tax) == (result.income_item_count, result.tax_item_count)
    roles = set(session.scalars(select(TaxForm.role)))
    assert roles == ({"return"} if layout == "tax_1040" else {"source"})
    # Denormalised columns on items match their form.
    assert (
        session.scalar(
            select(func.count())
            .select_from(IncomeItem)
            .join(TaxForm, TaxForm.id == IncomeItem.form_id)
            .where(
                (IncomeItem.user_id != TaxForm.user_id) | (IncomeItem.tax_year != TaxForm.tax_year)
            )
        )
        == 0
    )


def test_w2_values_round_trip(session: Session) -> None:
    uid = _user(session)
    _import(session, "tax_w2", "normal", uid)
    (form,) = session.scalars(select(TaxForm)).all()
    assert form.payer_name == "Pinecrest Logistics LLC"
    assert form.payer_tin_last4 == "0001"
    wages = session.scalars(select(IncomeItem)).one()
    assert (wages.category, wages.amount_minor) == ("salary_wages", 8_543_210)


def test_duplicate_file_is_a_noop(session: Session) -> None:
    uid = _user(session)
    first = _import(session, "tax_w2", "normal", uid)
    second = _import(session, "tax_w2", "normal", uid)
    assert second.status == "duplicate"
    assert second.document_id == first.document_id
    assert second.form_types == first.form_types
    assert second.income_item_count == first.income_item_count
    assert second.inserted_forms == 0
    assert session.scalar(select(func.count()).select_from(TaxDocument)) == 1
    assert session.scalar(select(func.count()).select_from(TaxForm)) == 1


def test_same_form_in_two_different_pdfs_dedupes_by_fingerprint(
    session: Session, tmp_path: Path
) -> None:
    """Byte-different files (different sha) carrying the same W-2 insert the form once."""
    uid = _user(session)
    first = _import(session, "tax_w2", "normal", uid)
    variant = tmp_path / "w2_other_delivery.pdf"
    variant.write_bytes(generated_pdf("tax_w2", "normal").read_bytes() + b"\n% re-delivered\n")
    second = import_tax_document(session, variant, user_id=uid, original_name=variant.name)
    assert first.status == second.status == "parsed"
    assert first.document_id != second.document_id
    assert first.inserted_forms == 1
    assert second.inserted_forms == 0
    assert second.skipped_duplicate_forms == 1
    assert second.income_item_count == second.tax_item_count == 0
    assert any("already imported" in w for w in second.warnings)
    assert session.scalar(select(func.count()).select_from(TaxForm)) == 1
    assert session.scalar(select(func.count()).select_from(IncomeItem)) == 1
    # Deleting the second (empty) document leaves the first document's data intact.
    assert delete_tax_document(session, second.document_id) is True
    assert session.scalar(select(func.count()).select_from(TaxForm)) == 1


def test_copies_variant_imports_a_single_form(session: Session) -> None:
    result = _import(session, "tax_w2", "copies", _user(session))
    assert (result.status, result.form_types) == ("parsed", ("w2",))


def test_same_form_for_two_users_is_not_a_duplicate(session: Session) -> None:
    a, b = _user(session, "alice"), _user(session, "bob")
    first = _import(session, "tax_w2", "normal", a)
    other = _import(session, "tax_w2", "copies", b)
    assert first.inserted_forms == other.inserted_forms == 1
    assert session.scalar(select(func.count()).select_from(TaxForm)) == 2


def test_non_tax_pdf_is_unsupported(session: Session) -> None:
    uid = _user(session)
    result = _import(session, "layout_d_bank", "normal", uid)
    assert result.status == "unsupported"
    assert result.error == UNSUPPORTED_MESSAGE
    assert result.inserted_forms == 0
    doc = session.get(TaxDocument, result.document_id)
    assert doc is not None
    assert (doc.status, doc.error_detail) == ("unsupported", UNSUPPORTED_MESSAGE)
    assert session.scalar(select(func.count()).select_from(TaxForm)) == 0


def test_parse_error_is_recorded_with_generic_message(session: Session) -> None:
    uid = _user(session)
    result = _import(session, "tax_w2", "no_box1", uid)
    assert result.status == "error"
    assert result.error
    assert not _SSN_SHAPE.search(result.error)
    assert not re.search(r"\d{6}", result.error)
    doc = session.get(TaxDocument, result.document_id)
    assert doc is not None and doc.status == "error"
    assert doc.error_detail == result.error


def test_tax_year_override_and_retry_of_failed_document(session: Session) -> None:
    uid = _user(session)
    failed = _import(session, "tax_w2", "no_year", uid)
    assert failed.status == "error"
    retried = _import(session, "tax_w2", "no_year", uid, tax_year=2024)
    assert retried.status == "parsed"
    assert retried.tax_year == 2024
    assert retried.document_id == failed.document_id  # the failed row is reused
    doc = session.get(TaxDocument, retried.document_id)
    assert doc is not None and doc.status == "parsed" and doc.error_detail is None
    assert session.scalar(select(func.count()).select_from(TaxDocument)) == 1


def test_no_text_layer_is_unsupported(session: Session, tmp_path: Path) -> None:
    from reportlab.pdfgen import canvas

    pdf = tmp_path / "scan.pdf"
    c = canvas.Canvas(str(pdf), invariant=1)
    c.setFillGray(0.6)
    c.rect(50, 500, 400, 200, fill=1, stroke=0)
    c.showPage()
    c.save()
    uid = _user(session)
    result = import_tax_document(session, pdf, user_id=uid, original_name="scan.pdf")
    assert result.status == "unsupported"
    assert result.error is not None and "text layer" in result.error


def test_pdf_not_retained_by_default(session: Session) -> None:
    uid = _user(session)
    result = _import(session, "tax_w2", "normal", uid)
    doc = session.get(TaxDocument, result.document_id)
    assert doc is not None and doc.stored_path is None
    kept = list(statements_dir().glob("*.pdf")) if statements_dir().exists() else []
    assert kept == []


def test_staged_upload_is_removed_when_not_retained(session: Session) -> None:
    """The API saves uploads at statements_dir()/<sha>.pdf; the pipeline must delete that copy."""
    from spend_analyzer.core.paths import ensure_home
    from spend_analyzer.ingest.extract import sha256_file

    ensure_home()
    src = generated_pdf("tax_w2", "normal")
    staged = statements_dir() / f"{sha256_file(src)}.pdf"
    staged.write_bytes(src.read_bytes())
    uid = _user(session)
    result = import_tax_document(session, staged, user_id=uid, original_name="w2.pdf")
    assert result.status == "parsed"
    assert not staged.exists()
    assert src.exists()  # a caller's own file is never touched


def test_pdf_retained_when_enabled_and_deleted_with_document(session: Session) -> None:
    save_settings(Settings(privacy=PrivacyConfig(store_tax_pdf_copies=True)))
    uid = _user(session)
    result = _import(session, "tax_w2", "normal", uid)
    doc = session.get(TaxDocument, result.document_id)
    assert doc is not None and doc.stored_path is not None
    stored = Path(doc.stored_path)
    assert stored.exists()
    assert delete_tax_document(session, result.document_id) is True
    assert not stored.exists()
    assert session.scalar(select(func.count()).select_from(TaxForm)) == 0
    assert session.scalar(select(func.count()).select_from(IncomeItem)) == 0
    assert session.scalar(select(func.count()).select_from(TaxItem)) == 0


def test_delete_unknown_document_returns_false(session: Session) -> None:
    assert delete_tax_document(session, 424242) is False


def test_extract_cache_never_written_even_when_enabled(session: Session) -> None:
    save_settings(Settings(privacy=PrivacyConfig(store_extract_cache=True)))
    uid = _user(session)
    _import(session, "tax_w2", "normal", uid)
    cache = extract_cache_dir()
    assert not cache.exists() or list(cache.iterdir()) == []


def test_logs_contain_only_ids_and_counts(
    session: Session, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    uid = _user(session)
    _import(session, "tax_w2", "normal", uid)
    _import(session, "tax_w2", "no_box1", uid)
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("spend_analyzer"))
    assert "tax import" in text
    assert "Pinecrest" not in text
    assert "8543210" not in text and "85,432" not in text
    assert not _SSN_SHAPE.search(text)
    assert json.dumps(text)  # sanity: printable
