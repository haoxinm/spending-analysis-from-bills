"""`/api/rules` (§3.12)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SessionDep
from spend_analyzer.api.services import crud
from spend_analyzer.db.models import Category, Subcategory
from spend_analyzer.db.models import Rule as RuleModel

router = APIRouter(tags=["rules"])


def _rule_schema(session: Session, rule: RuleModel) -> schemas.Rule:
    category_row = session.get(Category, rule.category_id)
    subcategory_row = session.get(Subcategory, rule.subcategory_id)
    return schemas.Rule(
        id=rule.id,
        pattern=rule.pattern,
        category_key=category_row.key if category_row is not None else "",
        subcategory_key=subcategory_row.key if subcategory_row is not None else "",
        kind=rule.kind_override,
        source=rule.source,
    )


@router.get("/rules", response_model=list[schemas.Rule])
def list_rules(session: SessionDep) -> list[schemas.Rule]:
    return [_rule_schema(session, r) for r in crud.list_rules(session)]


@router.post("/rules", response_model=schemas.Rule, status_code=201)
def create_rule(body: schemas.RuleCreate, session: SessionDep) -> schemas.Rule:
    category = crud.category_by_key(session, body.category_key)
    if category is None:
        raise HTTPException(status_code=400, detail=f"unknown category {body.category_key!r}")
    subcategory = crud.subcategory_by_key(session, category.id, body.subcategory_key)
    if subcategory is None:
        raise HTTPException(status_code=400, detail=f"unknown subcategory {body.subcategory_key!r}")
    rule = crud.create_rule(
        session,
        pattern=body.pattern,
        match_type=body.match_type,
        category_id=category.id,
        subcategory_id=subcategory.id,
        kind_override=body.kind,
    )
    session.commit()
    return _rule_schema(session, rule)


@router.patch("/rules/{rule_id}", response_model=schemas.Rule)
def update_rule(rule_id: int, body: schemas.RuleUpdate, session: SessionDep) -> schemas.Rule:
    rule = crud.get_rule(session, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="rule not found")

    category_id = None
    if body.category_key is not None:
        category = crud.category_by_key(session, body.category_key)
        if category is None:
            raise HTTPException(status_code=400, detail=f"unknown category {body.category_key!r}")
        category_id = category.id

    subcategory_id = None
    if body.subcategory_key is not None:
        target_category_id = category_id if category_id is not None else rule.category_id
        subcategory = crud.subcategory_by_key(session, target_category_id, body.subcategory_key)
        if subcategory is None:
            raise HTTPException(
                status_code=400, detail=f"unknown subcategory {body.subcategory_key!r}"
            )
        subcategory_id = subcategory.id

    rule = crud.update_rule(
        session,
        rule,
        pattern=body.pattern,
        category_id=category_id,
        subcategory_id=subcategory_id,
        kind_override=body.kind,
    )
    session.commit()
    return _rule_schema(session, rule)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, session: SessionDep) -> None:
    rule = crud.get_rule(session, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="rule not found")
    crud.delete_rule(session, rule)
    session.commit()
