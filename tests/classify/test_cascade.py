"""Tests for `classify/cascade.py` (§3.12a, §2b P2-B, A28)."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from spend_analyzer.classify import cascade
from spend_analyzer.classify.llm.batching import ClassifyResult as LlmClassifyResult
from spend_analyzer.classify.llm.batching import ClassifyRunResult
from spend_analyzer.classify.llm.egress import BatchResult
from spend_analyzer.classify.llm.schema import Item
from spend_analyzer.config import LLMConfig
from spend_analyzer.core.errors import ConfigError
from spend_analyzer.db.models import (
    Account,
    Category,
    Issuer,
    MerchantMap,
    Rule,
    Statement,
    Subcategory,
    Transaction,
    User,
)
from spend_analyzer.db.session import make_session_factory

# --------------------------------------------------------------------------------------------
# Fixture helpers.
# --------------------------------------------------------------------------------------------


def _cfg(**overrides: object) -> LLMConfig:
    base: dict[str, object] = {
        "mode": "remote",
        "provider": "anthropic",
        "model": "anthropic/claude-x",
    }
    base.update(overrides)
    return LLMConfig.model_validate(base)


def _no_provider_cfg() -> LLMConfig:
    return LLMConfig()  # mode="none" (D2)


def _account(session: Session, *, account_type: str = "credit") -> Account:
    user = User(name=f"user-{uuid4().hex}")
    issuer = Issuer(name=f"Issuer {uuid4().hex}", slug=f"issuer-{uuid4().hex}")
    session.add_all([user, issuer])
    session.flush()
    account = Account(
        user_id=user.id, issuer_id=issuer.id, account_type=account_type, display_name="Card"
    )
    session.add(account)
    session.flush()
    return account


def _statement(session: Session, *, parser_id: str | None = None) -> Statement:
    stmt = Statement(
        file_sha256=uuid4().hex + uuid4().hex[:32],
        original_name="s.pdf",
        status="parsed",
        parser_id=parser_id,
    )
    session.add(stmt)
    session.flush()
    return stmt


def _txn(
    session: Session,
    *,
    account: Account,
    statement: Statement,
    description: str = "SOME MERCHANT",
    merchant_key: str | None = None,
    amount_minor: int = 1000,
    kind: str = "purchase",
    issuer_category: str | None = None,
) -> Transaction:
    key = merchant_key if merchant_key is not None else description.lower()
    txn = Transaction(
        statement_id=statement.id,
        account_id=account.id,
        user_id=account.user_id,
        posted_date="2026-01-05",
        description_raw=description,
        description_clean=description,
        merchant_key=key,
        issuer_category=issuer_category,
        amount_minor=amount_minor,
        currency="USD",
        kind=kind,
        is_spend=kind in ("purchase", "fee", "interest"),
        dedupe_hash=f"h{uuid4().hex}",
    )
    session.add(txn)
    session.flush()
    return txn


def _category_subcategory(
    session: Session, category_key: str, subcategory_key: str
) -> tuple[int, int]:
    category = session.execute(select(Category).where(Category.key == category_key)).scalar_one()
    subcategory = session.execute(
        select(Subcategory).where(
            Subcategory.category_id == category.id, Subcategory.key == subcategory_key
        )
    ).scalar_one()
    return category.id, subcategory.id


def _item(
    row_id: int,
    *,
    category: str = "grocery",
    subcategory: str = "grocery_stores",
    confidence: float = 0.95,
) -> Item:
    return Item(
        id=row_id,
        category=category,
        subcategory=subcategory,
        merchant_canonical="Some Merchant",
        confidence=confidence,
    )


def _ok_batch_result(descriptions: Sequence[str], items: Sequence[Item]) -> BatchResult:
    return BatchResult(
        items=tuple(items),
        missing_ids=(),
        provider="anthropic",
        model="anthropic/claude-x",
        prompt_version="v1",
        schema_mode="json_schema",
        row_count=len(descriptions),
        tokens_in=10,
        tokens_out=10,
        cost_usd=0.01,
        latency_ms=5,
        status="ok",
        request_sha256="deadbeef",
    )


def _fake_classify_all_factory(
    items_by_description: dict[str, Item],
) -> tuple[list[list[str]], object]:
    """Returns (calls, fake) where `fake` matches `classify_all`'s signature and `calls` records
    every `descriptions` list it was invoked with."""
    calls: list[list[str]] = []

    def _fake(
        descriptions: list[str],
        cfg: LLMConfig,
        *,
        group_id: str | None = None,
        progress_cb: object = None,
    ) -> ClassifyRunResult:
        calls.append(list(descriptions))
        items = [items_by_description[d] for d in descriptions]
        results = tuple(
            LlmClassifyResult(description=d, item=item, needs_review=False)
            for d, item in zip(descriptions, items, strict=True)
        )
        run = _ok_batch_result(descriptions, items)
        return ClassifyRunResult(group_id=group_id or "g", results=results, runs=(run,))

    return calls, _fake


def _noop_progress(done: int, total: int, cost_usd: float) -> None:
    pass


# --------------------------------------------------------------------------------------------
# Step 1: kind short-circuit (I11, A26).
# --------------------------------------------------------------------------------------------


def test_payment_and_transfer_kinds_short_circuit_to_payments_transfers(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    payment_txn = _txn(session, account=account, statement=statement, kind="payment")
    transfer_txn = _txn(session, account=account, statement=statement, kind="transfer")
    session.commit()

    def _classify_all_must_not_be_called(*args: object, **kwargs: object) -> ClassifyRunResult:
        raise AssertionError("payments/transfers must never reach the LLM (I11)")

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", _classify_all_must_not_be_called)
    try:
        result = cascade.classify_transactions(
            make_session_factory(engine),
            [payment_txn.id, transfer_txn.id],
            cfg=_no_provider_cfg(),
            group_id="g1",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    assert result.classified == 2
    assert result.needs_review == 0
    assert result.llm_requests == 0

    for txn_id in (payment_txn.id, transfer_txn.id):
        txn = session.get(Transaction, txn_id)
        assert txn is not None
        category = session.get(Category, txn.category_id)
        subcategory = session.get(Subcategory, txn.subcategory_id)
        assert category is not None and category.key == "others"
        assert subcategory is not None and subcategory.key == "payments_transfers"
        assert txn.is_spend is False
        assert txn.classified_by == "kind"
        assert txn.needs_review is False


# --------------------------------------------------------------------------------------------
# Cascade order and precedence (A28).
# --------------------------------------------------------------------------------------------


def test_user_correction_beats_builtin_rule(session: Session, engine: Engine) -> None:
    account = _account(session)
    statement = _statement(session)
    # "STARBUCKS" matches a builtin rule (-> restaurant/dine_in), but a user correction for the
    # same merchant_key exists and must win (I6, A28).
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="STARBUCKS STORE #1234 SEATTLE WA",
        merchant_key="starbucks store seattle wa",
    )
    cat_id, sub_id = _category_subcategory(session, "grocery", "grocery_stores")
    session.add(
        MerchantMap(
            merchant_key="starbucks store seattle wa",
            merchant_canonical="Starbucks",
            category_id=cat_id,
            subcategory_id=sub_id,
            source="user",
            confidence=1.0,
            hit_count=0,
            updated_at="2026-01-01T00:00:00+00:00",
        )
    )
    session.commit()

    result = cascade.classify_transactions(
        make_session_factory(engine),
        [txn.id],
        cfg=_no_provider_cfg(),
        group_id="g2",
        progress_cb=_noop_progress,
    )
    assert result.classified == 1
    session.expire_all()
    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.classified_by == "user"
    category = session.get(Category, refreshed.category_id)
    assert category is not None and category.key == "grocery"


def test_builtin_rule_beats_pre_existing_llm_cache_row(session: Session, engine: Engine) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="STARBUCKS STORE #1234 SEATTLE WA",
        merchant_key="starbucks store seattle wa",
    )
    # A stale (or simply different) LLM cache entry for the same key.
    cat_id, sub_id = _category_subcategory(session, "entertainment", "streaming")
    session.add(
        MerchantMap(
            merchant_key="starbucks store seattle wa",
            merchant_canonical="Starbucks",
            category_id=cat_id,
            subcategory_id=sub_id,
            source="llm",
            confidence=0.8,
            hit_count=3,
            updated_at="2026-01-01T00:00:00+00:00",
        )
    )
    session.commit()

    def _must_not_be_called(*args: object, **kwargs: object) -> ClassifyRunResult:
        raise AssertionError("a builtin rule match must never reach the LLM")

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", _must_not_be_called)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_no_provider_cfg(),
            group_id="g3",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.classified_by == "builtin_rule"
    category = session.get(Category, refreshed.category_id)
    assert category is not None and category.key == "restaurant"


def test_user_rule_kind_override_updates_kind_and_is_spend(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="ODD ADJUSTMENT ENTRY",
        merchant_key="odd adjustment entry",
        kind="purchase",
    )
    cat_id, sub_id = _category_subcategory(session, "others", "uncategorized")
    session.add(
        Rule(
            user_id=None,
            match_type="exact",
            pattern="odd adjustment entry",
            category_id=cat_id,
            subcategory_id=sub_id,
            kind_override="adjustment",
            priority=10,
            enabled=True,
            source="user",
        )
    )
    session.commit()

    cascade.classify_transactions(
        make_session_factory(engine),
        [txn.id],
        cfg=_no_provider_cfg(),
        group_id="g4",
        progress_cb=_noop_progress,
    )

    session.expire_all()

    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.kind == "adjustment"
    assert refreshed.is_spend is False
    assert refreshed.classified_by == "user_rule"


# --------------------------------------------------------------------------------------------
# Issuer category (A16).
# --------------------------------------------------------------------------------------------


def test_issuer_category_short_circuits_llm_and_writes_merchant_map(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session, parser_id="layout_c_credit")
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="COFFEE SHOP SEATTLE WA",
        merchant_key="coffee shop seattle wa",
        issuer_category="DINING",
    )
    session.commit()

    def _must_not_be_called(*args: object, **kwargs: object) -> ClassifyRunResult:
        raise AssertionError("an unambiguous issuer category must never reach the LLM")

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", _must_not_be_called)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_no_provider_cfg(),
            group_id="g5",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.classified_by == "issuer"
    assert refreshed.confidence == 0.9
    category = session.get(Category, refreshed.category_id)
    assert category is not None and category.key == "restaurant"

    cached = session.get(MerchantMap, "coffee shop seattle wa")
    assert cached is not None
    assert cached.source == "issuer"


def test_ambiguous_issuer_category_falls_through_to_llm(session: Session, engine: Engine) -> None:
    account = _account(session)
    statement = _statement(session, parser_id="layout_c_credit")
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="SOME STORE PURCHASE",
        merchant_key="some store purchase",
        issuer_category="MERCHANDISE",
    )
    session.commit()

    calls, fake = _fake_classify_all_factory({"SOME STORE PURCHASE": _item(1)})
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", fake)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_cfg(),
            group_id="g6",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    assert len(calls) == 1
    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.classified_by == "llm"


def test_issuer_category_never_appears_in_egress_preview(session: Session, engine: Engine) -> None:
    account = _account(session)
    statement = _statement(session, parser_id="layout_c_credit")
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="SOME STORE PURCHASE",
        merchant_key="some store purchase",
        issuer_category="MERCHANDISE",  # ambiguous -> falls through to the LLM path
    )
    session.commit()

    payload = cascade.preview_egress(session, [txn.id])
    assert "MERCHANDISE" not in payload
    assert "SOME STORE PURCHASE" in payload


def test_payments_and_transfers_never_appear_in_egress_preview(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    payment_txn = _txn(
        session, account=account, statement=statement, description="AUTOPAY PAYMENT", kind="payment"
    )
    plain_txn = _txn(
        session,
        account=account,
        statement=statement,
        description="UNCLASSIFIED MERCHANT XYZ",
        merchant_key="unclassified merchant xyz",
    )
    session.commit()

    payload = cascade.preview_egress(session, [payment_txn.id, plain_txn.id])
    assert "AUTOPAY" not in payload
    assert "UNCLASSIFIED MERCHANT XYZ" in payload


# --------------------------------------------------------------------------------------------
# The learned cache is the whole game.
# --------------------------------------------------------------------------------------------


def test_second_run_over_the_same_merchant_makes_zero_llm_calls(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement1 = _statement(session)
    txn1 = _txn(
        session,
        account=account,
        statement=statement1,
        description="NEW MERCHANT LLC",
        merchant_key="new merchant llc",
    )
    session.commit()

    calls, fake = _fake_classify_all_factory({"NEW MERCHANT LLC": _item(1)})
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", fake)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn1.id],
            cfg=_cfg(),
            group_id="g7",
            progress_cb=_noop_progress,
        )
        assert len(calls) == 1

        statement2 = _statement(session)
        txn2 = _txn(
            session,
            account=account,
            statement=statement2,
            description="NEW MERCHANT LLC",
            merchant_key="new merchant llc",
        )
        session.commit()

        cascade.classify_transactions(
            make_session_factory(engine),
            [txn2.id],
            cfg=_cfg(),
            group_id="g8",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    assert len(calls) == 1  # no new LLM call on the second import
    refreshed = session.get(Transaction, txn2.id)
    assert refreshed is not None
    assert refreshed.classified_by == "cache"


def test_empty_merchant_key_is_never_written_to_merchant_map(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(session, account=account, statement=statement, description="", merchant_key="")
    session.commit()

    _calls, fake = _fake_classify_all_factory({"": _item(1)})
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", fake)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_cfg(),
            group_id="g9",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    assert session.get(MerchantMap, "") is None


# --------------------------------------------------------------------------------------------
# User corrections (I6) and dynamic online_shopping subcategories.
# --------------------------------------------------------------------------------------------


def test_user_correction_survives_a_subsequent_classify_run(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="MYSTERY MERCHANT CO",
        merchant_key="mystery merchant co",
    )
    session.commit()

    cascade.apply_user_correction(
        session,
        txn.id,
        category_key="travel",
        subcategory_key="hotels",
        kind=None,
        create_rule=True,
    )
    session.commit()

    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.classified_by == "user"
    category = session.get(Category, refreshed.category_id)
    assert category is not None and category.key == "travel"

    rule = session.execute(
        select(Rule).where(Rule.source == "user", Rule.pattern == "mystery merchant co")
    ).scalar_one_or_none()
    assert rule is not None

    def _must_not_be_called(*args: object, **kwargs: object) -> ClassifyRunResult:
        raise AssertionError("a user correction must never be re-classified by the LLM")

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", _must_not_be_called)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_no_provider_cfg(),
            group_id="g10",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    refreshed_again = session.get(Transaction, txn.id)
    assert refreshed_again is not None
    # `create_rule=True` above also created a matching user rule (step 2), which now fires
    # before the merchant_map correction (step 3) is even checked -- both are "the user's own
    # classification" and neither is the LLM, so either label is correct here.
    assert refreshed_again.classified_by in ("user", "user_rule")
    category_again = session.get(Category, refreshed_again.category_id)
    assert category_again is not None and category_again.key == "travel"


def test_apply_user_correction_unknown_category_raises(session: Session, engine: Engine) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(session, account=account, statement=statement)
    session.commit()

    with pytest.raises(ConfigError):
        cascade.apply_user_correction(
            session,
            txn.id,
            category_key="not_a_real_category",
            subcategory_key="whatever",
            kind=None,
            create_rule=False,
        )


def test_new_store_creates_pending_subcategory_and_flags_review(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="COOL STORE ONLINE",
        merchant_key="cool store online",
    )
    session.commit()

    item = Item(
        id=1,
        category="online_shopping",
        subcategory="cool_store",
        merchant_canonical="Cool Store",
        confidence=0.95,
        is_online_store=True,
    )
    _calls, fake = _fake_classify_all_factory({"COOL STORE ONLINE": item})
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", fake)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_cfg(),
            group_id="g11",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.needs_review is True
    subcategory = session.get(Subcategory, refreshed.subcategory_id)
    assert subcategory is not None
    assert subcategory.key == "cool_store"
    assert subcategory.status == "pending_approval"
    assert subcategory.is_dynamic is True


def test_confidence_below_threshold_flags_needs_review(session: Session, engine: Engine) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="UNCERTAIN MERCHANT",
        merchant_key="uncertain merchant",
    )
    session.commit()

    low_conf_item = _item(1, category="grocery", subcategory="grocery_stores", confidence=0.5)
    _calls, fake = _fake_classify_all_factory({"UNCERTAIN MERCHANT": low_conf_item})
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(cascade, "classify_all", fake)
    try:
        cascade.classify_transactions(
            make_session_factory(engine),
            [txn.id],
            cfg=_cfg(confidence_threshold=0.7),
            group_id="g12",
            progress_cb=_noop_progress,
        )
    finally:
        monkeypatch.undo()
        session.expire_all()

    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.needs_review is True
    assert refreshed.confidence == 0.5


def test_no_provider_configured_falls_back_to_uncategorized_needs_review(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="UNKNOWN MERCHANT NO PROVIDER",
        merchant_key="unknown merchant no provider",
    )
    session.commit()

    result = cascade.classify_transactions(
        make_session_factory(engine),
        [txn.id],
        cfg=_no_provider_cfg(),  # D2: "none" is a first-class, no-network mode
        group_id="g13",
        progress_cb=_noop_progress,
    )

    assert result.llm_requests == 0
    session.expire_all()
    refreshed = session.get(Transaction, txn.id)
    assert refreshed is not None
    assert refreshed.needs_review is True
    category = session.get(Category, refreshed.category_id)
    subcategory = session.get(Subcategory, refreshed.subcategory_id)
    assert category is not None and category.key == "others"
    assert subcategory is not None and subcategory.key == "uncategorized"


# --------------------------------------------------------------------------------------------
# Merging and approving dynamic subcategories (A14).
# --------------------------------------------------------------------------------------------


def test_merge_subcategory_rewrites_transactions_and_merchant_map(
    session: Session, engine: Engine
) -> None:
    category = session.execute(
        select(Category).where(Category.key == "online_shopping")
    ).scalar_one()
    source_sub = Subcategory(
        category_id=category.id,
        key="teh_store",
        label="Teh Store",
        is_dynamic=True,
        status="pending_approval",
    )
    target_sub = Subcategory(
        category_id=category.id,
        key="the_store",
        label="The Store",
        is_dynamic=True,
        status="pending_approval",
    )
    session.add_all([source_sub, target_sub])
    session.flush()

    account = _account(session)
    statement = _statement(session)
    txn = _txn(
        session,
        account=account,
        statement=statement,
        description="TEH STORE",
        merchant_key="teh store",
    )
    txn.category_id = category.id
    txn.subcategory_id = source_sub.id
    session.add(
        MerchantMap(
            merchant_key="teh store",
            merchant_canonical="Teh Store",
            category_id=category.id,
            subcategory_id=source_sub.id,
            source="llm",
            confidence=0.9,
            hit_count=1,
            updated_at="2026-01-01T00:00:00+00:00",
        )
    )
    session.commit()

    cascade.merge_subcategory(session, source_sub.id, into_id=target_sub.id)
    session.commit()

    refreshed_txn = session.get(Transaction, txn.id)
    assert refreshed_txn is not None
    assert refreshed_txn.subcategory_id == target_sub.id
    assert refreshed_txn.category_id == target_sub.category_id

    refreshed_map = session.get(MerchantMap, "teh store")
    assert refreshed_map is not None
    assert refreshed_map.subcategory_id == target_sub.id

    refreshed_source = session.get(Subcategory, source_sub.id)
    assert refreshed_source is not None
    assert refreshed_source.status == "merged"
    assert refreshed_source.merged_into == target_sub.id


def test_approve_subcategory_flips_status_to_active(session: Session, engine: Engine) -> None:
    category = session.execute(
        select(Category).where(Category.key == "online_shopping")
    ).scalar_one()
    sub = Subcategory(
        category_id=category.id,
        key="new_shop",
        label="New Shop",
        is_dynamic=True,
        status="pending_approval",
    )
    session.add(sub)
    session.commit()

    cascade.approve_subcategory(session, sub.id)
    session.commit()

    refreshed = session.get(Subcategory, sub.id)
    assert refreshed is not None
    assert refreshed.status == "active"


def test_merge_subcategory_missing_id_raises(session: Session, engine: Engine) -> None:
    category = session.execute(
        select(Category).where(Category.key == "online_shopping")
    ).scalar_one()
    sub = Subcategory(category_id=category.id, key="lonely", label="Lonely", is_dynamic=True)
    session.add(sub)
    session.commit()

    with pytest.raises(ConfigError):
        cascade.merge_subcategory(session, sub.id, into_id=999_999)


# --------------------------------------------------------------------------------------------
# Egress preview dedup (A5).
# --------------------------------------------------------------------------------------------


def test_preview_egress_deduplicates_by_merchant_key_with_modal_representative(
    session: Session, engine: Engine
) -> None:
    account = _account(session)
    statement = _statement(session)
    # Same merchant_key, three descriptions: "B" appears twice (modal), "A" and "C" once each.
    for desc in ("A SHORT ONE", "B MODAL", "B MODAL", "C ANOTHER"):
        _txn(
            session,
            account=account,
            statement=statement,
            description=desc,
            merchant_key="shared key",
        )
    session.commit()

    txn_ids = [
        t.id
        for t in session.execute(
            select(Transaction).where(Transaction.merchant_key == "shared key")
        ).scalars()
    ]
    payload = cascade.preview_egress(session, txn_ids)
    lines = [line for line in payload.strip().splitlines() if line]
    assert len(lines) == 2  # header + exactly one representative row
    assert "B MODAL" in payload
    assert "A SHORT ONE" not in payload
    assert "C ANOTHER" not in payload
