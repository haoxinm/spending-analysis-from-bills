"""`/api/settings`, `/api/settings/test-llm`, and `/api/settings/api-key` (§3.12, A4, I7).

`GET /api/settings` never returns key material: it reports `has_key` (whether a key is present in
the Keychain or an env var override) instead of the key itself. `PUT /api/settings` rewrites
`config.toml` atomically (A4) via `spend_analyzer.config.save_settings`; it never writes a secret
there either. Setting or clearing the key itself goes through the dedicated
`PUT`/`DELETE /api/settings/api-key` routes below, which write straight to the OS keychain via
`config.set_api_key`/`delete_api_key` (I7) and never echo the key back, log it, or persist it
anywhere else.
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SettingsDep
from spend_analyzer.config import Settings, delete_api_key, get_api_key, save_settings, set_api_key

router = APIRouter(tags=["settings"])


def _settings_schema(settings: Settings) -> schemas.Settings:
    return schemas.Settings(
        llm=schemas.LlmSettings(
            mode=settings.llm.mode,
            provider=settings.llm.provider,
            model=settings.llm.model,
            api_base=settings.llm.api_base,
            batch_size=settings.llm.batch_size,
            timeout_s=settings.llm.timeout_s,
            confidence_threshold=settings.llm.confidence_threshold,
            has_key=bool(settings.llm.provider) and get_api_key(settings.llm.provider) is not None,
        ),
        privacy=schemas.PrivacySettings(
            store_pdf_copies=settings.privacy.store_pdf_copies,
            store_extract_cache=settings.privacy.store_extract_cache,
            pii_terms=list(settings.privacy.pii_terms),
        ),
        ingest=schemas.IngestSettings(
            always_confirm_extractor=settings.ingest.always_confirm_extractor,
            date_format_hints=list(settings.ingest.date_format_hints),
            default_currency=settings.ingest.default_currency,
        ),
        server=schemas.ServerSettings(port=settings.server.port),
    )


@router.get("/settings", response_model=schemas.Settings)
def get_settings_route(settings: SettingsDep) -> schemas.Settings:
    return _settings_schema(settings)


@router.put("/settings", response_model=schemas.Settings)
def put_settings(body: schemas.Settings) -> schemas.Settings:
    from spend_analyzer.config import IngestConfig, LLMConfig, PrivacyConfig, ServerConfig

    new_settings = Settings(
        llm=LLMConfig(
            mode=body.llm.mode,
            provider=body.llm.provider,
            model=body.llm.model,
            api_base=body.llm.api_base,
            batch_size=body.llm.batch_size,
            timeout_s=body.llm.timeout_s,
            confidence_threshold=body.llm.confidence_threshold,
        ),
        privacy=PrivacyConfig(
            store_pdf_copies=body.privacy.store_pdf_copies,
            store_extract_cache=body.privacy.store_extract_cache,
            pii_terms=tuple(body.privacy.pii_terms),
        ),
        ingest=IngestConfig(
            always_confirm_extractor=body.ingest.always_confirm_extractor,
            date_format_hints=tuple(body.ingest.date_format_hints),
            default_currency=body.ingest.default_currency,
        ),
        server=ServerConfig(port=body.server.port),
    )
    save_settings(new_settings)
    return _settings_schema(new_settings)


@router.put("/settings/api-key", status_code=204, response_class=Response)
def put_api_key(body: schemas.ApiKeyPut) -> Response:
    """Store `body.api_key` for `body.provider` in the OS keychain (I7). Never returned, logged,
    or written to `config.toml`/the database — `body` itself is never included in any response."""
    set_api_key(body.provider, body.api_key)
    return Response(status_code=204)


@router.delete("/settings/api-key", status_code=204, response_class=Response)
def delete_api_key_route(provider: str) -> Response:
    """Remove `provider`'s key from the OS keychain, if present (I7). Idempotent: clearing an
    already-absent key is not an error."""
    delete_api_key(provider)
    return Response(status_code=204)


@router.post("/settings/test-llm", response_model=schemas.TestLlmResponse)
def test_llm_settings(settings: SettingsDep) -> schemas.TestLlmResponse:
    """One-row round trip verifying credentials, via the same `classify_batch` egress path every
    real classification uses (never a bespoke LLM call)."""
    if settings.llm.mode == "none":
        return schemas.TestLlmResponse(ok=False, detail="LLM mode is 'none'; nothing to test")
    try:
        from spend_analyzer.classify.llm.egress import classify_batch
    except ModuleNotFoundError as exc:  # pragma: no cover - only until P1-D merges
        return schemas.TestLlmResponse(ok=False, detail=f"egress module unavailable: {exc}")
    try:
        result = classify_batch(["Test Merchant"], settings.llm)
    except Exception as exc:
        return schemas.TestLlmResponse(ok=False, detail=str(exc))
    return schemas.TestLlmResponse(ok=True, detail=f"received {len(result.items)} item(s)")
