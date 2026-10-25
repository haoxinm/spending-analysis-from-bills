from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from spend_analyzer.api.services import gateway
from spend_analyzer.db.models import Category, Subcategory


def test_get_taxonomy_includes_others_uncategorized(client: TestClient) -> None:
    response = client.get("/api/taxonomy")
    assert response.status_code == 200
    categories = response.json()
    others = next(c for c in categories if c["key"] == "others")
    assert any(s["key"] == "uncategorized" for s in others["subcategories"])


def test_approve_subcategory_calls_gateway(
    client: TestClient, session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    category = session.execute(
        select(Category).where(Category.key == "online_shopping")
    ).scalar_one()
    sub = Subcategory(
        category_id=category.id,
        key="temu",
        label="Temu",
        is_dynamic=True,
        status="pending_approval",
    )
    session.add(sub)
    session.commit()

    calls: list[int] = []
    monkeypatch.setattr(
        gateway, "approve_subcategory", lambda db_session, sub_id: calls.append(sub_id)
    )

    response = client.post(f"/api/taxonomy/subcategories/{sub.id}/approve")
    assert response.status_code == 200
    assert calls == [sub.id]
