"""`/api/issuers` (§3.12, A24, D14). `name` and `match_terms` are local-only (I1b) — never
egressed; this router never imports anything from `classify/llm/`."""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SessionDep
from spend_analyzer.api.services import crud
from spend_analyzer.db.models import Issuer as IssuerModel

router = APIRouter(tags=["issuers"])


def _issuer_schema(issuer: IssuerModel) -> schemas.Issuer:
    return schemas.Issuer(
        id=issuer.id,
        name=issuer.name,
        slug=issuer.slug,
        match_terms=json.loads(issuer.match_terms),
        default_spec_id=issuer.default_spec_id,
    )


@router.get("/issuers", response_model=list[schemas.Issuer])
def list_issuers(session: SessionDep) -> list[schemas.Issuer]:
    return [_issuer_schema(i) for i in crud.list_issuers(session)]


@router.post("/issuers", response_model=schemas.Issuer, status_code=201)
def create_issuer(body: schemas.IssuerCreate, session: SessionDep) -> schemas.Issuer:
    issuer = crud.create_issuer(session, name=body.name, match_terms=body.match_terms)
    session.commit()
    return _issuer_schema(issuer)


@router.patch("/issuers/{issuer_id}", response_model=schemas.Issuer)
def update_issuer(
    issuer_id: int, body: schemas.IssuerUpdate, session: SessionDep
) -> schemas.Issuer:
    issuer = crud.get_issuer(session, issuer_id)
    if issuer is None:
        raise HTTPException(status_code=404, detail="issuer not found")
    issuer = crud.update_issuer(
        session,
        issuer,
        name=body.name,
        match_terms=body.match_terms,
        default_spec_id=body.default_spec_id,
    )
    session.commit()
    return _issuer_schema(issuer)


@router.delete("/issuers/{issuer_id}", status_code=204)
def delete_issuer(issuer_id: int, session: SessionDep) -> None:
    issuer = crud.get_issuer(session, issuer_id)
    if issuer is None:
        raise HTTPException(status_code=404, detail="issuer not found")
    crud.delete_issuer(session, issuer)
    session.commit()
