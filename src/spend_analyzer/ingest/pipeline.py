"""The ingest pipeline (§3.12a, P2-A): two-phase import (A22), reconciliation (A25), drift
detection (A18), dedupe (§3.5), account resolution (D4), and checking->credit transfer pairing
(I11, A26).

```
PHASE 1 (`propose_import`, automatic on upload)
  sha256 -> idempotency check
  -> extract text layer                          [ingest.extract, P1-A]
  -> no text layer?  status='no_text_layer', STOP
  -> locate table bands                          [ingest.layout.locate_table_bands, P0-7]
  -> match issuer against issuers.match_terms    [ingest.issuer_match, §2f.4]
  -> resolve remembered spec + score built-in parsers
  -> status='awaiting_extractor'; return an ImportProposal

PHASE 2 (`confirm_import`, on user confirmation, or automatically when the proposal is confident)
  -> parse -> RawTransaction[]                   [the resolved parser]
  -> normalize + redact                          [ingest.normalize, P1-C]
  -> resolve (or create) the account             [D4]
  -> reconciliation check                        [A25]
  -> drift evaluation against the account's previous statement   [A18]
  -> dedupe against existing rows                [ingest.dedupe, §3.5]
  -> persist statement + transactions in one atomic DB transaction
  -> clean import only: update issuers.default_spec_id / last_used_at   [A23]
  -> pair checking-side card payments with their card-side payment      [I11, A26]
  -> return an ImportResult
```

**A note on a cross-lane dependency this module does not have.** Layout A/B/C's `'payment_or_
refund'` `KindHint` is, per those parsers' own docstrings, meant to be resolved by a single
pattern living in `classify/kinds.py` (owned by P2-B, developed in parallel). `transactions.kind`
is `NOT NULL` with a `CHECK` constraint that does not accept `'payment_or_refund'`, so *something*
must resolve it before this module's `INSERT`, and P2-B's module is not on this branch to import
from. `_resolve_kind` below is a small, self-contained mirror of the documented rule ("a payment
pattern matches -> `payment`, otherwise `refund`", A29) that keeps this module fully testable on
its own. It is flagged in this WP's final report as a contract observation for the orchestrator:
once P2-B lands, this duplicated heuristic should either be deleted in favor of importing
`classify.kinds`, or `classify/kinds.py` should delegate to (or be moved from) this function —
either way, both lanes must not keep independent copies of the same pattern past the merge.
"""

from __future__ import annotations

import contextlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import cast

from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from spend_analyzer.config import Settings, load_settings
from spend_analyzer.core.errors import ParserError, SpendAnalyzerError, UnsupportedLayoutError
from spend_analyzer.core.logging import get_logger
from spend_analyzer.core.paths import ensure_home, statements_dir
from spend_analyzer.core.types import (
    ExtractedDoc,
    Kind,
    KindHint,
    ParsedStatement,
    StatementParser,
)
from spend_analyzer.db.models import Account, Issuer, LayoutSpec, Statement, Transaction, User
from spend_analyzer.ingest import issuer_match
from spend_analyzer.ingest.dedupe import DedupeKey, compute_dedupe_hash, compute_occurrence_indices
from spend_analyzer.ingest.extract import extract, sha256_file
from spend_analyzer.ingest.layout import locate_table_bands
from spend_analyzer.ingest.layout_spec import build_parser_for_row, resolve_spec
from spend_analyzer.ingest.normalize import normalize
from spend_analyzer.ingest.parsers.generic_table import generic_table
from spend_analyzer.ingest.registry import discover_all_parsers
from spend_analyzer.ingest.registry import select as select_parser

logger = get_logger("ingest.pipeline")

#: `statements.status` values this module writes. Not an enforced `Literal` at the ORM layer
#: (the column is plain `TEXT`), but every write goes through one of these constants.
STATUS_AWAITING_EXTRACTOR = "awaiting_extractor"
STATUS_NO_TEXT_LAYER = "no_text_layer"
STATUS_PARSED = "parsed"
STATUS_UNSUPPORTED_LAYOUT = "unsupported_layout"
STATUS_ERROR = "error"

#: A22/D12's fixed copy for a statement with no extractable text layer.
NO_TEXT_LAYER_MESSAGE = (
    "Can't read this PDF — it looks like a scan or an image with no text layer. Spend Analyzer "
    "only supports native digital PDFs. Try downloading the statement directly from your bank's "
    "website rather than a photo or scanned copy."
)

#: A parser must score strictly above this for a proposal to be `confident` (§3.12a).
CONFIDENT_SCORE_THRESHOLD = 0.8

#: A drift signal (§2d.1): the winning parser's `detect_score` moved by at least this much from
#: the account's previous statement. Not specified numerically by the plan beyond its own
#: worked example (0.95 -> 0.62); this is a deliberately conservative reading of it.
DETECT_SCORE_DRIFT_THRESHOLD = 0.15

