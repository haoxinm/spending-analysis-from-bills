"""`GET /api/export` (§3.12). **Must exclude `accounts.mask`** — this is the data-leak regression
the plan explicitly calls out, so `tests/api/test_export.py` asserts it directly on the response
body rather than only on the schema.
"""

from __future__ import annotations

import csv
import io
from typing import Literal

from fastapi import APIRouter
from sqlalchemy import select
from starlette.responses import PlainTextResponse

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SessionDep
from spend_analyzer.api.services import crud
from spend_analyzer.db.models import Transaction

router = APIRouter(tags=["export"])

_FIELDS = (
    "id",
    "statement_id",
    "account_id",
    "posted_date",
    "transaction_date",
    "description_clean",
    "amount_minor",
    "currency",
    "kind",
    "category_key",
    "subcategory_key",
    "merchant_key",
    "notes",
    "needs_review",
)


@router.get("/export")
def export_transactions(
    session: SessionDep,
    format: Literal["csv", "json"] = "csv",
) -> PlainTextResponse:
    transactions = (
        session.execute(select(Transaction).order_by(Transaction.posted_date)).scalars().all()
    )
    rows = [
        schemas.Transaction(
            id=t.id,
            statement_id=t.statement_id,
            account_id=t.account_id,
            posted_date=t.posted_date,
            transaction_date=t.transaction_date,
            description_clean=t.description_clean,
            amount_minor=t.amount_minor,
            currency=t.currency,
            kind=t.kind,
            category_key=crud.category_key_of(session, t),
            subcategory_key=crud.subcategory_key_of(session, t),
            merchant_key=t.merchant_key,
            notes=t.notes,
            needs_review=t.needs_review,
        )
        for t in transactions
    ]

    if format == "json":
        body = "[" + ",".join(row.model_dump_json() for row in rows) + "]"
        return PlainTextResponse(body, media_type="application/json")

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=_FIELDS)
    writer.writeheader()
    for row in rows:
        writer.writerow(row.model_dump(mode="json"))
    return PlainTextResponse(buffer.getvalue(), media_type="text/csv")
