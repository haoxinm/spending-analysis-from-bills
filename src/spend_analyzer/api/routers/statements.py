"""`/api/statements` (§3.12, A22 two-phase import).

Upload hardening (A12): a 25 MB cap enforced while streaming (never buffers an oversized file
whole), a `%PDF-` magic-byte check, a `sha256`-derived stored filename (never the user-supplied
name), and a sanitized `original_name` before it is ever echoed back.

Calls into `api/services/gateway.py` for the §3.12a `ingest/pipeline.py` interface (P2-A); never
imports `ingest.pipeline` directly (see that module's docstring).
"""

from __future__ import annotations

import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import JobRunnerDep, SessionDep, SessionFactoryDep, SettingsDep
from spend_analyzer.api.services import crud, gateway, statement_preview
from spend_analyzer.api.services.job_tasks import enqueue_import_then_classify
from spend_analyzer.core.paths import statements_dir
from spend_analyzer.db.models import Statement
from spend_analyzer.ingest.extract import sha256_file
from spend_analyzer.jobs.runner import JobProgress

router = APIRouter(tags=["statements"])

#: A12: hard cap on an uploaded statement's size.
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_PDF_MAGIC = b"%PDF-"
_UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._ -]")


def _sanitize_original_name(name: str) -> str:
    """Strip path components and anything but a conservative character set (A12: no path
    traversal, and never trust a client-supplied filename for display without cleaning it)."""
    base = Path(name).name or "statement.pdf"
    return _UNSAFE_NAME_CHARS.sub("_", base)[:255]


def _save_upload(file_bytes: bytes) -> Path:
    """Write `file_bytes` to `<statements_dir>/<sha256>.pdf` (A12) and return the path. Byte-
    identical re-uploads simply overwrite the same path (I9's no-op is enforced downstream, by
    `propose_import` matching on `file_sha256`, not by skipping the write here)."""
    tmp_dir = statements_dir()
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=tmp_dir, delete=False, suffix=".pdf") as tmp:
        tmp.write(file_bytes)
        tmp_path = Path(tmp.name)
    digest = sha256_file(tmp_path)
    final_path = tmp_dir / f"{digest}.pdf"
    tmp_path.replace(final_path)
    return final_path


def _statement_response(session: Session, statement: Statement) -> schemas.Statement:
    return schemas.Statement(
        id=statement.id,
        user_id=crud.statement_user_id(session, statement),
        account_id=statement.account_id,
        issuer_id=statement.issuer_id,
        parser_id=statement.parser_id,
        layout_spec_id=statement.layout_spec_id,
        status=statement.status,
        period_start=statement.period_start,
        period_end=statement.period_end,
        txn_count=statement.txn_count,
        reconciliation_delta_minor=crud.reconciliation_delta_minor(session, statement),
        detect_score=statement.detect_score,
        shape_warnings=statement.shape_warnings,
        error_detail=statement.error_detail,
        created_at=statement.ingested_at,
    )


@router.post("/statements", response_model=schemas.StatementUploadResponse, status_code=201)
async def upload_statement(
    file: UploadFile,
    session: SessionDep,
    user_id: int = Form(...),
) -> schemas.StatementUploadResponse:
    """Multipart upload. `user_id` (D4: chosen in the Import screen, sticky) is a form field
    alongside `file`."""
    if file.content_type not in (None, "application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=400, detail="only application/pdf uploads are accepted")

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="file exceeds the 25 MB upload limit")
        chunks.append(chunk)
    data = b"".join(chunks)

    if not data.startswith(_PDF_MAGIC):
        raise HTTPException(status_code=400, detail="not a PDF file")

    original_name = _sanitize_original_name(file.filename or "statement.pdf")
    pdf_path = _save_upload(data)

    proposal = gateway.propose_import(
        session, pdf_path, user_id=user_id, original_name=original_name
    )
    session.commit()

    statement = crud.get_statement(session, proposal.statement_id)
    if statement is None:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="propose_import did not create a statement")

    return schemas.StatementUploadResponse(
        statement=_statement_response(session, statement),
        proposal=schemas.ExtractorProposal(
            issuer_id=proposal.issuer_id,
            parser_id=proposal.parser_id,
            layout_spec_id=proposal.layout_spec_id,
            confidence=proposal.detect_score or 0.0,
            auto_confirmed=False,
        ),
    )


@router.get("/statements", response_model=list[schemas.Statement])
def list_statements(session: SessionDep, user_id: int | None = None) -> list[schemas.Statement]:
    return [_statement_response(session, s) for s in crud.list_statements(session, user_id=user_id)]