#: I11/A26: a payment *to* a credit card from a checking/savings account is a transfer, never
#: spend, no matter which section it printed in or which parser produced it. Mirrors
#: `layout_d_bank`'s pattern so the generic parser's debit/credit mode (which emits no kind hint
#: at all) gets the same treatment (D11, A26 — this classification is P2-A's job, not the
#: parser's, precisely so it also covers layouts that do not do it themselves).
_CARD_PAYMENT_RE = re.compile(
    r"\b(AUTOPAY|CRD\s*PMT|CREDIT\s*CARD\s*PAYMENT|EPAY|PAYMENT|PMT)\b", re.IGNORECASE
)

#: See the module docstring: the interim mirror of `classify/kinds.py`'s payment/refund pattern
#: (A29), used only to satisfy the `NOT NULL` `kind` column before persistence.
_PAYMENT_PATTERN_RE = re.compile(
    r"\b(PAYMENT|PYMT|AUTOPAY|AUTO\s*PAY|THANK\s*YOU|ONLINE\s*PMT)\b", re.IGNORECASE
)

#: ±5 days (I11): the window within which a checking-side transfer is paired with a credit-side
#: payment of equal magnitude.
_TRANSFER_PAIR_WINDOW_DAYS = 5


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


# ------------------------------------------------------------------------------------------------
# §3.12a frozen result types
# ------------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ImportProposal:
    statement_id: int
    status: str  # 'awaiting_extractor' | 'no_text_layer' | 'error' | 'duplicate'
    issuer_id: int | None  # auto-matched issuer, if unambiguous
    parser_id: str | None  # best built-in parser or 'spec_<slug>_v<n>'
    layout_spec_id: int | None
    detect_score: float | None
    confident: bool  # issuer matched AND spec/parser resolved AND score >= 0.8


@dataclass(frozen=True)
class ImportResult:
    statement_id: int
    inserted: int
    skipped_duplicates: int
    transaction_ids: tuple[int, ...]  # rows inserted; P2-C enqueues classification for them
    reconciliation_delta_minor: int | None  # None when no check was possible
    layout_drift: bool
    warnings: tuple[str, ...]


# ------------------------------------------------------------------------------------------------
# Pending-import bookkeeping: the upload path and requesting user for a statement that has been
# proposed but not yet confirmed.
#
# `confirm_import`/`reparse` (§3.12a) are frozen with no `user_id` parameter and `statements` has
# no `user_id` column (§3.2) — the account a statement belongs to, and therefore which user it is
# for, is not resolved until Phase 2 runs, once `account_type`/`mask` come out of the parse. This
# module-level map is how Phase 1's `user_id` and file path reach Phase 2 without changing either
# frozen signature. It is intentionally in-process only (D6: one in-process worker thread), which
# is a real limitation worth flagging to the orchestrator: it does not survive a server restart
# between a statement's proposal and its confirmation. Re-proposing the same file (same sha256)
# repopulates the entry, which is the documented recovery path (see `propose_import`).
# ------------------------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _PendingImport:
    user_id: int
    pdf_path: Path


_PENDING_IMPORTS: dict[int, _PendingImport] = {}


# ------------------------------------------------------------------------------------------------
# Phase 1 — propose_import
# ------------------------------------------------------------------------------------------------


