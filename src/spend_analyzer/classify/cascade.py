"""The classification cascade (§3.12a, §2b P2-B, A28).

`classify_transactions` is the only entry point that reaches the LLM. Every other function here
is a deterministic, local, first-hit-wins cascade over already-persisted `Transaction` rows:

1. **Kind** — `Transaction.kind` is set by the ingest pipeline (P2-A) from `classify/kinds.py`,
   *before* this module ever sees the row. If it is already `payment` or `transfer`, this module
   assigns `others/payments_transfers`, `is_spend=0`, `classified_by='kind'`, and stops: these
   transactions never reach the LLM (I11, A26).
2. **User rules** — `rules` where `source='user'`, by `priority` then `id`, matched against
   `merchant_key` (`classify/rules.py`).
3. **User corrections** — a `merchant_map` hit with `source='user'` (I6); increments `hit_count`.
4. **Built-in rules** — `rules` where `source='builtin'`, seeded from `builtin_rules.yaml` by
   `rules.sync_builtin_rules` (D8).
5. **Issuer category** — `Transaction.issuer_category` resolved via `rules.resolve_issuer_category`
   (A16); writes `merchant_map(source='issuer')` on a hit. `issuer_category` is local-only (I1b)
   and never appears in any egress payload.
6. **Learned cache** — a `merchant_map` hit with `source IN ('llm', 'issuer')`; increments
   `hit_count`.
7. **LLM batch** — everything left, deduplicated by `merchant_key`, one representative
   `description_clean` per key (A5: the modal value, tie-broken shortest then lexicographic).
   A row the LLM never successfully classifies (`classify.llm.batching`'s own fallback, or no
   provider configured at all, D2) lands in `others/uncategorized` with `needs_review=True` —
   step 8's fallback is already built into that result, so there is no separate step here.

`merchant_key` is never written to `merchant_map` when empty (A27). A result's
`confidence < cfg.confidence_threshold` always sets `needs_review=True`, on top of any
step-specific reason (a dynamic online-shopping subcategory still pending approval, most notably).
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from spend_analyzer.classify.kinds import is_spend as kind_is_spend
from spend_analyzer.classify.llm.batching import classify_all
from spend_analyzer.classify.llm.egress import BatchResult, preview_payload
from spend_analyzer.classify.llm.schema import Item
from spend_analyzer.classify.rules import (
    resolve_issuer_category,
    rule_matches,
    sync_builtin_rules,
)
from spend_analyzer.classify.taxonomy import is_dynamic
from spend_analyzer.config import LLMConfig
from spend_analyzer.core.errors import ConfigError
from spend_analyzer.core.types import Kind
from spend_analyzer.db.models import (
    Category,
    Classification,
    LlmRun,
    MerchantMap,
    Rule,
    Subcategory,
    Transaction,
    utcnow_iso,
)

logger = logging.getLogger(__name__)

#: Kinds that never reach the classification cascade at all (I11, A26, cascade step 1).
_NON_SPEND_KINDS: frozenset[str] = frozenset({"payment", "transfer"})

#: How many transactions the deterministic phase (steps 1-6) processes before an intermediate
#: commit, so a long run's progress survives a crash or reload without waiting for the whole
#: batch (the plan's "commits per batch"; the LLM phase commits once, after `classify_all`
#: returns, since it already batches and retries internally — see `classify_transactions`).
_DETERMINISTIC_COMMIT_CHUNK = 200

#: `others/payments_transfers` — the fixed destination for every payment/transfer row (I11).
_PAYMENTS_TRANSFERS_CATEGORY = "others"
_PAYMENTS_TRANSFERS_SUBCATEGORY = "payments_transfers"
_UNCATEGORIZED_CATEGORY = "others"
_UNCATEGORIZED_SUBCATEGORY = "uncategorized"


@dataclass(frozen=True, slots=True)
class ClassifyResult:
    """The outcome of one `classify_transactions` call (§3.12a)."""

    group_id: str
    classified: int
    needs_review: int
    llm_requests: int
    cost_usd: float


@dataclass(frozen=True, slots=True)
class _Outcome:
    """One cascade step's proposed classification for a transaction, before it is written."""

    category_key: str
    subcategory_key: str
    confidence: float | None
    classified_by: str  # cache|user_rule|builtin_rule|issuer|llm|user|kind
    merchant_canonical: str | None = None
    kind_override: str | None = None
    needs_review_override: bool = False


