from __future__ import annotations

from pathlib import Path

import pytest

from spend_analyzer import config as config_module
from spend_analyzer.config import (
    IngestConfig,
    LLMConfig,
    PrivacyConfig,
    ServerConfig,
    Settings,
    delete_api_key,
    get_api_key,
    load_settings,
    save_settings,
    set_api_key,
)


def test_round_trip_preserves_all_fields(home: Path) -> None:
    settings = Settings(
        llm=LLMConfig(
            mode="remote",
            provider="anthropic",
            model="claude-x",
            api_base="",
            batch_size=25,
            timeout_s=30,
            confidence_threshold=0.9,
        ),
        privacy=PrivacyConfig(
            store_pdf_copies=False, store_extract_cache=True, pii_terms=("Alice", "Bob")
        ),
        ingest=IngestConfig(
            always_confirm_extractor=True,
            date_format_hints=("%Y-%m-%d",),
            default_currency="EUR",
        ),
        server=ServerConfig(port=9999),
    )
    path = home / "config.toml"
    save_settings(settings, path)
    loaded = load_settings(path)
    assert loaded == settings


def test_load_settings_defaults_when_file_absent(home: Path) -> None:
    loaded = load_settings(home / "does-not-exist.toml")
    assert loaded == Settings()


def test_env_override_wins_over_toml(home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = home / "config.toml"
    save_settings(Settings(llm=LLMConfig(mode="none")), path)
    monkeypatch.setenv("SPEND_ANALYZER_LLM__MODE", "local")
    loaded = load_settings(path)
    assert loaded.llm.mode == "local"


def test_save_settings_is_atomic_write(home: Path) -> None:
    path = home / "config.toml"
    save_settings(Settings(), path)
    assert path.exists()
    assert not path.with_suffix(path.suffix + ".tmp").exists()


class _FakeKeyring:
    def __init__(self) -> None:
        self.store: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, account: str) -> str | None:
        return self.store.get((service, account))

    def set_password(self, service: str, account: str, value: str) -> None:
        self.store[(service, account)] = value

    def delete_password(self, service: str, account: str) -> None:
        del self.store[(service, account)]


def test_api_key_never_touches_config_or_log(
    home: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    fake = _FakeKeyring()
    monkeypatch.setattr(config_module.keyring, "get_password", fake.get_password)
    monkeypatch.setattr(config_module.keyring, "set_password", fake.set_password)
    monkeypatch.setattr(config_module.keyring, "delete_password", fake.delete_password)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    set_api_key("anthropic", "sk-ant-super-secret-value")
    assert get_api_key("anthropic") == "sk-ant-super-secret-value"

    path = home / "config.toml"
    save_settings(Settings(llm=LLMConfig(provider="anthropic")), path)
    assert "sk-ant-super-secret-value" not in path.read_text()

    delete_api_key("anthropic")
    assert get_api_key("anthropic") is None


def test_get_api_key_prefers_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "env-value")
    assert get_api_key("openai") == "env-value"
