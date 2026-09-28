"""Settings model, load/save, and secret storage (§3.10, P0-2).

`config.toml` holds every non-secret setting. Secrets (LLM provider API keys) live only in the
OS keychain via `keyring` (I7) — never in `config.toml`, never in the database, never logged.

Every other module receives a `Settings` object; nothing outside this module reads `config.toml`
or touches `keyring` directly.
"""

from __future__ import annotations

import contextlib
import os
import tomllib
from pathlib import Path
from typing import Literal

import keyring
import keyring.errors
import tomli_w
from pydantic import BaseModel, ConfigDict

from spend_analyzer.core.paths import config_path, ensure_home

#: keyring service name; the account within it is the provider name (e.g. "anthropic").
_KEYRING_SERVICE = "spend-analyzer"


class LLMConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    mode: Literal["none", "local", "remote"] = "none"  # D2
    provider: str = ""  # "", anthropic, openai, gemini, ollama, lm_studio, ...
    model: str = ""
    api_base: str = ""  # required for ollama / lm_studio
    batch_size: int = 50
    timeout_s: int = 120
    confidence_threshold: float = 0.7


class PrivacyConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    store_pdf_copies: bool = True
    store_extract_cache: bool = False  # debugging only
    pii_terms: tuple[str, ...] = ()  # A11


class IngestConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    always_confirm_extractor: bool = False  # A22
    date_format_hints: tuple[str, ...] = ("%m/%d/%Y", "%m/%d", "%d %b %Y", "%Y-%m-%d")
    default_currency: str = "USD"


class ServerConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    port: int = 8756


class Settings(BaseModel):
    """The full set of non-secret settings, mirroring `config.toml` exactly."""

    model_config = ConfigDict(frozen=True)

    llm: LLMConfig = LLMConfig()
    privacy: PrivacyConfig = PrivacyConfig()
    ingest: IngestConfig = IngestConfig()
    server: ServerConfig = ServerConfig()


def load_settings(path: Path | None = None) -> Settings:
    """Load settings: defaults -> `config.toml` (if present) -> environment variable overrides.

    Env var overrides use the pattern ``SPEND_ANALYZER_<SECTION>__<FIELD>`` (double underscore),
    e.g. ``SPEND_ANALYZER_LLM__MODE=remote``. This lets CI and power users override settings
    without writing a file.
    """
    toml_path = path if path is not None else config_path()
    data: dict[str, object] = {}
    if toml_path.exists():
        with toml_path.open("rb") as f:
            data = tomllib.load(f)

    settings = Settings.model_validate(data)
    return _apply_env_overrides(settings)


def _apply_env_overrides(settings: Settings) -> Settings:
    prefix = "SPEND_ANALYZER_"
    overrides: dict[str, dict[str, str]] = {}
    for key, value in os.environ.items():
        if not key.startswith(prefix) or "__" not in key:
            continue
        section, _, field_name = key[len(prefix) :].partition("__")
        section = section.lower()
        field_name = field_name.lower()
        if section not in ("llm", "privacy", "ingest", "server"):
            continue
        overrides.setdefault(section, {})[field_name] = value

    if not overrides:
        return settings

    merged = settings.model_dump()
    for section, fields in overrides.items():
        for field_name, raw_value in fields.items():
            if field_name not in merged[section]:
                continue
            current = merged[section][field_name]
            merged[section][field_name] = _coerce(raw_value, current)
    return Settings.model_validate(merged)


def _coerce(raw: str, current: object) -> object:
    if isinstance(current, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(current, int):
        return int(raw)
    if isinstance(current, float):
        return float(raw)
    return raw


def save_settings(settings: Settings, path: Path | None = None) -> None:
    """Atomically write ``settings`` to `config.toml` (A4): serialize to a temp file in the same
    directory, then `os.replace` over the destination. Never writes a secret."""
    toml_path = path if path is not None else config_path()
    ensure_home()
    toml_path.parent.mkdir(parents=True, exist_ok=True)
    payload = settings.model_dump(mode="json")
    tmp_path = toml_path.with_suffix(toml_path.suffix + ".tmp")
    with tmp_path.open("wb") as f:
        tomli_w.dump(payload, f)
    os.replace(tmp_path, toml_path)


def get_api_key(provider: str) -> str | None:
    """Return the API key for ``provider``: checks ``{PROVIDER}_API_KEY`` env var first, then the
    OS keychain (service ``spend-analyzer``, account = provider name). Never logs the value."""
    env_var = f"{provider.upper()}_API_KEY"
    env_value = os.environ.get(env_var)
    if env_value:
        return env_value
    return keyring.get_password(_KEYRING_SERVICE, provider)


def set_api_key(provider: str, key: str) -> None:
    """Store ``key`` for ``provider`` in the OS keychain. Never written to `config.toml` or the
    database."""
    keyring.set_password(_KEYRING_SERVICE, provider, key)


def delete_api_key(provider: str) -> None:
    """Remove ``provider``'s key from the OS keychain, if present."""
    with contextlib.suppress(keyring.errors.PasswordDeleteError):
        keyring.delete_password(_KEYRING_SERVICE, provider)