def classify_transactions(
    session_factory: Callable[[], Session],
    transaction_ids: Sequence[int],
    *,
    cfg: LLMConfig,
    group_id: str,
    progress_cb: Callable[[int, int, float], None],
) -> ClassifyResult:
    """Run the cascade over `transaction_ids` and persist a classification for every one of them.

    Args:
        session_factory: opens a new `Session`; called once per phase (the deterministic
            steps 1-6, then, if anything remains, the LLM phase), so a caller-provided
            connection pool is never held open longer than necessary.
        transaction_ids: the transactions to classify. An id that no longer exists is skipped.
        cfg: the LLM provider configuration (`[llm]`, `config.toml`).
        group_id: shared across every `llm_runs` row this call writes (A2).
        progress_cb: called as `progress_cb(done, total, cost_usd)` after every deterministic
            commit chunk and once more after the LLM phase completes. `done`/`total` count
            transactions; during the LLM phase, `done` is estimated from `classify_all`'s own
            (merchant-key-counted) progress, since a merchant key can cover several transactions.

    Returns:
        A `ClassifyResult` summarizing the run. `classified` counts every transaction processed
        (every one ends up with a category and subcategory, I4 — including the
        `others/uncategorized` fallback); `needs_review` counts those flagged for review;
        `llm_requests` is the number of underlying LLM calls actually made (initial calls and
        retries); `cost_usd` is their summed cost.
    """
    total = len(transaction_ids)
    if total == 0:
        progress_cb(0, 0, 0.0)
        return ClassifyResult(
            group_id=group_id, classified=0, needs_review=0, llm_requests=0, cost_usd=0.0
        )

    classified = 0
    needs_review = 0
    pending_llm: dict[str, list[int]] = {}

    session = session_factory()
    try:
        sync_builtin_rules(session)
        session.commit()

        user_rules, builtin_rules = _load_rule_sets(session)

        done = 0
        since_commit = 0
        for txn_id in transaction_ids:
            txn = session.get(Transaction, txn_id)
            done += 1
            since_commit += 1
            if txn is None:
                continue
            outcome = _classify_deterministic(
                session, txn, user_rules=user_rules, builtin_rules=builtin_rules
            )
            if outcome is None:
                pending_llm.setdefault(txn.merchant_key, []).append(txn.id)
            else:
                _apply_outcome(session, txn, outcome, cfg=cfg)
                classified += 1
                if txn.needs_review:
                    needs_review += 1
            if since_commit >= _DETERMINISTIC_COMMIT_CHUNK:
                session.commit()
                since_commit = 0
                progress_cb(done, total, 0.0)
        session.commit()
        progress_cb(done, total, 0.0)
    finally:
        session.close()

    llm_requests = 0
    cost_usd = 0.0
    if pending_llm:
        classified_delta, needs_review_delta, llm_requests, cost_usd = _run_llm_phase(
            session_factory,
            pending_llm,
            cfg=cfg,
            group_id=group_id,
            deterministic_done=done,
            total=total,
            progress_cb=progress_cb,
        )
        classified += classified_delta
        needs_review += needs_review_delta

    return ClassifyResult(
        group_id=group_id,
        classified=classified,
        needs_review=needs_review,
        llm_requests=llm_requests,
        cost_usd=cost_usd,
    )


def _run_llm_phase(
    session_factory: Callable[[], Session],
    pending_llm: dict[str, list[int]],
    *,
    cfg: LLMConfig,
    group_id: str,
    deterministic_done: int,
    total: int,
    progress_cb: Callable[[int, int, float], None],
) -> tuple[int, int, int, float]:
    """Classify every merchant key in `pending_llm` via the LLM and persist the results.

    Returns `(classified, needs_review, llm_requests, cost_usd)` for this phase only.
    """
    merchant_keys = sorted(pending_llm)

    session = session_factory()
    try:
        representative = {
            key: _select_representative(
                [
                    d
                    for d in (_description_of(session, tid) for tid in pending_llm[key])
                    if d is not None
                ]
            )
            for key in merchant_keys
        }

        def _llm_progress(llm_done: int, llm_total: int, running_cost: float) -> None:
            if llm_total <= 0:
                return
            fraction = llm_done / llm_total
            done = deterministic_done + round(fraction * (total - deterministic_done))
            progress_cb(min(total, done), total, running_cost)

        run_result = classify_all(
            [representative[key] for key in merchant_keys],
            cfg,
            group_id=group_id,
            progress_cb=_llm_progress,
        )

        llm_run_ids = [_persist_llm_run(session, run, group_id=group_id) for run in run_result.runs]
        # `classify_all` does not expose which underlying batch (initial call vs. retry)
        # resolved each result, so every `classifications` row from this call is linked to the
        # *first* run — every `llm_runs` row this call produced still shares `group_id`, which
        # is what auditing (`GET /api/classify/runs`) groups by.
        primary_llm_run_id = llm_run_ids[0] if llm_run_ids else None

        classified = 0
        needs_review = 0
        for key, result in zip(merchant_keys, run_result.results, strict=True):
            outcome = _outcome_from_item(session, result.item, batch_flagged=result.needs_review)
            _write_merchant_map(session, key, outcome, source="llm")
            for txn_id in pending_llm[key]:
                txn = session.get(Transaction, txn_id)
                if txn is None:
                    continue
                _apply_outcome(session, txn, outcome, cfg=cfg, llm_run_id=primary_llm_run_id)
                classified += 1
                if txn.needs_review:
                    needs_review += 1
        session.commit()
        progress_cb(total, total, sum(r.cost_usd for r in run_result.runs))
        return (
            classified,
            needs_review,
            len(run_result.runs),
            sum(r.cost_usd for r in run_result.runs),
        )
    finally:
        session.close()