@router.get("/statements/{statement_id}", response_model=schemas.Statement)
def get_statement(statement_id: int, session: SessionDep) -> schemas.Statement:
    statement = crud.get_statement(session, statement_id)
    if statement is None:
        raise HTTPException(status_code=404, detail="statement not found")
    return _statement_response(session, statement)


@router.patch("/statements/{statement_id}", response_model=schemas.Statement)
def patch_statement(
    statement_id: int, body: schemas.StatementPatch, session: SessionDep
) -> schemas.Statement:
    statement = crud.get_statement(session, statement_id)
    if statement is None:
        raise HTTPException(status_code=404, detail="statement not found")
    if body.user_id is not None and body.account_id is not None:
        # `reassign` (§3.5) recomputes `dedupe_hash` for every one of this statement's rows and
        # updates `statement.account_id` itself; a plain CRUD field write here would race it and
        # could set an account_id its own dedupe recompute never ran against.
        gateway.reassign(session, statement_id, user_id=body.user_id, account_id=body.account_id)
        session.commit()
        session.refresh(statement)
    elif body.account_id is not None:
        statement = crud.patch_statement(session, statement, account_id=body.account_id)
        session.commit()
    return _statement_response(session, statement)


@router.delete("/statements/{statement_id}", status_code=204)
def delete_statement(statement_id: int, session: SessionDep) -> None:
    statement = crud.get_statement(session, statement_id)
    if statement is None:
        raise HTTPException(status_code=404, detail="statement not found")
    crud.delete_statement(session, statement)
    session.commit()


@router.get("/statements/{statement_id}/preview", response_model=schemas.StatementPreviewPage)
def preview_statement_page(
    statement_id: int, session: SessionDep, page: int = 1
) -> schemas.StatementPreviewPage:
    """One page's words (`x0`/`x1`/`top`/`bottom`) plus page size, for the Layout mapper's
    click-to-map UI (§2c). Local-only: this stays on the token-protected localhost API and never
    goes through egress (I1b/I3)."""
    statement = crud.get_statement(session, statement_id)
    if statement is None:
        raise HTTPException(status_code=404, detail="statement not found")

    pdf_path = crud.staged_pdf_path(statement)
    if pdf_path is None:
        raise HTTPException(
            status_code=404,
            detail=(
                "no PDF copy is available for this statement "
                "([privacy] store_pdf_copies was off and it is already confirmed)"
            ),
        )

    try:
        page_preview = statement_preview.preview_page(pdf_path, page)
    except statement_preview.PagePreviewNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None

    return schemas.StatementPreviewPage(
        page_number=page_preview.page_number,
        width=page_preview.width,
        height=page_preview.height,
        words=[
            schemas.StatementPreviewWord(text=w.text, x0=w.x0, x1=w.x1, top=w.top, bottom=w.bottom)
            for w in page_preview.words
        ],
    )


@router.post(
    "/statements/{statement_id}/extract", response_model=schemas.JobIdResponse, status_code=202
)
def extract_statement(
    statement_id: int,
    body: schemas.ExtractRequest,
    session: SessionDep,
    settings: SettingsDep,
    runner: JobRunnerDep,
    session_factory: SessionFactoryDep,
) -> schemas.JobIdResponse:
    """A22 phase 2: enqueues an `import` job that calls `confirm_import`, then (job flow, P2-C
    plan section) enqueues a `classify` job for the transactions it inserted."""
    statement = crud.get_statement(session, statement_id)
    if statement is None:
        raise HTTPException(status_code=404, detail="statement not found")

    job_id = enqueue_import_then_classify(
        runner,
        session_factory,
        statement_id=statement_id,
        issuer_id=body.issuer_id,
        parser_id=body.parser_id,
        layout_spec_id=body.layout_spec_id,
        remember=body.remember,
        cfg=settings.llm,
    )
    return schemas.JobIdResponse(job_id=job_id)


@router.post(
    "/statements/{statement_id}/reparse", response_model=schemas.JobIdResponse, status_code=202
)
def reparse_statement(
    statement_id: int,
    body: schemas.ExtractRequest,
    session: SessionDep,
    runner: JobRunnerDep,
    session_factory: SessionFactoryDep,
) -> schemas.JobIdResponse:
    statement = crud.get_statement(session, statement_id)
    if statement is None:
        raise HTTPException(status_code=404, detail="statement not found")

    def task(progress: JobProgress) -> dict[str, object]:
        with session_factory() as job_session:
            result = gateway.reparse(
                job_session,
                statement_id,
                parser_id=body.parser_id,
                layout_spec_id=body.layout_spec_id,
            )
            job_session.commit()
        progress.update(1, 1)
        return {"inserted": result.inserted, "transaction_ids": list(result.transaction_ids)}

    job_id = runner.run_job(kind="import", task=task)
    return schemas.JobIdResponse(job_id=job_id)
