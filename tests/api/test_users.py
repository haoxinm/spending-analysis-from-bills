from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_and_list_users(client: TestClient) -> None:
    response = client.post("/api/users", json={"name": "Alex", "is_default": True})
    assert response.status_code == 201
    user = response.json()
    assert user["name"] == "Alex"
    assert user["is_default"] is True

    listing = client.get("/api/users")
    assert listing.status_code == 200
    assert any(u["id"] == user["id"] for u in listing.json())


def test_update_and_delete_user(client: TestClient) -> None:
    user = client.post("/api/users", json={"name": "Sam"}).json()

    updated = client.patch(f"/api/users/{user['id']}", json={"name": "Samantha"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "Samantha"

    deleted = client.delete(f"/api/users/{user['id']}")
    assert deleted.status_code == 204

    missing = client.patch(f"/api/users/{user['id']}", json={"name": "Nope"})
    assert missing.status_code == 404


def test_only_one_default_user(client: TestClient) -> None:
    first = client.post("/api/users", json={"name": "First", "is_default": True}).json()
    second = client.post("/api/users", json={"name": "Second", "is_default": True}).json()

    users = {u["id"]: u for u in client.get("/api/users").json()}
    assert users[first["id"]]["is_default"] is False
    assert users[second["id"]]["is_default"] is True