def propose_import(
    session: Session, pdf_path: Path, *, user_id: int, original_name: str
) -> ImportProposal:
    """Phase 1 of A22: extract text, locate the table, match the issuer, score parsers, and
    commit a `statements` row at `status='awaiting_extractor'`. Never parses transactions.

    Idempotency (I9): if a statement with this file's SHA-256 already exists, nothing is
    re-extracted or re-scored. A `status='parsed'` row is reported back as `status='duplicate'`
    (this upload is a no-op). Any other existing status (including `'awaiting_extractor'` itself)
    is reported as-is — this is also how a pending import survives a process restart: re-proposing
    the same file repopulates the in-process bookkeeping Phase 2 needs (see the module docstring).

    Args:
        session: an open session. This function commits the `statements` row it writes.
        pdf_path: path to the uploaded PDF, already saved to local disk by the caller (upload
            validation — size cap, magic-byte check, A12 — is the API layer's job, not this
            module's: `ingest/` takes a trusted local path).
        user_id: the user this import is for. Not yet persisted anywhere in `statements` (see the
            module docstring); remembered in-process until `confirm_import` runs.
        original_name: the user-supplied filename, stored verbatim for display. The *stored*
            copy's filename is always the content hash, never this value (A12).

    Returns:
        An `ImportProposal` describing what Phase 2 would do if confirmed now.
    """
    file_sha256 = sha256_file(pdf_path)
    existing = (
        session.execute(select(Statement).where(Statement.file_sha256 == file_sha256))
        .scalars()
        .first()
    )
    if existing is not None:
        if existing.status == STATUS_AWAITING_EXTRACTOR:
            _PENDING_IMPORTS[existing.id] = _PendingImport(user_id=user_id, pdf_path=pdf_path)
        status = "duplicate" if existing.status == STATUS_PARSED else existing.status
        return ImportProposal(
            statement_id=existing.id,
            status=status,
            issuer_id=existing.issuer_id,
            parser_id=existing.parser_id,
            layout_spec_id=existing.layout_spec_id,
            detect_score=existing.detect_score,
            confident=_is_confident(existing.issuer_id, existing.detect_score, existing.status),
        )

    doc = extract(pdf_path)
    settings = load_settings()
    stored_path: str | None = None
    if settings.privacy.store_pdf_copies:
        stored_path = _copy_statement(pdf_path, file_sha256)

    if not doc.has_text_layer:
        statement = Statement(
            file_sha256=file_sha256,
            original_name=original_name,
            stored_path=stored_path,
            page_count=doc.page_count,
            status=STATUS_NO_TEXT_LAYER,
            error_detail=NO_TEXT_LAYER_MESSAGE,
            ingested_at=_utcnow_iso(),
        )
        session.add(statement)
        session.commit()
        return ImportProposal(
            statement_id=statement.id,
            status=STATUS_NO_TEXT_LAYER,
            issuer_id=None,
            parser_id=None,
            layout_spec_id=None,
            detect_score=None,
            confident=False,
        )

    table_bands = locate_table_bands(doc)
    issuer_id = issuer_match.match_issuer(session, doc, table_bands)
    selected, score, layout_spec_id = _select_parser(session, doc, issuer_id)

    statement = Statement(
        file_sha256=file_sha256,
        original_name=original_name,
        stored_path=stored_path,
        page_count=doc.page_count,
        issuer_id=issuer_id,
        layout_spec_id=layout_spec_id,
        parser_id=selected.id,
        parser_version=selected.version,
        detect_score=score,
        status=STATUS_AWAITING_EXTRACTOR,
        ingested_at=_utcnow_iso(),
    )
    session.add(statement)
    session.commit()

    _PENDING_IMPORTS[statement.id] = _PendingImport(user_id=user_id, pdf_path=pdf_path)

    return ImportProposal(
        statement_id=statement.id,
        status=STATUS_AWAITING_EXTRACTOR,
        issuer_id=issuer_id,
        parser_id=selected.id,
        layout_spec_id=layout_spec_id,
        detect_score=score,
        confident=_is_confident(issuer_id, score, STATUS_AWAITING_EXTRACTOR),
    )


def _is_confident(issuer_id: int | None, score: float | None, status: str) -> bool:
    """§3.12a: "issuer matched AND spec/parser resolved AND score >= 0.8"."""
    return (
        status == STATUS_AWAITING_EXTRACTOR
        and issuer_id is not None
        and score is not None
        and score >= CONFIDENT_SCORE_THRESHOLD
    )


def _copy_statement(pdf_path: Path, file_sha256: str) -> str:
    ensure_home()
    dest = statements_dir() / f"{file_sha256}.pdf"
    if not dest.exists():
        dest.write_bytes(pdf_path.read_bytes())
    return str(dest)


def _detect_score(parser: StatementParser, doc: ExtractedDoc) -> float:
    """Mirrors `registry._safe_detect`: a raising `detect()` scores `0.0` rather than crashing
    selection (§3.1 requires `detect()` to never raise, but this module does not trust that)."""
    try:
        return parser.detect(doc)
    except Exception:  # detect() must never raise; treat a violation as no confidence
        logger.warning("parser %r raised in detect(); scoring 0.0", parser.id, exc_info=True)
        return 0.0


def _select_parser(
    session: Session, doc: ExtractedDoc, issuer_id: int | None
) -> tuple[StatementParser, float, int | None]:
    """Score every built-in/entry-point parser plus, when an issuer matched, every approved
    layout spec remembered for that issuer (§2f.1, §2f.2) — for every account type, since the
    account type is not known until parsing runs and a spec's own `account_type` is usually a
    stronger signal than guessing one first. Returns the winning parser, its `detect()` score,
    and the `layout_specs.id` it came from (`None` for a built-in parser)."""
    candidates: list[StatementParser] = list(discover_all_parsers())
    spec_by_parser_id: dict[str, LayoutSpec] = {}
    if issuer_id is not None:
        for account_type in ("credit", "checking", "savings"):
            spec_row = resolve_spec(session, issuer_id=issuer_id, account_type=account_type)
            if spec_row is not None and spec_row.parser_id not in spec_by_parser_id:
                spec_by_parser_id[spec_row.parser_id] = spec_row
                candidates.append(cast(StatementParser, build_parser_for_row(spec_row)))

    selected = select_parser(doc, candidates)
    score = _detect_score(selected, doc)
    layout_spec_id = spec_by_parser_id[selected.id].id if selected.id in spec_by_parser_id else None
    return selected, score, layout_spec_id


