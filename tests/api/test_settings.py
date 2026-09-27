"""`/api/settings*` (A4, I7): never returns key material."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_settings_has_no_key_material(client: TestClient) -> None:
    response = client.get("/api/settings")
    assert response.status_code == 200
    body = response.json()
    assert "has_key" in body["llm"]
    assert "api_key" not in body["llm"]
    assert "key" not in body["llm"]


def test_put_settings_round_trips(client: TestClient) -> None:
    body = client.get("/api/settings").json()
    body["llm"]["batch_size"] = 25
    response = client.put("/api/settings", json=body)
    assert response.status_code == 200
    assert response.json()["llm"]["batch_size"] == 25

    refetched = client.get("/api/settings").json()
    assert refetched["llm"]["batch_size"] == 25


def test_test_llm_reports_disabled_when_mode_is_none(client: TestClient) -> None:
    response = client.post("/api/settings/test-llm")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is False
