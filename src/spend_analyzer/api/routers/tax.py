"""`/api/tax` (income & tax analysis from W-2 / 1099 / 1040 PDFs).

Upload hardening is shared with `/api/statements` (`api/services/uploads.py`). Import is a single
synchronous step (`gateway.import_tax_document`); all tax SQL lives in `analytics/tax_query.py`.

Privacy: responses expose only the last four digits of a taxpayer identifier and never
`stored_path`; `payer_name` is local-only data. Tax data is never sent to an LLM.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Annotated

from fastapi import APIRouter, Form, HTTPException, Query, Response, UploadFile

from spend_analyzer.analytics import tax_query
from spend_analyzer.analytics.tax_query import TaxQuery
from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SessionDep
from spend_analyzer.api.services import crud, gateway
from spend_analyzer.api.services.uploads import (
    read_pdf_upload,
    sanitize_original_name,
    save_upload,
)
from spend_analyzer.core.tax_types import (
    INCOME_CATEGORY_LABELS,
    MEMO_INCOME_CATEGORIES,
    TAX_CATEGORY_LABELS,
    TaxCategory,
)
from spend_analyzer.db.models import IncomeItem, TaxDocument, TaxForm, TaxItem
from spend_analyzer.ingest.tax.pipeline import delete_tax_document

router = APIRouter(tags=["tax"])

_MIN_YEAR = 1990
_MAX_YEAR = 2100
#: Labels for the memo keys in `TaxYearSummary.memo_by_category`.
_MEMO_LABELS = {
    "qualified_dividends": INCOME_CATEGORY_LABELS["qualified_dividends"],
    tax_query.TAX_EXEMPT_MEMO_KEY: "Tax-exempt interest (memo)",
}


def _warnings(doc: TaxDocument) -> list[str]:
    if not doc.warnings:
        return []
    loaded = json.loads(doc.warnings)
    return [str(w) for w in loaded] if isinstance(loaded, list) else []


def _income_item(item: IncomeItem) -> schemas.IncomeItemOut:
    return schemas.IncomeItemOut(
        id=item.id,
        category=schemas.IncomeCategoryEnum(item.category),
        amount_minor=item.amount_minor,
        currency=item.currency,
        source_form=item.source_form,
        box=item.box,
        label=item.label,
        is_memo=item.is_memo,
    )


def _tax_item(item: TaxItem) -> schemas.TaxItemOut:
    return schemas.TaxItemOut(
        id=item.id,
        category=schemas.TaxCategoryEnum(item.category),
        amount_minor=item.amount_minor,
        currency=item.currency,
        source_form=item.source_form,
        box=item.box,
        label=item.label,
        jurisdiction=item.jurisdiction,
        is_estimate=item.is_estimate,
    )


def _form_fields(form: TaxForm) -> dict[str, object]:
    return {
        "id": form.id,
        "form_type": schemas.TaxFormType(form.form_type),
        "role": form.role,
        "tax_year": form.tax_year,
        "payer_name": form.payer_name,
        "payer_tin_last4": form.payer_tin_last4,
        "account_last4": form.account_last4,
        "filing_status": form.filing_status,
        "agi_minor": form.agi_minor,
        "taxable_income_minor": form.taxable_income_minor,
        "is_corrected": form.is_corrected,
    }


def _document(doc: TaxDocument) -> schemas.TaxDocument:
    return schemas.TaxDocument(
        id=doc.id,
        user_id=doc.user_id,
        original_name=doc.original_name,
        tax_year=doc.tax_year,
        status=doc.status,
        form_types=[schemas.TaxFormType(f.form_type) for f in doc.forms],
        page_count=doc.page_count,
        warnings=_warnings(doc),
        error_detail=doc.error_detail,
        created_at=doc.ingested_at,
    )


def _document_detail(doc: TaxDocument) -> schemas.TaxDocumentDetail:
    base = _document(doc)
    forms = [
        schemas.TaxFormDetail(
            **_form_fields(f),
            income_items=[_income_item(i) for i in f.income_items],
            tax_items=[_tax_item(t) for t in f.tax_items],
        )
        for f in doc.forms
    ]
    return schemas.TaxDocumentDetail(**base.model_dump(), forms=forms)


def _check_year(year: int | None, *, name: str = "tax_year") -> None:
    if year is not None and not (_MIN_YEAR <= year <= _MAX_YEAR):
        raise HTTPException(status_code=400, detail=f"invalid {name}: {year}")


def _user_filter(user_id: int | None) -> list[int] | None:
    return [user_id] if user_id is not None else None


@router.post("/tax/documents", response_model=schemas.TaxImportResponse, status_code=201)
async def upload_tax_document(
    file: UploadFile,
    session: SessionDep,
    user_id: int = Form(...),
    tax_year: int | None = Form(None),
) -> schemas.TaxImportResponse:
    """Multipart upload of one tax-form PDF; parsed synchronously. A non-tax or unreadable
    PDF still returns 201 with `status` `unsupported` / `error` and a generic message."""
    data = await read_pdf_upload(file)
    _check_year(tax_year)
    if crud.get_user(session, user_id) is None:
        raise HTTPException(status_code=404, detail="user not found")
    original_name = sanitize_original_name(file.filename or "tax-form.pdf", "tax-form.pdf")
    pdf_path = save_upload(data)

    result = gateway.import_tax_document(
        session, pdf_path, user_id=user_id, original_name=original_name, tax_year=tax_year
    )
    doc = tax_query.get_tax_document(session, result.document_id)
    if doc is None:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="import did not create a document")
    return schemas.TaxImportResponse(
        document=_document(doc),
        status=result.status,
        inserted_forms=result.inserted_forms,
        skipped_duplicate_forms=result.skipped_duplicate_forms,
        income_item_count=result.income_item_count,
        tax_item_count=result.tax_item_count,
        warnings=list(result.warnings),
        error=result.error,
    )


@router.get("/tax/documents", response_model=list[schemas.TaxDocument])
def list_documents(
    session: SessionDep, user_id: int | None = None, tax_year: int | None = None
) -> list[schemas.TaxDocument]:
    _check_year(tax_year)
    docs = tax_query.list_tax_documents(session, user_ids=_user_filter(user_id), tax_year=tax_year)
    return [_document(d) for d in docs]


@router.get("/tax/documents/{document_id}", response_model=schemas.TaxDocumentDetail)
def get_document(document_id: int, session: SessionDep) -> schemas.TaxDocumentDetail:
    doc = tax_query.get_tax_document(session, document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="tax document not found")
    return _document_detail(doc)


@router.delete("/tax/documents/{document_id}", status_code=204)
def delete_document(document_id: int, session: SessionDep) -> Response:
    if not delete_tax_document(session, document_id):
        raise HTTPException(status_code=404, detail="tax document not found")
    return Response(status_code=204)


@router.get("/tax/years", response_model=list[int])
def list_years(
    session: SessionDep, user_ids: Annotated[list[int] | None, Query()] = None
) -> list[int]:
    return tax_query.list_tax_years(session, user_ids)


def _income_amounts(summary: tax_query.TaxYearSummary) -> list[schemas.IncomeCategoryAmount]:
    return [
        schemas.IncomeCategoryAmount(
            category=schemas.IncomeCategoryEnum(cat),
            label=INCOME_CATEGORY_LABELS[cat],
            amount_minor=amount,
            is_memo=cat in MEMO_INCOME_CATEGORIES,
        )
        for cat, amount in summary.income_by_category.items()
    ]


def _tax_amounts(values: Mapping[TaxCategory, int]) -> list[schemas.TaxCategoryAmount]:
    return [
        schemas.TaxCategoryAmount(
            category=schemas.TaxCategoryEnum(cat),
            label=TAX_CATEGORY_LABELS[cat],
            amount_minor=amount,
        )
        for cat, amount in values.items()
    ]


def _summary(s: tax_query.TaxYearSummary) -> schemas.TaxYearSummary:
    return schemas.TaxYearSummary(
        tax_year=s.tax_year,
        user_id=s.user_id,
        income_basis=s.income_basis,
        income_by_category=_income_amounts(s),
        memo_by_category=[
            schemas.TaxMemoAmount(category=k, label=_MEMO_LABELS.get(k, k), amount_minor=v)
            for k, v in s.memo_by_category.items()
        ],
        total_income_minor=s.total_income_minor,
        withheld=_tax_amounts(s.withheld),
        fica=_tax_amounts(s.fica),
        liability=_tax_amounts(s.liability),
        payments_minor=s.payments_minor,
        refund_minor=s.refund_minor,
        amount_owed_minor=s.amount_owed_minor,
        refund_or_owed_derived=s.refund_or_owed_derived,
        federal_effective_rate=s.federal_effective_rate,
        all_in_rate=s.all_in_rate,
        withholding_rate=s.withholding_rate,
        document_count=s.document_count,
        form_count=s.form_count,
        warnings=list(s.warnings),
    )


@router.get("/tax/summary", response_model=list[schemas.TaxYearSummary])
def tax_summary(
    session: SessionDep,
    user_ids: Annotated[list[int] | None, Query()] = None,
    tax_years: Annotated[list[int] | None, Query()] = None,
    currency: str = "USD",
    per_user: bool = False,
) -> list[schemas.TaxYearSummary]:
    """One summary per tax year (newest first); with `per_user`, one per (year, user)."""
    query = TaxQuery(user_ids=user_ids, tax_years=tax_years, currency=currency, per_user=per_user)
    try:
        rows = tax_query.run_tax_summary(session, query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return [_summary(r) for r in rows]


@router.get("/tax/income-by-payer", response_model=list[schemas.TaxIncomePayer])
def income_by_payer(
    session: SessionDep,
    user_ids: Annotated[list[int] | None, Query()] = None,
    tax_years: Annotated[list[int] | None, Query()] = None,
    currency: str = "USD",
) -> list[schemas.TaxIncomePayer]:
    """Non-memo income on source forms (W-2 / 1099) per payer; newest year, largest first."""
    query = TaxQuery(user_ids=user_ids, tax_years=tax_years, currency=currency)
    try:
        rows = tax_query.run_income_by_payer(session, query)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return [
        schemas.TaxIncomePayer(
            tax_year=r.tax_year,
            user_id=r.user_id,
            payer_name=r.payer_name,
            form_type=schemas.TaxFormType(r.form_type),
            category=schemas.IncomeCategoryEnum(r.category),
            label=INCOME_CATEGORY_LABELS[r.category],
            amount_minor=r.amount_minor,
        )
        for r in rows
    ]