def preview_egress(session: Session, transaction_ids: Sequence[int]) -> str:
    """Return exactly the CSV `classify_transactions` would send next for `transaction_ids`.

    Applies cascade steps 1-6 as a dry run (no writes, including no `merchant_map` writes) to
    determine which transactions would actually reach the LLM, then deduplicates the rest by
    `merchant_key` exactly as step 7 does (A5). Makes no network call.
    """
    sync_builtin_rules(session)
    user_rules, builtin_rules = _load_rule_sets(session)

    pending: dict[str, list[str]] = {}
    for txn_id in transaction_ids:
        txn = session.get(Transaction, txn_id)
        if txn is None:
            continue
        outcome = _classify_deterministic(
            session, txn, user_rules=user_rules, builtin_rules=builtin_rules, dry_run=True
        )
        if outcome is None:
            pending.setdefault(txn.merchant_key, []).append(txn.description_clean)

    representative = [_select_representative(pending[key]) for key in sorted(pending)]
    return preview_payload(representative)


def apply_user_correction(
    session: Session,
    transaction_id: int,
    *,
    category_key: str,
    subcategory_key: str,
    kind: Kind | None,
    create_rule: bool,
) -> None:
    """Apply a user's correction to one transaction (I6, §3.12a).

    Writes `merchant_map(source='user')` for the transaction's `merchant_key` (never overwritten
    by cache, rules, or the LLM afterwards) and, if `create_rule`, a `rules` row
    (`source='user'`, `match_type='exact'`, matched against `merchant_key`) so future imports of
    the same merchant need no correction at all. Does not commit.

    Raises:
        ConfigError: `transaction_id` does not exist, or `category_key`/`subcategory_key` is not
            a valid taxonomy pair.
    """
    txn = session.get(Transaction, transaction_id)
    if txn is None:
        raise ConfigError(f"no transaction with id {transaction_id}")

    category = session.execute(
        select(Category).where(Category.key == category_key)
    ).scalar_one_or_none()
    if category is None:
        raise ConfigError(f"unknown category {category_key!r}")
    subcategory = session.execute(
        select(Subcategory).where(
            Subcategory.category_id == category.id, Subcategory.key == subcategory_key
        )
    ).scalar_one_or_none()
    if subcategory is None:
        raise ConfigError(f"unknown subcategory {subcategory_key!r} for category {category_key!r}")

    if kind is not None and kind != txn.kind:
        txn.kind = kind
        txn.is_spend = kind_is_spend(kind)

    txn.category_id = category.id
    txn.subcategory_id = subcategory.id
    txn.confidence = 1.0
    txn.classified_by = "user"
    txn.needs_review = False
    txn.updated_at = utcnow_iso()
    session.add(
        Classification(
            transaction_id=txn.id,
            category_key=category_key,
            subcategory_key=subcategory_key,
            confidence=1.0,
            method="user",
            llm_run_id=None,
        )
    )

    if txn.merchant_key:
        row = session.get(MerchantMap, txn.merchant_key)
        if row is None:
            session.add(
                MerchantMap(
                    merchant_key=txn.merchant_key,
                    merchant_canonical=txn.merchant_canonical,
                    category_id=category.id,
                    subcategory_id=subcategory.id,
                    source="user",
                    confidence=1.0,
                    hit_count=0,
                    updated_at=utcnow_iso(),
                )
            )
        else:
            row.merchant_canonical = txn.merchant_canonical or row.merchant_canonical
            row.category_id = category.id
            row.subcategory_id = subcategory.id
            row.source = "user"
            row.confidence = 1.0
            row.updated_at = utcnow_iso()

    if create_rule and txn.merchant_key:
        session.add(
            Rule(
                user_id=txn.user_id,
                match_type="exact",
                pattern=txn.merchant_key,
                category_id=category.id,
                subcategory_id=subcategory.id,
                kind_override=kind,
                priority=50,
                enabled=True,
                source="user",
            )
        )
    session.flush()


