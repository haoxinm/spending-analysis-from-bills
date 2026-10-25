"""Factory for the opt-in tax LLM fallback: the only module that imports `llm/tax_parser.py`.

`build_tax_fallback` returns `None` (the deterministic-only path, nothing leaves the machine)
unless the LLM is enabled and configured AND the user switched on ``[ingest] tax_llm_fallback``.
The tax package itself imports no LLM code; it only receives the returned object through the
`TaxFallbackExtractor` protocol.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from spend_analyzer.config import Settings, load_settings
from spend_analyzer.core.tax_types import TaxFallbackExtractor
from spend_analyzer.db.pii_terms import user_pii_terms
from spend_analyzer.llm.tax_parser import TaxLLMExtractor


def tax_fallback_enabled(settings: Settings) -> bool:
    """Is the fallback effective? (LLM configured and the separate tax opt-in on.)"""
    return settings.llm.is_configured and settings.ingest.tax_llm_fallback


def build_tax_fallback(
    session: Session, user_id: int | None, settings: Settings | None = None
) -> TaxFallbackExtractor | None:
    """The fallback extractor for ``user_id`` (their personal-info terms are redacted), or `None`.

    Call this before the import so the user's terms are read outside any write transaction.
    """
    resolved = settings if settings is not None else load_settings()
    if not tax_fallback_enabled(resolved):
        return None
    return TaxLLMExtractor(resolved.llm, user_pii_terms(session, resolved, user_id))
