"""Lazy gateway to the §3.12a service interfaces (`ingest/pipeline.py`, P2-A; `classify/cascade.py`,
P2-B).

P2-A, P2-B and P2-C are built in parallel from the same frozen brief (§3.12a): each names the exact
functions and dataclasses the others will call. Because the three land in separate branches, this
module never imports `spend_analyzer.ingest.pipeline` or `spend_analyzer.classify.cascade` at
module scope — doing so would make every route module, and therefore the whole test suite,
depend on modules that do not exist yet in this branch. Instead, each wrapper below resolves the
real function by name, via `importlib`, the first time it is actually called.

Production code (routers, the job runner, the CLI) calls the module-level functions in this file
directly. Tests replace them with fakes via `monkeypatch.setattr(gateway, "propose_import", fake)`
(etc.), exactly as the P2-C plan section directs ("Route tests use fakes of the §3.12a
interfaces"). Once all three work packages are merged, these wrappers transparently delegate to
the real implementations — no call site elsewhere in `api/` or `jobs/` needs to change.

The dataclasses below are local, structural copies of the frozen shapes in §3.12a: attribute
access is all this codebase needs, so nothing here depends on `pipeline.py`'s or `cascade.py`'s
classes being importable, either.
"""

from __future__ import annotations

import importlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from sqlalchemy.orm import Session

from spend_analyzer.config import LLMConfig
from spend_analyzer.core.types import Kind


@dataclass(frozen=True)
class ImportProposal:
    """Mirrors `ingest.pipeline.ImportProposal` (§3.12a)."""

    statement_id: int
    status: str  # 'awaiting_extractor' | 'no_text_layer' | 'error' | 'duplicate'
    issuer_id: int | None
    parser_id: str | None
    layout_spec_id: int | None
    detect_score: float | None
    confident: bool


@dataclass(frozen=True)
class ImportResult:
    """Mirrors `ingest.pipeline.ImportResult` (§3.12a)."""

    statement_id: int
    inserted: int
    skipped_duplicates: int
    transaction_ids: tuple[int, ...]
    reconciliation_delta_minor: int | None
    layout_drift: bool
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class ClassifyResult:
    """Mirrors `classify.cascade.ClassifyResult` (§3.12a)."""

    group_id: str
    classified: int
    needs_review: int
    llm_requests: int
    cost_usd: float


def _resolve(module_path: str, attr: str) -> Callable[..., Any]:
    """Import `module_path` and return its `attr`, raising the same errors an ordinary
    `from module import attr` would once the module exists.

    Raises:
        ModuleNotFoundError: `module_path` does not exist (its owning work package has not been
            merged into this branch yet).
        AttributeError: the module exists but does not define `attr`.
    """
    module = importlib.import_module(module_path)
    return cast(Callable[..., Any], getattr(module, attr))


# ---------------------------------------------------------------------------
# ingest/pipeline.py (P2-A)
# ---------------------------------------------------------------------------


def propose_import(
    session: Session, pdf_path: Path, *, user_id: int, original_name: str
) -> ImportProposal:
    """Phase 1 of A22: extract text, match the issuer, propose an extractor. Commits the
    `statements` row; never parses transactions.

    Raises:
        ModuleNotFoundError: `ingest/pipeline.py` (P2-A) is not present in this build.
    """
    fn = _resolve("spend_analyzer.ingest.pipeline", "propose_import")
    return cast(ImportProposal, fn(session, pdf_path, user_id=user_id, original_name=original_name))


def confirm_import(
    session: Session,
    statement_id: int,
    *,
    issuer_id: int,
    parser_id: str | None,
    layout_spec_id: int | None,
    remember: bool,
) -> ImportResult:
    """Phase 2 of A22: parse and persist. Commits the statement and its transactions atomically.

    Raises:
        ModuleNotFoundError: `ingest/pipeline.py` (P2-A) is not present in this build.
    """
    fn = _resolve("spend_analyzer.ingest.pipeline", "confirm_import")
    return cast(
        ImportResult,
        fn(
            session,
            statement_id,
            issuer_id=issuer_id,
            parser_id=parser_id,
            layout_spec_id=layout_spec_id,
            remember=remember,
        ),
    )


