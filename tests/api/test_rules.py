from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_rule_validates_taxonomy_keys(client: TestClient) -> None:
    response = client.post(
        "/api/rules",
        json={"pattern": "TRADER JOES", "category_key": "nope", "subcategory_key": "nope"},
    )
    assert response.status_code == 400


def test_create_update_delete_rule(client: TestClient) -> None:
    created = client.post(
        "/api/rules",
        json={
            "pattern": "TRADER JOES",
            "category_key": "grocery",
            "subcategory_key": "grocery_stores",
        },
    )
    assert created.status_code == 201
    rule = created.json()
    assert rule["category_key"] == "grocery"

    updated = client.patch(f"/api/rules/{rule['id']}", json={"pattern": "TRADER JOE'S"})
    assert updated.status_code == 200
    assert updated.json()["pattern"] == "TRADER JOE'S"

    listing = client.get("/api/rules")
    assert any(r["id"] == rule["id"] for r in listing.json())

    deleted = client.delete(f"/api/rules/{rule['id']}")
    assert deleted.status_code == 204


def test_update_missing_rule_is_404(client) -> None:  # type: ignore[no-untyped-def]
    response = client.patch("/api/rules/999999", json={"pattern": "x"})
    assert response.status_code == 404


def test_delete_missing_rule_is_404(client) -> None:  # type: ignore[no-untyped-def]
    response = client.delete("/api/rules/999999")
    assert response.status_code == 404