def approve_subcategory(session: Session, subcategory_id: int) -> None:
    """Flip a `pending_approval` dynamic subcategory to `active` (§2b P2-B). Does not commit.

    Raises:
        ConfigError: no such subcategory.
    """
    subcategory = session.get(Subcategory, subcategory_id)
    if subcategory is None:
        raise ConfigError(f"no subcategory with id {subcategory_id}")
    subcategory.status = "active"
    session.flush()


def merge_subcategory(session: Session, subcategory_id: int, *, into_id: int) -> None:
    """Merge `subcategory_id` into `into_id`, atomically (A14). Does not commit.

    Rewrites every `transactions` row and `merchant_map` row that references `subcategory_id` to
    reference `into_id` (and `into_id`'s category) instead, then marks `subcategory_id` as
    `merged`, recording `merged_into`. Future cache and rule hits resolve straight to `into_id`.

    Raises:
        ConfigError: either id does not exist, or `into_id` is itself already merged away.
    """
    source = session.get(Subcategory, subcategory_id)
    target = session.get(Subcategory, into_id)
    if source is None:
        raise ConfigError(f"no subcategory with id {subcategory_id}")
    if target is None:
        raise ConfigError(f"no subcategory with id {into_id}")
    if target.status == "merged":
        raise ConfigError(f"subcategory {into_id} is itself merged; merge into its target instead")

    now = utcnow_iso()
    for txn in session.execute(
        select(Transaction).where(Transaction.subcategory_id == subcategory_id)
    ).scalars():
        txn.subcategory_id = target.id
        txn.category_id = target.category_id
        txn.updated_at = now

    for row in session.execute(
        select(MerchantMap).where(MerchantMap.subcategory_id == subcategory_id)
    ).scalars():
        row.subcategory_id = target.id
        row.category_id = target.category_id
        row.updated_at = now

    source.status = "merged"
    source.merged_into = target.id
    session.flush()


# --------------------------------------------------------------------------------------------
# Deterministic cascade, steps 1-6.
# --------------------------------------------------------------------------------------------


def _load_rule_sets(session: Session) -> tuple[list[Rule], list[Rule]]:
    user_rules = list(
        session.execute(
            select(Rule)
            .where(Rule.source == "user", Rule.enabled.is_(True))
            .order_by(Rule.priority, Rule.id)
        ).scalars()
    )
    builtin_rules = list(
        session.execute(
            select(Rule)
            .where(Rule.source == "builtin", Rule.enabled.is_(True))
            .order_by(Rule.priority, Rule.id)
        ).scalars()
    )
    return user_rules, builtin_rules


