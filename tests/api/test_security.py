"""A31/I8: Host allowlist and per-launch token enforcement."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_missing_token_is_403(client: TestClient) -> None:
    response = client.get("/api/users", headers={"X-Spend-Token": ""})
    assert response.status_code == 403


def test_wrong_host_is_403(client: TestClient) -> None:
    response = client.get("/api/users", headers={"Host": "evil.example"})
    assert response.status_code == 403


def test_multipart_upload_without_token_is_403(client: TestClient) -> None:
    response = client.post(
        "/api/statements",
        headers={"X-Spend-Token": ""},
        data={"user_id": "1"},
        files={"file": ("s.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert response.status_code == 403


def test_valid_host_and_token_passes(client: TestClient) -> None:
    response = client.get("/api/users")
    assert response.status_code == 200


def test_localhost_hostname_also_allowed(client: TestClient) -> None:
    response = client.get("/api/users", headers={"Host": "localhost"})
    assert response.status_code == 200
