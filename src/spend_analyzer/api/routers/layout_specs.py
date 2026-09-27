"""`/api/layout-specs/*` (§3.12, A19, A21). Specs are immutable `(name, version)` rows; a revise
inserts `version + 1` and never mutates the row it revises."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from starlette.responses import PlainTextResponse

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SessionDep
from spend_analyzer.api.services import crud
from spend_analyzer.db.models import LayoutSpec as LayoutSpecModel

router = APIRouter(tags=["layout-specs"])


def _spec_schema(spec: LayoutSpecModel) -> schemas.LayoutSpec:
    return schemas.LayoutSpec(
        id=spec.id,
        name=spec.name,
        version=spec.version,
        issuer_id=spec.issuer_id,
        approved=spec.approved,
        source="pasted" if spec.source == "pasted" else "hand_mapped",
    )


@router.get("/layout-specs", response_model=list[schemas.LayoutSpec])
def list_layout_specs(session: SessionDep) -> list[schemas.LayoutSpec]:
    return [_spec_schema(s) for s in crud.list_layout_specs(session)]


@router.post("/layout-specs", response_model=schemas.LayoutSpec, status_code=201)
def create_layout_spec(body: schemas.LayoutSpecCreate, session: SessionDep) -> schemas.LayoutSpec:
    spec = crud.create_layout_spec(
        session, name=body.name, spec_yaml=body.spec_yaml, issuer_id=body.issuer_id
    )
    session.commit()
    return _spec_schema(spec)


@router.post("/layout-specs/{spec_id}/revise", response_model=schemas.LayoutSpec, status_code=201)
def revise_layout_spec(
    spec_id: int, body: schemas.LayoutSpecCreate, session: SessionDep
) -> schemas.LayoutSpec:
    previous = crud.get_layout_spec(session, spec_id)
    if previous is None:
        raise HTTPException(status_code=404, detail="layout spec not found")
    spec = crud.revise_layout_spec(
        session, previous, spec_yaml=body.spec_yaml, issuer_id=body.issuer_id
    )
    session.commit()
    return _spec_schema(spec)


@router.post("/layout-specs/{spec_id}/approve", response_model=schemas.LayoutSpec)
def approve_layout_spec(spec_id: int, session: SessionDep) -> schemas.LayoutSpec:
    spec = crud.get_layout_spec(session, spec_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="layout spec not found")
    spec = crud.approve_layout_spec(session, spec)
    session.commit()
    return _spec_schema(spec)


@router.get("/layout-specs/{spec_id}/export")
def export_layout_spec(spec_id: int, session: SessionDep) -> PlainTextResponse:
    spec = crud.get_layout_spec(session, spec_id)
    if spec is None:
        raise HTTPException(status_code=404, detail="layout spec not found")
    return PlainTextResponse(spec.spec_yaml, media_type="application/x-yaml")