def _classify_deterministic(
    session: Session,
    txn: Transaction,
    *,
    user_rules: Sequence[Rule],
    builtin_rules: Sequence[Rule],
    dry_run: bool = False,
) -> _Outcome | None:
    """Cascade steps 1-6 for one transaction. `None` means it must go to the LLM (step 7).

    `dry_run=True` (used by `preview_egress`) performs every read but skips every write
    (`merchant_map.hit_count` increments, the issuer-category `merchant_map` write), so nothing
    persists from a preview.
    """
    if txn.kind in _NON_SPEND_KINDS:
        return _Outcome(
            category_key=_PAYMENTS_TRANSFERS_CATEGORY,
            subcategory_key=_PAYMENTS_TRANSFERS_SUBCATEGORY,
            confidence=1.0,
            classified_by="kind",
        )

    for rule in user_rules:
        if _rule_applies_to_user(rule, txn.user_id) and rule_matches(rule, txn.merchant_key):
            return _outcome_from_rule(session, rule, classified_by="user_rule")

    if txn.merchant_key:
        user_map = session.execute(
            select(MerchantMap).where(
                MerchantMap.merchant_key == txn.merchant_key, MerchantMap.source == "user"
            )
        ).scalar_one_or_none()
        if user_map is not None:
            if not dry_run:
                user_map.hit_count += 1
            return _outcome_from_map(session, user_map, classified_by="user")

    for rule in builtin_rules:
        if rule_matches(rule, txn.merchant_key):
            return _outcome_from_rule(session, rule, classified_by="builtin_rule")

    if txn.issuer_category:
        parser_id = txn.statement.parser_id if txn.statement is not None else None
        match = resolve_issuer_category(parser_id, txn.issuer_category)
        if match is not None:
            outcome = _Outcome(
                category_key=match.category_key,
                subcategory_key=match.subcategory_key,
                confidence=0.9,
                classified_by="issuer",
            )
            if txn.merchant_key and not dry_run:
                _write_merchant_map(
                    session,
                    txn.merchant_key,
                    outcome,
                    source="issuer",
                    canonical=txn.merchant_canonical,
                )
            return outcome

    if txn.merchant_key:
        cache_map = session.execute(
            select(MerchantMap).where(
                MerchantMap.merchant_key == txn.merchant_key,
                MerchantMap.source.in_(("llm", "issuer")),
            )
        ).scalar_one_or_none()
        if cache_map is not None:
            if not dry_run:
                cache_map.hit_count += 1
            return _outcome_from_map(session, cache_map, classified_by="cache")

    return None


def _rule_applies_to_user(rule: Rule, user_id: int) -> bool:
    return rule.user_id is None or rule.user_id == user_id


def _outcome_from_rule(session: Session, rule: Rule, *, classified_by: str) -> _Outcome:
    category = session.get(Category, rule.category_id)
    subcategory = session.get(Subcategory, rule.subcategory_id)
    if category is None or subcategory is None:
        raise ConfigError(f"rule {rule.id} references a missing category/subcategory")
    return _Outcome(
        category_key=category.key,
        subcategory_key=subcategory.key,
        confidence=1.0,
        classified_by=classified_by,
        kind_override=rule.kind_override,
    )


def _outcome_from_map(session: Session, row: MerchantMap, *, classified_by: str) -> _Outcome:
    category = session.get(Category, row.category_id)
    subcategory = session.get(Subcategory, row.subcategory_id)
    if category is None or subcategory is None:
        raise ConfigError(
            f"merchant_map {row.merchant_key!r} references a missing category/subcategory"
        )
    return _Outcome(
        category_key=category.key,
        subcategory_key=subcategory.key,
        confidence=row.confidence,
        classified_by=classified_by,
        merchant_canonical=row.merchant_canonical,
    )


def _write_merchant_map(
    session: Session,
    merchant_key: str,
    outcome: _Outcome,
    *,
    source: str,
    canonical: str | None = None,
) -> None:
    """Upsert `merchant_map[merchant_key]` from `outcome`. Never overwrites a `source='user'`
    row (I6), and never writes an empty `merchant_key` (A27, guarded by callers)."""
    if not merchant_key:
        return
    category = session.execute(
        select(Category).where(Category.key == outcome.category_key)
    ).scalar_one()
    subcategory = session.execute(
        select(Subcategory).where(
            Subcategory.category_id == category.id, Subcategory.key == outcome.subcategory_key
        )
    ).scalar_one()

    row = session.get(MerchantMap, merchant_key)
    if row is not None and row.source == "user":
        return
    resolved_canonical = canonical or outcome.merchant_canonical
    if row is None:
        session.add(
            MerchantMap(
                merchant_key=merchant_key,
                merchant_canonical=resolved_canonical,
                category_id=category.id,
                subcategory_id=subcategory.id,
                source=source,
                confidence=outcome.confidence,
                hit_count=0,
                updated_at=utcnow_iso(),
            )
        )
    else:
        row.merchant_canonical = resolved_canonical or row.merchant_canonical
        row.category_id = category.id
        row.subcategory_id = subcategory.id
        row.source = source
        row.confidence = outcome.confidence
        row.updated_at = utcnow_iso()


