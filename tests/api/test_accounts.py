from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_list_update_account(client: TestClient) -> None:
    user = client.post("/api/users", json={"name": "Alex"}).json()

    created = client.post(
        "/api/accounts",
        json={"user_id": user["id"], "account_type": "credit", "currency": "USD"},
    )
    assert created.status_code == 201
    account = created.json()

    listing = client.get("/api/accounts")
    assert any(a["id"] == account["id"] for a in listing.json())

    updated = client.patch(f"/api/accounts/{account['id']}", json={"currency": "EUR"})
    assert updated.status_code == 200
    assert updated.json()["currency"] == "EUR"


def test_update_missing_account_is_404(client: TestClient) -> None:
    response = client.patch("/api/accounts/999999", json={"currency": "EUR"})
    assert response.status_code == 404