def reparse(
    session: Session, statement_id: int, *, parser_id: str | None, layout_spec_id: int | None
) -> ImportResult:
    """Re-run extraction with a different extractor, rebuilding the statement's rows.

    Raises:
        ModuleNotFoundError: `ingest/pipeline.py` (P2-A) is not present in this build.
    """
    fn = _resolve("spend_analyzer.ingest.pipeline", "reparse")
    return cast(
        ImportResult,
        fn(session, statement_id, parser_id=parser_id, layout_spec_id=layout_spec_id),
    )


def reassign(
    session: Session, statement_id: int, *, user_id: int, account_id: int
) -> tuple[int, int]:
    """Reassign a statement's user/account, recomputing `dedupe_hash` for its rows (§3.5).
    Returns `(rows_moved, duplicates_deleted)`.

    Raises:
        ModuleNotFoundError: `ingest/pipeline.py` (P2-A) is not present in this build.
    """
    fn = _resolve("spend_analyzer.ingest.pipeline", "reassign")
    return cast(tuple[int, int], fn(session, statement_id, user_id=user_id, account_id=account_id))


# ---------------------------------------------------------------------------
# classify/cascade.py (P2-B)
# ---------------------------------------------------------------------------


def classify_transactions(
    session_factory: Callable[[], Session],
    transaction_ids: Sequence[int],
    *,
    cfg: LLMConfig,
    group_id: str,
    progress_cb: Callable[[int, int, float], None],
) -> ClassifyResult:
    """Run the classification cascade over `transaction_ids`, committing per batch.

    Raises:
        ModuleNotFoundError: `classify/cascade.py` (P2-B) is not present in this build.
    """
    fn = _resolve("spend_analyzer.classify.cascade", "classify_transactions")
    return cast(
        ClassifyResult,
        fn(
            session_factory,
            transaction_ids,
            cfg=cfg,
            group_id=group_id,
            progress_cb=progress_cb,
        ),
    )


def preview_egress(session: Session, transaction_ids: Sequence[int]) -> str:
    """The exact CSV the next classify run would send (A5). No network call.

    Raises:
        ModuleNotFoundError: `classify/cascade.py` (P2-B) is not present in this build.
    """
    fn = _resolve("spend_analyzer.classify.cascade", "preview_egress")
    return cast(str, fn(session, transaction_ids))


def apply_user_correction(
    session: Session,
    transaction_id: int,
    *,
    category_key: str,
    subcategory_key: str,
    kind: Kind | None,
    create_rule: bool,
) -> None:
    """Record a user correction (I6: wins forever), optionally creating a `rules` row.

    Raises:
        ModuleNotFoundError: `classify/cascade.py` (P2-B) is not present in this build.
    """
    fn = _resolve("spend_analyzer.classify.cascade", "apply_user_correction")
    fn(
        session,
        transaction_id,
        category_key=category_key,
        subcategory_key=subcategory_key,
        kind=kind,
        create_rule=create_rule,
    )


def approve_subcategory(session: Session, subcategory_id: int) -> None:
    """Approve a pending dynamic subcategory (A14).

    Raises:
        ModuleNotFoundError: `classify/cascade.py` (P2-B) is not present in this build.
    """
    fn = _resolve("spend_analyzer.classify.cascade", "approve_subcategory")
    fn(session, subcategory_id)


def merge_subcategory(session: Session, subcategory_id: int, *, into_id: int) -> None:
    """Merge a pending subcategory into another, atomically rewriting affected rows (A14).

    Raises:
        ModuleNotFoundError: `classify/cascade.py` (P2-B) is not present in this build.
    """
    fn = _resolve("spend_analyzer.classify.cascade", "merge_subcategory")
    fn(session, subcategory_id, into_id=into_id)
