"""SQLAlchemy 2.x declarative models for every table in §3.2 (P0-3).

Dates and timestamps are stored as ISO-8601 **text** (SQLite convention: sortable, no timezone
ambiguity). All timestamps are UTC; all dates are naive (no time component).

The FK cycle between `issuers.default_spec_id` and `layout_specs.issuer_id` (A29) is declared with
`use_alter=True` on the `issuers.default_spec_id` foreign key, so Alembic can create the two
tables and add that constraint in a second step.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow_iso() -> str:
    """Return the current UTC time as an ISO-8601 string, for `created_at`/`updated_at` defaults."""
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    pii_aliases: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # A11: JSON list
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class Issuer(Base):
    """A24: known issuers. `name` and `match_terms` are LOCAL ONLY (I1b) — never egressed."""

    __tablename__ = "issuers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    slug: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    match_terms: Mapped[str] = mapped_column(Text, nullable=False, default="[]")  # JSON list
    default_spec_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("layout_specs.id", use_alter=True, name="fk_issuers_default_spec_id"),
        nullable=True,
    )
    auto_confirm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    last_used_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "issuer_id", "mask", "account_type"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    issuer_id: Mapped[int] = mapped_column(Integer, ForeignKey("issuers.id"), nullable=False)
    account_type: Mapped[str] = mapped_column(String, nullable=False)  # credit|checking|savings
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    # A29: NOT NULL DEFAULT '' -- SQLite treats NULLs as distinct in UNIQUE, which would
    # re-create maskless accounts on every import. LOCAL ONLY: never egressed, never exported.
    mask: Mapped[str] = mapped_column(String, nullable=False, default="")
    currency: Mapped[str] = mapped_column(String, nullable=False, default="USD")
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class LayoutSpec(Base):
    """A19/A21: named, versioned, immutable extractor specs. An edit inserts version+1."""

    __tablename__ = "layout_specs"
    __table_args__ = (
        UniqueConstraint("name", "version"),
        UniqueConstraint("parser_id"),
        Index("ix_specs_issuer", "issuer_id", "account_type", "version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    parser_id: Mapped[str] = mapped_column(String, nullable=False)
    issuer_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("issuers.id"), nullable=True
    )  # LOCAL ONLY (I1b)
    account_type: Mapped[str | None] = mapped_column(String, nullable=True)
    spec_yaml: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String, nullable=False)  # llm_proposed|pasted|user_authored
    approved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    llm_run_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("llm_runs.id"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class Statement(Base):
    __tablename__ = "statements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("accounts.id"), nullable=True
    )
    # The user who uploaded this statement (D4), set by `ingest.pipeline.propose_import` at
    # Phase 1 so Phase 2 (a separate process/request, possibly after a restart) can resolve or
    # create the account without depending on any in-process state. No `ondelete` (matches
    # every other `user_id` foreign key in this file: `accounts.user_id`, `transactions.user_id`,
    # `rules.user_id` — none cascades or nullifies on a user delete).
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    file_sha256: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    original_name: Mapped[str] = mapped_column(String, nullable=False)
    stored_path: Mapped[str | None] = mapped_column(String, nullable=True)
    period_start: Mapped[str | None] = mapped_column(Text, nullable=True)
    period_end: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    issuer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("issuers.id"), nullable=True)
    layout_spec_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("layout_specs.id"), nullable=True
    )
    parser_id: Mapped[str | None] = mapped_column(String, nullable=True)
    parser_version: Mapped[str | None] = mapped_column(String, nullable=True)
    detect_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # A18
    shape_warnings: Mapped[str | None] = mapped_column(Text, nullable=True)  # A18: JSON list
    status: Mapped[str] = mapped_column(String, nullable=False)
    # pending|awaiting_extractor|parsed|no_text_layer|unsupported_layout|error
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    txn_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    parsed_total_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stated_total_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opening_balance_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)  # A25
    closing_balance_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)  # A25
    ingested_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)

    transactions: Mapped[list[Transaction]] = relationship(
        "Transaction",
        cascade="all, delete-orphan",
        passive_deletes=True,
        back_populates="statement",
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    label: Mapped[str] = mapped_column(String, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)


class Subcategory(Base):
    __tablename__ = "subcategories"
    __table_args__ = (UniqueConstraint("category_id", "key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("categories.id"), nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    is_dynamic: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    # active | pending_approval | merged
    merged_into: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("subcategories.id"), nullable=True
    )


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("account_id", "dedupe_hash"),
        Index("ix_txn_user_date", "user_id", "posted_date"),
        Index("ix_txn_cat", "category_id", "subcategory_id"),
        Index("ix_txn_merchant", "merchant_key"),
        Index("ix_txn_review", "needs_review", sqlite_where=text("needs_review = 1")),
        Index("ix_txn_statement", "statement_id"),  # A10
        Index("ix_txn_account_date", "account_id", "posted_date"),  # A10
        CheckConstraint(
            "kind IN ('purchase','refund','payment','transfer','fee','interest','adjustment')",
            name="ck_txn_kind",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    statement_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("statements.id", ondelete="CASCADE"), nullable=False
    )
    account_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)

    posted_date: Mapped[str] = mapped_column(Text, nullable=False)
    transaction_date: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_raw: Mapped[str] = mapped_column(Text, nullable=False)  # NEVER egressed
    description_clean: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # ONLY egress-eligible field
    merchant_key: Mapped[str] = mapped_column(Text, nullable=False)
    merchant_canonical: Mapped[str | None] = mapped_column(Text, nullable=True)
    issuer_category: Mapped[str | None] = mapped_column(Text, nullable=True)  # A16, LOCAL ONLY

    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)  # signed; positive = outflow
    currency: Mapped[str] = mapped_column(String, nullable=False)
    fx_amount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fx_currency: Mapped[str | None] = mapped_column(String, nullable=True)
    fx_rate: Mapped[float | None] = mapped_column(Float, nullable=True)

    kind: Mapped[str] = mapped_column(String, nullable=False)
    is_spend: Mapped[bool] = mapped_column(
        Boolean, nullable=False
    )  # kind IN (purchase,fee,interest)

    category_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("categories.id"), nullable=True
    )
    subcategory_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("subcategories.id"), nullable=True
    )
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    classified_by: Mapped[str | None] = mapped_column(String, nullable=True)
    # cache|user_rule|builtin_rule|issuer|llm|user|kind
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    dedupe_hash: Mapped[str] = mapped_column(Text, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)

    statement: Mapped[Statement] = relationship("Statement", back_populates="transactions")


class MerchantMap(Base):
    __tablename__ = "merchant_map"

    merchant_key: Mapped[str] = mapped_column(Text, primary_key=True)
    merchant_canonical: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("categories.id"), nullable=False)
    subcategory_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subcategories.id"), nullable=False
    )
    source: Mapped[str] = mapped_column(String, nullable=False)  # llm|user|builtin|issuer (A29)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    match_type: Mapped[str] = mapped_column(String, nullable=False)  # exact|contains|regex
    pattern: Mapped[str] = mapped_column(Text, nullable=False)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("categories.id"), nullable=False)
    subcategory_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subcategories.id"), nullable=False
    )
    kind_override: Mapped[str | None] = mapped_column(String, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String, nullable=False)  # builtin|user
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class LlmRun(Base):
    __tablename__ = "llm_runs"
    __table_args__ = (Index("ix_llm_runs_group", "group_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[str] = mapped_column(String, nullable=False)  # A2: uuid4 per user action
    kind: Mapped[str] = mapped_column(String, nullable=False, default="classify")
    # classify | test | layout_spec (Phase 5)
    provider: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    prompt_version: Mapped[str] = mapped_column(String, nullable=False)
    schema_mode: Mapped[str] = mapped_column(
        String, nullable=False
    )  # json_schema|json_object|text_fallback
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_out: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)  # ok|partial|error
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_sha256: Mapped[str] = mapped_column(String, nullable=False)
    started_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    finished_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class Classification(Base):
    __tablename__ = "classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    transaction_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("transactions.id", ondelete="CASCADE"), nullable=False
    )
    category_key: Mapped[str] = mapped_column(String, nullable=False)
    subcategory_key: Mapped[str] = mapped_column(String, nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    method: Mapped[str] = mapped_column(String, nullable=False)
    llm_run_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("llm_runs.id"), nullable=True
    )
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status", "status"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)  # uuid4
    kind: Mapped[str] = mapped_column(String, nullable=False)  # import | classify
    status: Mapped[str] = mapped_column(String, nullable=False)
    # queued | running | done | error | cancelled
    total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    llm_run_group_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False, default=utcnow_iso)
