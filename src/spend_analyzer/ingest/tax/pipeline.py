"""Single-phase import of a tax-form PDF into the `tax_*` tables (plan 4a).

`import_tax_document` is deterministic and synchronous: extract the text layer, pick a tax parser
(`registry.select_tax_parser`), parse, and persist the document, its forms and their income/tax
items in one transaction. No LLM, no network, no job.

Privacy (plan 3.4): a tax PDF holds full SSNs/EINs. This module therefore

- extracts with ``write_cache=False`` so `[privacy] store_extract_cache` can never dump the text;
- keeps the PDF only when `[privacy] store_tax_pdf_copies` is on (default off). When off, the
  hash-named upload under `statements_dir()` is deleted once the outcome is recorded (the caller's
  own original file is never touched);
- stores only generic error text and logs only ids, counts, form types and parser id/version
  (for an unexpected failure, only the exception class name);
- scrubs the display name (`tin.scrub_display_name`): no SSN shape and no 6+ digit run is stored.

Idempotency: (`user_id`, `file_sha256`) is UNIQUE on `tax_documents` (re-importing the same file for
the same user is a no-op, status ``duplicate``; another user may import the same PDF, and an existing
row's owner is never changed); `tax_forms` additionally dedupe on (user_id, tax_year, fingerprint), so the same
W-2 delivered in two different PDFs is stored once and reported as a skipped duplicate form.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from spend_analyzer.config import load_settings
from spend_analyzer.core.errors import EgressViolation, ParserError, UnsupportedLayoutError
from spend_analyzer.core.logging import get_logger
from spend_analyzer.core.paths import ensure_home, statements_dir
from spend_analyzer.core.tax_types import FORM_ROLE, ParsedTaxForm
from spend_analyzer.db.models import IncomeItem, TaxDocument, TaxForm, TaxItem
from spend_analyzer.ingest.extract import extract, sha256_file
from spend_analyzer.ingest.pipeline import NO_TEXT_LAYER_MESSAGE
from spend_analyzer.ingest.tax.registry import select_tax_parser
from spend_analyzer.ingest.tax.tin import has_long_digit_run, scrub, scrub_display_name

logger = get_logger("ingest.tax.pipeline")

STATUS_PARSED = "parsed"
STATUS_DUPLICATE = "duplicate"
STATUS_ERROR = "error"
STATUS_UNSUPPORTED = "unsupported"

UNSUPPORTED_MESSAGE = "This PDF doesn't look like a supported tax form (W-2, 1099, 1040)."
GENERIC_ERROR_MESSAGE = "This tax form could not be read."


@dataclass(frozen=True)
class TaxImportResult:
    document_id: int
    status: str  # 'parsed' | 'duplicate' | 'error' | 'unsupported'
    tax_year: int | None
    form_types: tuple[str, ...]
    inserted_forms: int
    skipped_duplicate_forms: int
    income_item_count: int
    tax_item_count: int
    warnings: tuple[str, ...]
    error: str | None  # generic message, never document text


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def _staged_path(file_sha256: str) -> Path:
    return statements_dir() / f"{file_sha256}.pdf"


def _is_staged_upload(pdf_path: Path, file_sha256: str) -> bool:
    try:
        return pdf_path.resolve() == _staged_path(file_sha256).resolve()
    except OSError:
        return False


def _keep_or_unstage(pdf_path: Path, file_sha256: str, *, keep: bool) -> str | None:
    """Apply `[privacy] store_tax_pdf_copies`: return `stored_path` (None when not kept)."""
    staged = _staged_path(file_sha256)
    if keep:
        ensure_home()
        if not staged.exists():
            staged.write_bytes(pdf_path.read_bytes())
        return str(staged)
    if _is_staged_upload(pdf_path, file_sha256):
        staged.unlink(missing_ok=True)
    return None


def _form_fingerprint(user_id: int, tax_year: int, form: ParsedTaxForm) -> str:
    """Stable identity of a form's content (D9). Hashed, so nothing readable is stored."""
    payer_key = " ".join((form.payer_name or "").lower().split())
    income = sorted(f"{i.category}:{i.amount_minor}:{int(i.is_memo)}" for i in form.income)
    taxes = sorted(f"{t.category}:{t.amount_minor}:{t.jurisdiction or ''}" for t in form.taxes)
    material = "|".join(
        [
            str(user_id),
            str(tax_year),
            form.form_type,
            payer_key,
            form.payer_tin_last4 or "",
            form.account_last4 or "",
            ",".join(income),
            ",".join(taxes),
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _safe_message(exc: Exception) -> str:
    """A parser's message if it is clean (no TIN shape, no long digit run), else a fixed one."""
    text = scrub(str(exc)).strip()
    if not text or has_long_digit_run(text) or len(text) > 300:
        return GENERIC_ERROR_MESSAGE
    return text


def _existing_summary(session: Session, doc: TaxDocument) -> TaxImportResult:
    forms = session.scalars(select(TaxForm).where(TaxForm.document_id == doc.id)).all()
    form_ids = [f.id for f in forms]
    income_n = tax_n = 0
    if form_ids:
        income_n = len(
            session.scalars(select(IncomeItem.id).where(IncomeItem.form_id.in_(form_ids))).all()
        )
        tax_n = len(session.scalars(select(TaxItem.id).where(TaxItem.form_id.in_(form_ids))).all())
    warnings: Sequence[str] = json.loads(doc.warnings) if doc.warnings else []
    return TaxImportResult(
        document_id=doc.id,
        status=STATUS_DUPLICATE,
        tax_year=doc.tax_year,
        form_types=tuple(f.form_type for f in forms),
        inserted_forms=0,
        skipped_duplicate_forms=0,
        income_item_count=income_n,
        tax_item_count=tax_n,
        warnings=tuple(warnings),
        error=None,
    )


def _failure(
    session: Session,
    doc: TaxDocument,
    *,
    status: str,
    message: str,
    tax_year: int | None,
) -> TaxImportResult:
    doc.status = status
    doc.error_detail = message
    doc.tax_year = tax_year
    doc.warnings = None
    session.commit()
    logger.info("tax import %s: document_id=%s", status, doc.id)
    return TaxImportResult(
        document_id=doc.id,
        status=status,
        tax_year=tax_year,
        form_types=(),
        inserted_forms=0,
        skipped_duplicate_forms=0,
        income_item_count=0,
        tax_item_count=0,
        warnings=(),
        error=message,
    )


def import_tax_document(
    session: Session,
    pdf_path: Path,
    *,
    user_id: int,
    original_name: str,
    tax_year: int | None = None,
) -> TaxImportResult:
    """Import one tax PDF for ``user_id``. Commits; never raises for bad documents.

    Args:
        session: open session on the app database.
        pdf_path: local PDF file.
        user_id: owner of the imported figures.
        original_name: display name (LOCAL ONLY; SSN shapes and 6+ digit runs are masked).
        tax_year: optional user override for forms that print no year.

    Returns:
        A `TaxImportResult`. ``status`` is 'parsed', 'duplicate' (same file already parsed for this
        user and holding forms; a no-op), 'unsupported' (not a tax form we know, or no text layer)
        or 'error' (a recognised form that could not be parsed, or an unexpected failure;
        ``error`` is a generic message). An unsupported/error row is
        reused when the same file is imported again.
    """
    file_sha256 = sha256_file(pdf_path)
    keep = load_settings().privacy.store_tax_pdf_copies
    original_name = scrub_display_name(original_name)
    try:
        return _import(
            session,
            pdf_path,
            file_sha256,
            keep,
            user_id=user_id,
            original_name=original_name,
            tax_year=tax_year,
        )
    except EgressViolation:
        raise
    except Exception as exc:
        # Import boundary: a parser/extractor bug (anything beyond ParserError) must not leave a
        # staged PDF with full identifiers on disk, half-written rows, or a 500 from the API.
        # Only the exception class is logged (a message could echo document text).
        logger.error("tax import failed unexpectedly: %s", type(exc).__name__)
        session.rollback()
        try:
            return _record_unexpected_failure(
                session, file_sha256, user_id=user_id, original_name=original_name
            )
        finally:
            _unstage(pdf_path, file_sha256)


def _unstage(pdf_path: Path, file_sha256: str) -> None:
    if _is_staged_upload(pdf_path, file_sha256):
        _staged_path(file_sha256).unlink(missing_ok=True)


def _find_document(session: Session, user_id: int, file_sha256: str) -> TaxDocument | None:
    return session.scalar(
        select(TaxDocument).where(
            TaxDocument.user_id == user_id, TaxDocument.file_sha256 == file_sha256
        )
    )


def _record_unexpected_failure(
    session: Session, file_sha256: str, *, user_id: int, original_name: str
) -> TaxImportResult:
    doc = _find_document(session, user_id, file_sha256)
    if doc is None:
        doc = TaxDocument(
            user_id=user_id,
            file_sha256=file_sha256,
            original_name=original_name,
            status=STATUS_ERROR,
            ingested_at=_utcnow_iso(),
        )
        session.add(doc)
    doc.stored_path = None
    session.flush()
    return _failure(session, doc, status=STATUS_ERROR, message=GENERIC_ERROR_MESSAGE, tax_year=None)


def _import(
    session: Session,
    pdf_path: Path,
    file_sha256: str,
    keep: bool,
    *,
    user_id: int,
    original_name: str,
    tax_year: int | None,
) -> TaxImportResult:
    doc_row = _find_document(session, user_id, file_sha256)
    if doc_row is not None and doc_row.status == STATUS_PARSED:
        has_forms = session.scalar(
            select(TaxForm.id).where(TaxForm.document_id == doc_row.id).limit(1)
        )
        if has_forms is not None:
            # Re-import of an identical, already-parsed file is a no-op (I9 analogue).
            _keep_or_unstage(pdf_path, file_sha256, keep=keep)
            return _existing_summary(session, doc_row)
        # Parsed but holds no forms (they were all deduped into another document that has since
        # been deleted): the import is re-run so the figures come back.

    try:
        extracted = extract(pdf_path, write_cache=False)
    except ParserError as exc:  # e.g. password protected: message is generic and actionable
        return _record_failure(
            session,
            doc_row,
            pdf_path,
            file_sha256,
            user_id,
            original_name,
            keep,
            status=STATUS_ERROR,
            message=_safe_message(exc),
            tax_year=tax_year,
            page_count=None,
        )

    stored_path = _keep_or_unstage(pdf_path, file_sha256, keep=keep)
    if doc_row is None:
        doc_row = TaxDocument(
            user_id=user_id,
            file_sha256=file_sha256,
            original_name=original_name,
            status=STATUS_ERROR,
            ingested_at=_utcnow_iso(),
        )
        session.add(doc_row)
    doc_row.original_name = original_name
    doc_row.stored_path = stored_path
    doc_row.page_count = extracted.page_count
    session.flush()

    if not extracted.has_text_layer:
        return _failure(
            session,
            doc_row,
            status=STATUS_UNSUPPORTED,
            message=NO_TEXT_LAYER_MESSAGE,
            tax_year=tax_year,
        )

    try:
        parser = select_tax_parser(extracted)
    except UnsupportedLayoutError:
        return _failure(
            session,
            doc_row,
            status=STATUS_UNSUPPORTED,
            message=UNSUPPORTED_MESSAGE,
            tax_year=tax_year,
        )
    doc_row.parser_id = parser.id
    doc_row.parser_version = parser.version
    try:
        parsed = parser.parse(extracted, tax_year=tax_year)
    except ParserError as exc:
        return _failure(
            session,
            doc_row,
            status=STATUS_ERROR,
            message=_safe_message(exc),
            tax_year=tax_year,
        )

    inserted_forms = skipped = income_n = tax_n = 0
    inserted_types: list[str] = []
    for form in parsed.forms:
        fingerprint = _form_fingerprint(user_id, parsed.tax_year, form)
        form_id = session.execute(
            sqlite_insert(TaxForm)
            .values(
                document_id=doc_row.id,
                user_id=user_id,
                tax_year=parsed.tax_year,
                form_type=form.form_type,
                role=FORM_ROLE[form.form_type],
                payer_name=form.payer_name,
                payer_tin_last4=form.payer_tin_last4,
                account_last4=form.account_last4,
                is_corrected=form.is_corrected,
                filing_status=form.filing_status,
                agi_minor=form.agi_minor,
                taxable_income_minor=form.taxable_income_minor,
                fingerprint=fingerprint,
                created_at=_utcnow_iso(),
            )
            .on_conflict_do_nothing(index_elements=["user_id", "tax_year", "fingerprint"])
            .returning(TaxForm.id)
        ).scalar_one_or_none()
        if form_id is None:
            skipped += 1
            continue
        inserted_forms += 1
        inserted_types.append(form.form_type)
        if form.income:
            session.execute(
                sqlite_insert(IncomeItem).values(
                    [
                        {
                            "form_id": form_id,
                            "user_id": user_id,
                            "tax_year": parsed.tax_year,
                            "category": i.category,
                            "amount_minor": i.amount_minor,
                            "currency": "USD",
                            "source_form": i.source_form,
                            "box": i.box,
                            "label": i.label,
                            "is_memo": i.is_memo,
                        }
                        for i in form.income
                    ]
                )
            )
            income_n += len(form.income)
        if form.taxes:
            session.execute(
                sqlite_insert(TaxItem).values(
                    [
                        {
                            "form_id": form_id,
                            "user_id": user_id,
                            "tax_year": parsed.tax_year,
                            "category": t.category,
                            "amount_minor": t.amount_minor,
                            "currency": "USD",
                            "source_form": t.source_form,
                            "box": t.box,
                            "label": t.label,
                            "jurisdiction": t.jurisdiction,
                            "is_estimate": t.is_estimate,
                        }
                        for t in form.taxes
                    ]
                )
            )
            tax_n += len(form.taxes)

    warnings = list(parsed.warnings)
    for form in parsed.forms:
        for w in form.warnings:
            if w not in warnings:
                warnings.append(w)
    if skipped:
        warnings.append(
            f"{skipped} form(s) in this file were already imported from another file and were skipped."
        )
    doc_row.status = STATUS_PARSED
    doc_row.error_detail = None
    doc_row.tax_year = parsed.tax_year
    doc_row.warnings = json.dumps(warnings) if warnings else None
    session.commit()
    logger.info(
        "tax import parsed: document_id=%s parser=%s@%s forms=%s inserted=%d skipped=%d "
        "income_items=%d tax_items=%d",
        doc_row.id,
        parser.id,
        parser.version,
        ",".join(f.form_type for f in parsed.forms),
        inserted_forms,
        skipped,
        income_n,
        tax_n,
    )
    return TaxImportResult(
        document_id=doc_row.id,
        status=STATUS_PARSED,
        tax_year=parsed.tax_year,
        form_types=tuple(f.form_type for f in parsed.forms),
        inserted_forms=inserted_forms,
        skipped_duplicate_forms=skipped,
        income_item_count=income_n,
        tax_item_count=tax_n,
        warnings=tuple(warnings),
        error=None,
    )


def _record_failure(
    session: Session,
    doc_row: TaxDocument | None,
    pdf_path: Path,
    file_sha256: str,
    user_id: int,
    original_name: str,
    keep: bool,
    *,
    status: str,
    message: str,
    tax_year: int | None,
    page_count: int | None,
) -> TaxImportResult:
    """Record a failure that happened before extraction produced a document (unreadable PDF)."""
    stored_path = _keep_or_unstage(pdf_path, file_sha256, keep=keep)
    if doc_row is None:
        doc_row = TaxDocument(
            user_id=user_id,
            file_sha256=file_sha256,
            original_name=original_name,
            status=status,
            ingested_at=_utcnow_iso(),
        )
        session.add(doc_row)
    doc_row.stored_path = stored_path
    doc_row.page_count = page_count
    session.flush()
    return _failure(session, doc_row, status=status, message=message, tax_year=tax_year)


def delete_tax_document(session: Session, document_id: int) -> bool:
    """Delete a tax document and (by cascade) its forms and items; remove a kept PDF copy.

    Returns:
        True if a document was deleted, False if ``document_id`` does not exist.
    """
    doc = session.get(TaxDocument, document_id)
    if doc is None:
        return False
    stored = doc.stored_path
    session.delete(doc)
    session.commit()
    if stored:
        # Another user's document imported from the same PDF shares the kept copy (it is named by
        # content hash); only remove it when nothing else points at it.
        still_used = session.scalar(
            select(TaxDocument.id).where(TaxDocument.stored_path == stored).limit(1)
        )
        if still_used is None:
            Path(stored).unlink(missing_ok=True)
    logger.info("tax document deleted: document_id=%s", document_id)
    return True
