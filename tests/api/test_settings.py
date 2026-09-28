"""`/api/settings*` (A4, I7): never returns key material."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from spend_analyzer import config as config_module


class _FakeKeyring:
    """Mirrors `tests/core/test_config.py`'s fake so this file never touches a real OS
    keychain (I7's `config.set_api_key`/`get_api_key`/`delete_api_key` call `keyring.*`
    directly)."""

    def __init__(self) -> None:
        self.store: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, account: str) -> str | None:
        return self.store.get((service, account))

    def set_password(self, service: str, account: str, value: str) -> None:
        self.store[(service, account)] = value

    def delete_password(self, service: str, account: str) -> None:
        import keyring.errors

        if (service, account) not in self.store:
            raise keyring.errors.PasswordDeleteError("not found")
        del self.store[(service, account)]


@pytest.fixture
def fake_keyring(monkeypatch: pytest.MonkeyPatch) -> _FakeKeyring:
    fake = _FakeKeyring()
    monkeypatch.setattr(config_module.keyring, "get_password", fake.get_password)
    monkeypatch.setattr(config_module.keyring, "set_password", fake.set_password)
    monkeypatch.setattr(config_module.keyring, "delete_password", fake.delete_password)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    return fake


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


_SECRET = "sk-ant-super-secret-value"


def test_put_api_key_stores_it_and_never_echoes_it(
    client: TestClient, fake_keyring: _FakeKeyring
) -> None:
    response = client.put(
        "/api/settings/api-key", json={"provider": "anthropic", "api_key": _SECRET}
    )
    assert response.status_code == 204
    assert response.text == ""
    assert _SECRET not in response.headers.values()

    assert fake_keyring.store[("spend-analyzer", "anthropic")] == _SECRET

    settings_body = client.get("/api/settings").json()
    assert _SECRET not in str(settings_body)


def test_put_api_key_is_never_logged(
    client: TestClient, fake_keyring: _FakeKeyring, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.DEBUG):
        response = client.put(
            "/api/settings/api-key", json={"provider": "anthropic", "api_key": _SECRET}
        )
    assert response.status_code == 204
    for record in caplog.records:
        assert _SECRET not in record.getMessage()


def test_put_api_key_never_reaches_config_toml(
    client: TestClient, fake_keyring: _FakeKeyring, home: Path
) -> None:
    client.put("/api/settings/api-key", json={"provider": "anthropic", "api_key": _SECRET})
    settings_body = client.get("/api/settings").json()
    settings_body["llm"]["provider"] = "anthropic"
    client.put("/api/settings", json=settings_body)

    config_path = home / "config.toml"
    if config_path.exists():
        assert _SECRET not in config_path.read_text()


def test_delete_api_key_clears_it(client: TestClient, fake_keyring: _FakeKeyring) -> None:
    client.put("/api/settings/api-key", json={"provider": "anthropic", "api_key": _SECRET})
    assert ("spend-analyzer", "anthropic") in fake_keyring.store

    response = client.delete("/api/settings/api-key", params={"provider": "anthropic"})
    assert response.status_code == 204
    assert ("spend-analyzer", "anthropic") not in fake_keyring.store


def test_delete_api_key_is_idempotent_when_absent(
    client: TestClient, fake_keyring: _FakeKeyring
) -> None:
    response = client.delete("/api/settings/api-key", params={"provider": "never-set"})
    assert response.status_code == 204


def test_api_key_routes_require_the_token(client: TestClient) -> None:
    put_response = client.put(
        "/api/settings/api-key",
        json={"provider": "anthropic", "api_key": _SECRET},
        headers={"X-Spend-Token": "wrong-token"},
    )
    assert put_response.status_code == 403

    delete_response = client.delete(
        "/api/settings/api-key",
        params={"provider": "anthropic"},
        headers={"X-Spend-Token": "wrong-token"},
    )
    assert delete_response.status_code == 403
