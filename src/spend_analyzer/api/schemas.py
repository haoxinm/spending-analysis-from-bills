"""Pydantic request/response models for every route (§3.12).

One model per shape in the OpenAPI schema this module ultimately generates (`scripts/
export_openapi.py` writes it to `frontend/src/api/openapi.json`); every route sets
`response_model` so that schema is complete enough for `openapi-typescript` to build a typed
frontend client from it.

Amounts are minor units everywhere (I5). `mask` never appears here (A12/export leak guard;
`accounts.mask` is local-only and is never returned by any route in this module, including
`/export`).
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Kind(StrEnum):
    """The seven `Kind` values (§3.1), as a real enum rather than a `Literal` alias: FastAPI
    only emits a named, reusable `components.schemas.Kind` in the OpenAPI document (which the
    frontend's generated client references as `components["schemas"]["Kind"]`) for an enum type
    — a `Literal` field is inlined per-field instead."""

    PURCHASE = "purchase"
    REFUND = "refund"
    PAYMENT = "payment"
    TRANSFER = "transfer"
    FEE = "fee"
    INTEREST = "interest"
    ADJUSTMENT = "adjustment"


AccountType = Literal["credit", "checking", "savings"]
LlmMode = Literal["none", "local", "remote"]
StatementStatus = Literal[
    "pending",
    "awaiting_extractor",
    "parsed",
    "no_text_layer",
    "unsupported_layout",
    "error",
]
JobStatus = Literal["queued", "running", "done", "error", "cancelled"]
JobKind = Literal["import", "classify"]


class _Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Users -------------------------------------------------------------------------------------


class User(_Model):
    id: int
    name: str
    is_default: bool


class UserCreate(_Model):
    name: str
    is_default: bool = False


class UserUpdate(_Model):
    name: str | None = None
    is_default: bool | None = None


# --- Accounts ------------------------------------------------------------------------------------


class Account(_Model):
    id: int
    user_id: int
    issuer_id: int | None
    account_type: AccountType
    currency: str


class AccountCreate(_Model):
    user_id: int
    issuer_id: int | None = None
    account_type: AccountType
    mask: str = ""
    currency: str = "USD"


class AccountUpdate(_Model):
    issuer_id: int | None = None
    account_type: AccountType | None = None
    mask: str | None = None
    currency: str | None = None


# --- Statements ----------------------------------------------------------------------------------


class Statement(_Model):
    id: int
    user_id: int | None = None
    account_id: int | None
    status: StatementStatus
    period_start: date | None
    period_end: date | None
    txn_count: int | None
    reconciliation_delta_minor: int | None = None
    detect_score: float | None
    shape_warnings: str | None
    error_detail: str | None
    created_at: datetime


class ExtractorProposal(_Model):
    issuer_id: int | None
    parser_id: str | None
    layout_spec_id: int | None
    confidence: float
    auto_confirmed: bool


class StatementUploadResponse(_Model):
    statement: Statement
    proposal: ExtractorProposal


class ExtractRequest(_Model):
    issuer_id: int
    layout_spec_id: int | None = None
    parser_id: str | None = None
    remember: bool = False


class StatementPatch(_Model):
    user_id: int | None = None
    account_id: int | None = None


class JobIdResponse(_Model):
    job_id: str


# --- Jobs ----------------------------------------------------------------------------------------


class Job(_Model):
    id: str
    kind: JobKind
    status: JobStatus
    progress: float = Field(ge=0.0, le=1.0)
    message: str | None = None
    group_id: str | None = None
    error_detail: str | None = None


# --- Transactions ----------------------------------------------------------------------------------


class Transaction(_Model):
    id: int
    statement_id: int
    account_id: int
    posted_date: date
    transaction_date: date | None
    description_clean: str
    amount_minor: int
    currency: str
    kind: Kind
    category_key: str | None
    subcategory_key: str | None
    merchant_key: str | None
    notes: str | None
    needs_review: bool


class TransactionList(_Model):
    items: list[Transaction]
    total: int


class TransactionPatch(_Model):
    category_key: str | None = None
    subcategory_key: str | None = None
    kind: Kind | None = None
    notes: str | None = None
    create_rule: bool = False


class BulkUpdateRequest(_Model):
    transaction_ids: list[int]
    category_key: str | None = None
    subcategory_key: str | None = None
    kind: Kind | None = None


class BulkUpdateResponse(_Model):
    updated: int


# --- Classify --------------------------------------------------------------------------------------


class ClassifyRunRequest(_Model):
    user_id: int | None = None
    statement_id: int | None = None
    only_unclassified: bool = True


class ClassifyRunResponse(_Model):
    job_id: str
    group_id: str


class ClassifyPreviewRow(_Model):
    merchant_key: str
    description_clean: str


class LlmRun(_Model):
    id: int
    group_id: str
    provider: str
    model: str
    schema_mode: str
    cost_usd: float | None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    created_at: datetime


# --- Analytics -------------------------------------------------------------------------------------


class AnalyticsRow(_Model):
    period: str | None = None
    category: str | None = None
    subcategory: str | None = None
    user: int | None = None
    account: int | None = None
    merchant: str | None = None
    currency: str
    total_minor: int
    txn_count: int
    avg_minor: int


class TopMerchantRow(_Model):
    merchant: str
    total_minor: int
    txn_count: int


# --- Taxonomy --------------------------------------------------------------------------------------


class Subcategory(_Model):
    key: str
    name: str
    pending: bool
    merged_into: str | None = None


class Category(_Model):
    key: str
    name: str
    subcategories: list[Subcategory]


class MergeRequest(_Model):
    into_id: int


# --- Issuers ---------------------------------------------------------------------------------------


class Issuer(_Model):
    id: int
    name: str
    slug: str
    match_terms: list[str]
    default_spec_id: int | None = None


class IssuerCreate(_Model):
    name: str
    match_terms: list[str] = Field(default_factory=list)


class IssuerUpdate(_Model):
    name: str | None = None
    match_terms: list[str] | None = None
    default_spec_id: int | None = None


# --- Layout specs ------------------------------------------------------------------------------------


class LayoutSpec(_Model):
    id: int
    name: str
    version: int
    issuer_id: int | None
    approved: bool
    source: str


class LayoutSpecCreate(_Model):
    name: str
    spec_yaml: str
    issuer_id: int | None = None


# --- Rules -------------------------------------------------------------------------------------------


class Rule(_Model):
    id: int
    pattern: str
    category_key: str
    subcategory_key: str
    kind: Kind | None = None
    source: str


class RuleCreate(_Model):
    pattern: str
    match_type: Literal["exact", "contains", "regex"] = "contains"
    category_key: str
    subcategory_key: str
    kind: Kind | None = None


class RuleUpdate(_Model):
    pattern: str | None = None
    category_key: str | None = None
    subcategory_key: str | None = None
    kind: Kind | None = None


# --- Settings ----------------------------------------------------------------------------------------


class LlmSettings(_Model):
    mode: LlmMode
    provider: str
    model: str
    api_base: str
    batch_size: int
    timeout_s: int
    confidence_threshold: float
    has_key: bool = False


class PrivacySettings(_Model):
    store_pdf_copies: bool
    store_extract_cache: bool
    pii_terms: list[str]


class IngestSettings(_Model):
    always_confirm_extractor: bool
    date_format_hints: list[str]
    default_currency: str


class ServerSettings(_Model):
    port: int


class Settings(_Model):
    llm: LlmSettings
    privacy: PrivacySettings
    ingest: IngestSettings
    server: ServerSettings


class TestLlmResponse(_Model):
    ok: bool
    detail: str | None = None