# ------------------------------------------------------------------------------------------------
# Kind resolution (see the module docstring's contract note) and the transfer override (I11, A26)
# ------------------------------------------------------------------------------------------------

_CONCRETE_KINDS: frozenset[str] = frozenset(
    {"purchase", "refund", "payment", "transfer", "fee", "interest", "adjustment"}
)


def _resolve_kind(hint: KindHint | None, description: str, amount_minor: int) -> Kind:
    """Resolve a `RawTransaction.kind_hint` to a concrete `Kind` (`transactions.kind` is
    `NOT NULL`). See the module docstring for why this lives here rather than in
    `classify/kinds.py`.

    - An already-concrete hint (every layout parser but the ambiguous payments/credits section of
      A/B/C) passes through unchanged.
    - `'payment_or_refund'` resolves by pattern (A29): a payment pattern -> `payment`, else
      `refund`.
    - No hint at all (the generic parser never emits one): an outflow is a `purchase`. An inflow
      is ambiguous exactly the same way an A/B/C payments/credits section is, so it gets the same
      pattern check rather than defaulting straight to `refund`.
    """
    if hint is not None and hint in _CONCRETE_KINDS:
        return hint  # type: ignore[return-value]
    if hint is None and amount_minor >= 0:
        return "purchase"
    return "payment" if _PAYMENT_PATTERN_RE.search(description) else "refund"


def _apply_transfer_override(kind: Kind, description: str, account_type: str) -> Kind:
    """I11/A26: on a checking/savings account, a row that looks like a payment *to* a credit
    card is a `transfer`, never spend — regardless of which section it printed in. `layout_d_bank`
    already applies this itself; this override exists so the generic parser's debit/credit mode
    (which emits no kind hint) gets the same treatment (D11)."""
    if (
        account_type in ("checking", "savings")
        and kind in ("purchase", "payment")
        and _CARD_PAYMENT_RE.search(description)
    ):
        return "transfer"
    return kind


# ------------------------------------------------------------------------------------------------
# Phase 2 — confirm_import
# ------------------------------------------------------------------------------------------------


def confirm_import(
    session: Session,
    statement_id: int,
    *,
    issuer_id: int,
    parser_id: str | None,
    layout_spec_id: int | None,
    remember: bool,
) -> ImportResult:
    """Phase 2 of A22: parse, normalize, reconcile, dedupe, and persist a statement's
    transactions in one atomic transaction.

    Args:
        session: an open session. Commits the statement + transaction rows atomically on success,
            and commits an `error`/`unsupported_layout` status update on failure before
            re-raising, so a re-import of the same bad file returns the same clear message
            instead of reprocessing (the WP's "failure handling" requirement).
        statement_id: a statement previously returned by `propose_import`.
        issuer_id: the issuer to pin to this statement (auto-matched or user-picked; never
            ambiguous by the time this is called).
        parser_id: a built-in parser id to use, or `None` when `layout_spec_id` selects one.
        layout_spec_id: an approved `layout_specs.id` to use, or `None` when `parser_id` selects
            one. Exactly one of `parser_id`/`layout_spec_id` must be given.
        remember: when `True` and the import reconciles cleanly with no drift, updates
            `issuers.default_spec_id` (only when a layout spec, not a built-in parser, was used)
            and `issuers.last_used_at` (A23).

    Returns:
        An `ImportResult`. `inserted`/`skipped_duplicates`/`transaction_ids` all refer to *this*
        call — reconfirming an already-`parsed` statement is a no-op that reports zero of each.

    Raises:
        SpendAnalyzerError: the statement was not found, or no pending upload is remembered for it
            and it carries no durable PDF copy to re-parse from (see the module docstring on
            in-process pending-import bookkeeping).
        ValueError: neither or both of `parser_id`/`layout_spec_id` were given.
        UnsupportedLayoutError: the generic parser found too few transactions to be usable.
            `statements.status` is set to `'unsupported_layout'` before this is re-raised.
        ParserError: the parser could not otherwise parse the statement (e.g. an unresolvable
            year-less date). `statements.status` is set to `'error'` before this is re-raised.
    """
    statement = session.get(Statement, statement_id)
    if statement is None:
        raise SpendAnalyzerError(f"no statement with id={statement_id}")

    if statement.status == STATUS_PARSED:
        return ImportResult(
            statement_id=statement.id,
            inserted=0,
            skipped_duplicates=statement.txn_count or 0,
            transaction_ids=(),
            reconciliation_delta_minor=None,
            layout_drift=False,
            warnings=(),
        )

    if (parser_id is None) == (layout_spec_id is None):
        raise ValueError("exactly one of parser_id or layout_spec_id must be given")

    path, user_id = _resolve_pending_source(statement)
    doc = extract(path)
    parser = _resolve_parser(session, parser_id=parser_id, layout_spec_id=layout_spec_id)

    try:
        parsed = parser.parse(doc)
    except UnsupportedLayoutError as exc:
        _mark_failed(session, statement, STATUS_UNSUPPORTED_LAYOUT, str(exc))
        raise
    except ParserError as exc:
        _mark_failed(session, statement, STATUS_ERROR, str(exc))
        raise

    result = _persist_parsed_statement(
        session,
        statement=statement,
        parsed=parsed,
        user_id=user_id,
        issuer_id=issuer_id,
        parser=parser,
        layout_spec_id=layout_spec_id,
        remember=remember,
    )
    _PENDING_IMPORTS.pop(statement.id, None)
    return result