def _apply_outcome(
    session: Session,
    txn: Transaction,
    outcome: _Outcome,
    *,
    cfg: LLMConfig,
    llm_run_id: int | None = None,
) -> None:
    category = session.execute(
        select(Category).where(Category.key == outcome.category_key)
    ).scalar_one()
    subcategory = session.execute(
        select(Subcategory).where(
            Subcategory.category_id == category.id, Subcategory.key == outcome.subcategory_key
        )
    ).scalar_one()

    if outcome.kind_override is not None and outcome.kind_override != txn.kind:
        txn.kind = outcome.kind_override
        txn.is_spend = kind_is_spend(cast(Kind, outcome.kind_override))

    below_threshold = (
        outcome.confidence is not None and outcome.confidence < cfg.confidence_threshold
    )
    txn.category_id = category.id
    txn.subcategory_id = subcategory.id
    txn.confidence = outcome.confidence
    txn.classified_by = outcome.classified_by
    txn.needs_review = outcome.needs_review_override or below_threshold
    if outcome.merchant_canonical:
        txn.merchant_canonical = outcome.merchant_canonical
    txn.updated_at = utcnow_iso()
    session.add(
        Classification(
            transaction_id=txn.id,
            category_key=outcome.category_key,
            subcategory_key=outcome.subcategory_key,
            confidence=outcome.confidence,
            method=outcome.classified_by,
            llm_run_id=llm_run_id,
        )
    )


# --------------------------------------------------------------------------------------------
# LLM batch (step 7) and dynamic online_shopping subcategories.
# --------------------------------------------------------------------------------------------


def _description_of(session: Session, transaction_id: int) -> str | None:
    txn = session.get(Transaction, transaction_id)
    return txn.description_clean if txn is not None else None


def _select_representative(descriptions: Sequence[str]) -> str:
    """A5: the modal `description_clean` among transactions sharing one `merchant_key`, tied
    broken by shortest then lexicographic. `descriptions` is never empty for a real merchant
    key (every key came from at least one transaction)."""
    counts = Counter(descriptions)
    max_count = max(counts.values())
    candidates = [d for d, c in counts.items() if c == max_count]
    candidates.sort(key=lambda d: (len(d), d))
    return candidates[0]


def _outcome_from_item(session: Session, item: Item, *, batch_flagged: bool) -> _Outcome:
    """Turn one LLM `Item` into an `_Outcome`, resolving a dynamic `online_shopping`
    subcategory (create-or-merge-follow) as needed."""
    if is_dynamic(item.category):
        subcategory = _resolve_dynamic_subcategory(
            session, item.category, item.merchant_canonical or item.subcategory
        )
        subcategory_key = subcategory.key
        pending = subcategory.status == "pending_approval"
    else:
        subcategory_key = item.subcategory
        pending = False

    return _Outcome(
        category_key=item.category,
        subcategory_key=subcategory_key,
        confidence=item.confidence,
        classified_by="llm",
        merchant_canonical=item.merchant_canonical or None,
        needs_review_override=batch_flagged or pending,
    )


def _slugify_store_name(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "unknown"


def _resolve_dynamic_subcategory(
    session: Session, category_key: str, merchant_canonical: str
) -> Subcategory:
    """`online_shopping`'s dynamic subcategory create-or-merge-follow (§2b P2-B):

    - exists and `active` -> use it;
    - exists and `merged` -> follow `merged_into`;
    - new -> insert `pending_approval` (the caller flags the transaction for review).
    """
    category = session.execute(select(Category).where(Category.key == category_key)).scalar_one()
    slug = _slugify_store_name(merchant_canonical)
    subcategory = session.execute(
        select(Subcategory).where(Subcategory.category_id == category.id, Subcategory.key == slug)
    ).scalar_one_or_none()
    if subcategory is None:
        subcategory = Subcategory(
            category_id=category.id,
            key=slug,
            label=merchant_canonical.strip() or slug.replace("_", " ").title(),
            is_dynamic=True,
            status="pending_approval",
        )
        session.add(subcategory)
        session.flush()
        return subcategory
    if subcategory.status == "merged" and subcategory.merged_into is not None:
        target = session.get(Subcategory, subcategory.merged_into)
        if target is not None:
            return target
    return subcategory


def _persist_llm_run(session: Session, result: BatchResult, *, group_id: str) -> int:
    now = utcnow_iso()
    run = LlmRun(
        group_id=group_id,
        kind="classify",
        provider=result.provider,
        model=result.model,
        prompt_version=result.prompt_version,
        schema_mode=result.schema_mode,
        row_count=result.row_count,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        cost_usd=result.cost_usd,
        latency_ms=result.latency_ms,
        status=result.status,
        error_detail=None,
        request_sha256=result.request_sha256,
        started_at=now,
        finished_at=now,
    )
    session.add(run)
    session.flush()
    return run.id


__all__ = [
    "ClassifyResult",
    "apply_user_correction",
    "approve_subcategory",
    "classify_transactions",
    "merge_subcategory",
    "preview_egress",
]
