from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_list_update_delete_issuer(client: TestClient) -> None:
    created = client.post(
        "/api/issuers", json={"name": "Bank of Example", "match_terms": ["Bank of Example"]}
    )
    assert created.status_code == 201
    issuer = created.json()
    assert issuer["match_terms"] == ["Bank of Example"]

    listing = client.get("/api/issuers")
    assert any(i["id"] == issuer["id"] for i in listing.json())

    updated = client.patch(f"/api/issuers/{issuer['id']}", json={"name": "BoE"})
    assert updated.status_code == 200
    assert updated.json()["name"] == "BoE"

    deleted = client.delete(f"/api/issuers/{issuer['id']}")
    assert deleted.status_code == 204