def _resolve_pending_source(statement: Statement) -> tuple[Path, int]:
    pending = _PENDING_IMPORTS.get(statement.id)
    if pending is not None:
        return pending.pdf_path, pending.user_id
    if statement.stored_path is not None:
        raise SpendAnalyzerError(
            f"statement {statement.id} has no remembered user for this import (the server may "
            "have restarted since it was proposed); re-propose the same file to resume"
        )
    raise SpendAnalyzerError(
        f"statement {statement.id} has no PDF copy on disk and no pending upload in memory; "
        "re-propose the file to resume"
    )


def _mark_failed(session: Session, statement: Statement, status: str, error_detail: str) -> None:
    statement.status = status
    statement.error_detail = error_detail
    session.commit()


def _resolve_parser(
    session: Session, *, parser_id: str | None, layout_spec_id: int | None
) -> StatementParser:
    if layout_spec_id is not None:
        row = session.get(LayoutSpec, layout_spec_id)
        if row is None:
            raise SpendAnalyzerError(f"no layout_specs row with id={layout_spec_id}")
        return cast(StatementParser, build_parser_for_row(row))

    if parser_id == generic_table.id:
        return generic_table
    for candidate in discover_all_parsers():
        if candidate.id == parser_id:
            return candidate
    raise UnsupportedLayoutError(f"no parser registered with id={parser_id!r}")


# ------------------------------------------------------------------------------------------------
# Persistence: normalize, resolve the account, reconcile, evaluate drift, dedupe-insert
# ------------------------------------------------------------------------------------------------


def _persist_parsed_statement(
    session: Session,
    *,
    statement: Statement,
    parsed: ParsedStatement,
    user_id: int,
    issuer_id: int,
    parser: StatementParser,
    layout_spec_id: int | None,
    remember: bool,
) -> ImportResult:
    settings = load_settings()
    account_type = parsed.account_hint.account_type or parser.account_type
    mask = parsed.account_hint.mask or ""
    currency = parsed.account_hint.currency or settings.ingest.default_currency

    issuer = session.get(Issuer, issuer_id)
    if issuer is None:
        raise SpendAnalyzerError(f"no issuers row with id={issuer_id}")
    account = _resolve_account(
        session,
        user_id=user_id,
        issuer_id=issuer_id,
        account_type=account_type,
        mask=mask,
        currency=currency,
        issuer_name=issuer.name,
    )

    pii_terms = _gather_pii_terms(session, settings, user_id)

    rows: list[dict[str, object]] = []
    dedupe_keys: list[DedupeKey] = []
    for raw in parsed.transactions:
        normalized = normalize(raw.description, pii_terms)
        kind = _resolve_kind(raw.kind_hint, raw.description, raw.amount_minor)
        kind = _apply_transfer_override(kind, raw.description, account_type)
        posted_date_iso = raw.posted_date.isoformat()
        dedupe_keys.append(
            DedupeKey(
                account_id=account.id,
                posted_date=posted_date_iso,
                amount_minor=raw.amount_minor,
                description_raw=raw.description,
            )
        )
        rows.append(
            {
                "statement_id": statement.id,
                "account_id": account.id,
                "user_id": user_id,
                "posted_date": posted_date_iso,
                "transaction_date": raw.transaction_date.isoformat()
                if raw.transaction_date
                else None,
                "description_raw": raw.description,
                "description_clean": normalized.description_clean,
                "merchant_key": normalized.merchant_key,
                "issuer_category": raw.issuer_category,
                "amount_minor": raw.amount_minor,
                "currency": raw.currency,
                "fx_amount_minor": raw.fx_amount_minor,
                "fx_currency": raw.fx_currency,
                "fx_rate": raw.fx_rate,
                "kind": kind,
                "is_spend": kind in ("purchase", "fee", "interest"),
            }
        )

    occurrence_indices = compute_occurrence_indices(dedupe_keys)
    for row, key, occurrence_index in zip(rows, dedupe_keys, occurrence_indices, strict=True):
        row["dedupe_hash"] = compute_dedupe_hash(key, occurrence_index)

    reconciliation_delta, reconciliation_mismatch, section_warnings = _reconcile(
        parsed, account_type
    )

    previous = _previous_statement(session, account.id, exclude_statement_id=statement.id)
    layout_drift, shape_warnings = _evaluate_drift(
        parsed_warnings=parsed.warnings + section_warnings,
        reconciliation_mismatch=reconciliation_mismatch,
        detect_score=statement.detect_score,
        previous_detect_score=previous.detect_score if previous is not None else None,
    )

    inserted_ids = _insert_transactions(session, rows)

    statement.status = STATUS_PARSED
    statement.error_detail = None
    statement.parser_id = parser.id
    statement.parser_version = parser.version
    statement.account_id = account.id
    statement.issuer_id = issuer_id
    statement.layout_spec_id = layout_spec_id
    statement.period_start = parsed.period_start.isoformat() if parsed.period_start else None
    statement.period_end = parsed.period_end.isoformat() if parsed.period_end else None
    statement.txn_count = len(inserted_ids)
    statement.parsed_total_minor = sum(t.amount_minor for t in parsed.transactions)
    statement.stated_total_minor = parsed.stated_total_minor
    statement.opening_balance_minor = parsed.opening_balance_minor
    statement.closing_balance_minor = parsed.closing_balance_minor
    statement.shape_warnings = json.dumps(list(shape_warnings)) if shape_warnings else None

    clean_import = not layout_drift and not reconciliation_mismatch
    if remember and clean_import:
        if layout_spec_id is not None:
            issuer.default_spec_id = layout_spec_id
        issuer.last_used_at = _utcnow_iso()

    session.commit()

    if account_type in ("checking", "savings"):
        _pair_transfers(session, account=account, user_id=user_id, inserted_ids=inserted_ids)
        session.commit()

    return ImportResult(
        statement_id=statement.id,
        inserted=len(inserted_ids),
        skipped_duplicates=len(rows) - len(inserted_ids),
        transaction_ids=tuple(inserted_ids),
        reconciliation_delta_minor=reconciliation_delta,
        layout_drift=layout_drift,
        warnings=shape_warnings,
    )


def _resolve_account(
    session: Session,
    *,
    user_id: int,
    issuer_id: int,
    account_type: str,
    mask: str,
    currency: str,
    issuer_name: str,
) -> Account:
    """Resolve `(user_id, issuer_id, mask, account_type)` to an `Account`, creating it if absent
    (D4)."""
    existing = (
        session.execute(
            select(Account).where(
                Account.user_id == user_id,
                Account.issuer_id == issuer_id,
                Account.mask == mask,
                Account.account_type == account_type,
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing

    display_name = f"{issuer_name} {account_type}" + (f" ...{mask}" if mask else "")
    account = Account(
        user_id=user_id,
        issuer_id=issuer_id,
        account_type=account_type,
        display_name=display_name,
        mask=mask,
        currency=currency,
    )
    session.add(account)
    session.flush()
    return account


def _gather_pii_terms(session: Session, settings: Settings, user_id: int) -> tuple[str, ...]:
    """A17: issuer names and `match_terms` are added to the redaction term list, alongside the
    configured `[privacy] pii_terms` and this user's `pii_aliases` (D10/A11)."""
    terms: set[str] = set(settings.privacy.pii_terms)
    user = session.get(User, user_id)
    if user is not None:
        with contextlib.suppress(json.JSONDecodeError, TypeError):
            terms.update(json.loads(user.pii_aliases))
    for issuer in session.execute(select(Issuer)).scalars():
        terms.add(issuer.name)
        with contextlib.suppress(json.JSONDecodeError, TypeError):
            terms.update(json.loads(issuer.match_terms))
    return tuple(sorted(terms))


def _insert_transactions(session: Session, rows: list[dict[str, object]]) -> list[int]:
    """Bulk-insert ``rows``, skipping any that collide with an existing
    `(account_id, dedupe_hash)` (§3.5) via `INSERT ... ON CONFLICT DO NOTHING`, and return the ids
    that were actually inserted (via `RETURNING`, which reports only the rows the conflict clause
    did not drop)."""
    if not rows:
        return []
    stmt = (
        sqlite_insert(Transaction)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["account_id", "dedupe_hash"])
        .returning(Transaction.id)
    )
    result = session.execute(stmt)
    return [row[0] for row in result]


# ------------------------------------------------------------------------------------------------
# Reconciliation (A25) and drift evaluation (A18)
# ------------------------------------------------------------------------------------------------


def _reconcile(
    parsed: ParsedStatement, account_type: str
) -> tuple[int | None, bool, tuple[str, ...]]:
    """A25: the balance equation is the primary check; `stated_total_minor` is a fallback only
    when no balances were read. Section totals (A15) additionally localize a mismatch to one
    section, recorded as extra warnings, but never override the primary check's verdict.

    Returns:
        ``(delta_minor, mismatch, warnings)``. ``delta_minor`` is `None` when neither check was
        possible.
    """
    total = sum(t.amount_minor for t in parsed.transactions)
    delta: int | None
    if parsed.opening_balance_minor is not None and parsed.closing_balance_minor is not None:
        if account_type == "credit":
            expected = parsed.closing_balance_minor - parsed.opening_balance_minor
        else:
            expected = parsed.opening_balance_minor - parsed.closing_balance_minor
        delta = total - expected
    elif parsed.stated_total_minor is not None:
        delta = total - parsed.stated_total_minor
    else:
        delta = None

    mismatch = delta is not None and delta != 0
    warnings: list[str] = []
    if mismatch:
        warnings.append(f"reconciliation delta is {delta} minor units (non-zero)")

    if parsed.section_totals:
        actual_by_section: dict[str, int] = {}
        for txn in parsed.transactions:
            label = txn.section or ""
            actual_by_section[label] = actual_by_section.get(label, 0) + txn.amount_minor
        for label, stated in parsed.section_totals:
            actual = actual_by_section.get(label, 0)
            if actual != stated:
                warnings.append(
                    f"section {label!r} totals {actual} but the statement states {stated}"
                )

    return delta, mismatch, tuple(warnings)


def _previous_statement(
    session: Session, account_id: int, *, exclude_statement_id: int
) -> Statement | None:
    """The account's most recently ingested *other* parsed statement, for drift comparison."""
    return (
        session.execute(
            select(Statement)
            .where(
                Statement.account_id == account_id,
                Statement.status == STATUS_PARSED,
                Statement.id != exclude_statement_id,
            )
            .order_by(Statement.ingested_at.desc())
        )
        .scalars()
        .first()
    )


def _evaluate_drift(
    *,
    parsed_warnings: tuple[str, ...],
    reconciliation_mismatch: bool,
    detect_score: float | None,
    previous_detect_score: float | None,
) -> tuple[bool, tuple[str, ...]]:
    """§2d.1: any of a reconciliation delta, a parser shape-assertion failure, or a detect-score
    decay from the account's previous statement trips `layout_drift`."""
    warnings = list(parsed_warnings)
    drift = bool(parsed_warnings) or reconciliation_mismatch

    if (
        detect_score is not None
        and previous_detect_score is not None
        and abs(detect_score - previous_detect_score) >= DETECT_SCORE_DRIFT_THRESHOLD
    ):
        drift = True
        warnings.append(
            f"detect_score changed from {previous_detect_score:.2f} to {detect_score:.2f} "
            "since this account's previous statement"
        )

    return drift, tuple(warnings)


# ------------------------------------------------------------------------------------------------
# Transfer pairing (I11, A26)
# ------------------------------------------------------------------------------------------------


def _pair_transfers(
    session: Session, *, account: Account, user_id: int, inserted_ids: list[int]
) -> None:
    """After persisting a checking/savings statement, link each newly inserted `transfer`
    transaction to a same-user credit-account `payment` of equal magnitude within
    ±`_TRANSFER_PAIR_WINDOW_DAYS` days (I11, A26). Both sides are already excluded from spend by
    `kind`; the link (stored in `notes`, no schema change per the plan) lets a *missed* pattern
    surface later as an unmatched payment rather than silently double-counting."""
    if not inserted_ids:
        return
    transfers = (
        session.execute(
            select(Transaction).where(
                Transaction.id.in_(inserted_ids), Transaction.kind == "transfer"
            )
        )
        .scalars()
        .all()
    )
    if not transfers:
        return

    credit_account_ids = (
        session.execute(
            select(Account.id).where(Account.user_id == user_id, Account.account_type == "credit")
        )
        .scalars()
        .all()
    )
    if not credit_account_ids:
        return

    for transfer in transfers:
        if transfer.notes is not None:
            continue
        window_start = _shift_iso_date(transfer.posted_date, -_TRANSFER_PAIR_WINDOW_DAYS)
        window_end = _shift_iso_date(transfer.posted_date, _TRANSFER_PAIR_WINDOW_DAYS)
        candidate = (
            session.execute(
                select(Transaction).where(
                    Transaction.account_id.in_(credit_account_ids),
                    Transaction.kind == "payment",
                    Transaction.amount_minor == -transfer.amount_minor,
                    Transaction.posted_date >= window_start,
                    Transaction.posted_date <= window_end,
                    Transaction.notes.is_(None),
                )
            )
            .scalars()
            .first()
        )
        if candidate is not None:
            transfer.notes = json.dumps({"transfer_pair_id": candidate.id})
            candidate.notes = json.dumps({"transfer_pair_id": transfer.id})


def _shift_iso_date(iso_date: str, days: int) -> str:
    return (date.fromisoformat(iso_date) + timedelta(days=days)).isoformat()


# ------------------------------------------------------------------------------------------------
# reparse and reassign
# ------------------------------------------------------------------------------------------------


def reparse(
    session: Session, statement_id: int, *, parser_id: str | None, layout_spec_id: int | None
) -> ImportResult:
    """Re-run a *previously confirmed* statement with a different extractor, rebuilding its rows
    (the API surface's ``POST /api/statements/{id}/reparse``).

    Requires a durable PDF copy (``statements.stored_path``, `[privacy] store_pdf_copies`) since,
    unlike `confirm_import`, there is no fresh upload to fall back to for an older statement.

    Does not commit (per §3.12a: this function is not documented as committing); the caller
    controls the transaction.

    Raises:
        SpendAnalyzerError: the statement was not found, has no account yet (never confirmed), or
            has no PDF copy on disk to re-parse from.
        ValueError: neither or both of `parser_id`/`layout_spec_id` were given.
    """
    statement = session.get(Statement, statement_id)
    if statement is None:
        raise SpendAnalyzerError(f"no statement with id={statement_id}")
    if statement.account_id is None:
        raise SpendAnalyzerError(f"statement {statement_id} has never been confirmed")
    if statement.stored_path is None:
        raise SpendAnalyzerError(
            f"statement {statement_id} has no PDF copy on disk to reparse from "
            "([privacy] store_pdf_copies was disabled at import time)"
        )
    if (parser_id is None) == (layout_spec_id is None):
        raise ValueError("exactly one of parser_id or layout_spec_id must be given")

    account = session.get(Account, statement.account_id)
    if account is None:  # pragma: no cover - defensive; FK integrity guarantees this
        raise SpendAnalyzerError(f"account {statement.account_id} not found")

    doc = extract(Path(statement.stored_path))
    parser = _resolve_parser(session, parser_id=parser_id, layout_spec_id=layout_spec_id)

    try:
        parsed = parser.parse(doc)
    except UnsupportedLayoutError as exc:
        statement.status = STATUS_UNSUPPORTED_LAYOUT
        statement.error_detail = str(exc)
        raise
    except ParserError as exc:
        statement.status = STATUS_ERROR
        statement.error_detail = str(exc)
        raise

    # Rebuild: this statement's own rows are cleared first, so the standard dedupe-insert path
    # below only ever collides with *other* statements' rows on the same account (§3.5).
    session.execute(delete(Transaction).where(Transaction.statement_id == statement.id))
    session.flush()

    result = _persist_parsed_statement(
        session,
        statement=statement,
        parsed=parsed,
        user_id=account.user_id,
        issuer_id=account.issuer_id,
        parser=parser,
        layout_spec_id=layout_spec_id,
        remember=False,  # reparse is an explicit override; it never rewrites the remembered spec
    )
    return result


def reassign(
    session: Session, statement_id: int, *, user_id: int, account_id: int
) -> tuple[int, int]:
    """Move a statement (and its transactions) to a different account/user, recomputing
    `dedupe_hash` for every row (D4, §3.5).

    A row whose recomputed hash collides with one already on the target account is a true
    duplicate and is deleted rather than moved. Does not commit (per §3.12a); the caller controls
    the transaction.

    Returns:
        ``(rows_moved, duplicates_deleted)``.

    Raises:
        SpendAnalyzerError: the statement was not found.
    """
    statement = session.get(Statement, statement_id)
    if statement is None:
        raise SpendAnalyzerError(f"no statement with id={statement_id}")

    # Recompute occurrence_index fresh, in the same (id) order the rows were originally inserted
    # in, per §3.5 — the content has not changed, only the account they belong to.
    transactions = list(
        session.execute(
            select(Transaction)
            .where(Transaction.statement_id == statement_id)
            .order_by(Transaction.id)
        )
        .scalars()
        .all()
    )
    keys = [
        DedupeKey(
            account_id=account_id,
            posted_date=t.posted_date,
            amount_minor=t.amount_minor,
            description_raw=t.description_raw,
        )
        for t in transactions
    ]
    occurrence_indices = compute_occurrence_indices(keys)

    rows_moved = 0
    duplicates_deleted = 0
    for txn, key, occurrence_index in zip(transactions, keys, occurrence_indices, strict=True):
        new_hash = compute_dedupe_hash(key, occurrence_index)
        collision = (
            session.execute(
                select(Transaction.id).where(
                    Transaction.account_id == account_id,
                    Transaction.dedupe_hash == new_hash,
                    Transaction.id != txn.id,
                )
            )
            .scalars()
            .first()
        )
        if collision is not None:
            session.delete(txn)
            duplicates_deleted += 1
            continue
        txn.account_id = account_id
        txn.user_id = user_id
        txn.dedupe_hash = new_hash
        rows_moved += 1

    statement.account_id = account_id
    session.flush()
    return rows_moved, duplicates_deleted
