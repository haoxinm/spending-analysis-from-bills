"""Merge the opt-in fallback extractor's forms into a deterministic parse (pure; no LLM import).

`apply_fallback` is called by the import pipeline after `orchestrator.parse_document` and before
any database write. The extractor is injected (`core.tax_types.TaxFallbackExtractor`); this module
never imports it, so the tax package stays free of LLM code.

Rules: deterministic results always win. The extractor is asked only about the regions the parsers
could not read (`ParsedTaxDocument.unparsed`), or about the whole text layer when nothing parsed
and a tax year is known (printed on the file, or given by the user). Its forms are appended, except
that items of a consolidated broker statement are merged into the matching deterministic account
form for sections the parser did not read. The extractor can never fail the import: any error
becomes a warning.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from spend_analyzer.core.errors import EgressViolation
from spend_analyzer.core.logging import get_logger
from spend_analyzer.core.tax_types import (
    ParsedIncomeItem,
    ParsedTaxDocument,
    ParsedTaxForm,
    ParsedTaxItem,
    TaxFallbackExtractor,
    UnparsedRegion,
)
from spend_analyzer.core.types import ExtractedDoc
from spend_analyzer.ingest.tax.common import MAX_TAX_YEAR, MIN_TAX_YEAR, check_warning
from spend_analyzer.ingest.tax.normalize import normalize_doc
from spend_analyzer.ingest.tax.orchestrator import ParseOutcome
from spend_analyzer.ingest.tax.year import detect_tax_year

logger = get_logger("ingest.tax.fallback")

FALLBACK_FAILED_WARNING = "The LLM fallback failed unexpectedly; the file was imported without it."
_REVIEW_WARNING = "Some values were read by your LLM; review them."


@dataclass(frozen=True, slots=True)
class FallbackRun:
    """The merged document (`None` when nothing could be read at all) plus bookkeeping."""

    document: ParsedTaxDocument | None
    requests_sent: int
    attempted: bool


def _whole_file_regions(doc: ExtractedDoc) -> tuple[UnparsedRegion, ...]:
    pages = tuple(p.page_number for p in doc.pages if p.text.strip())
    return (UnparsedRegion(kind="unknown", pages=pages, reason="unreadable"),) if pages else ()


def _same_account(llm: ParsedTaxForm, target: ParsedTaxForm) -> bool:
    for a, b in (
        (llm.account_last4, target.account_last4),
        (llm.payer_tin_last4, target.payer_tin_last4),
    ):
        if a is not None and b is not None and a == b:
            return True
    return False


def _merge_into(target: ParsedTaxForm, llm: ParsedTaxForm) -> ParsedTaxForm | None:
    """`target` plus the LLM items of sections the parser did not read; `None` if nothing new."""
    read_sections = {i.source_form for i in target.income} | {t.source_form for t in target.taxes}
    income: tuple[ParsedIncomeItem, ...] = tuple(
        i for i in llm.income if i.source_form not in read_sections
    )
    taxes: tuple[ParsedTaxItem, ...] = tuple(
        t for t in llm.taxes if t.source_form not in read_sections
    )
    if not income and not taxes:
        return None
    warnings = tuple(dict.fromkeys((*target.warnings, _REVIEW_WARNING)))
    return replace(
        target,
        income=(*target.income, *income),
        taxes=(*target.taxes, *taxes),
        warnings=warnings,
    )


def _merge_forms(
    det: tuple[ParsedTaxForm, ...], llm_forms: tuple[ParsedTaxForm, ...]
) -> tuple[ParsedTaxForm, ...]:
    forms = list(det)
    consolidated = [i for i, f in enumerate(forms) if f.form_type == "1099-consolidated"]
    for llm in llm_forms:
        if llm.form_type == "1099-consolidated" and consolidated:
            matches = [i for i in consolidated if _same_account(llm, forms[i])]
            if not matches and len(consolidated) == 1:
                matches = consolidated
            if matches:
                merged = _merge_into(forms[matches[0]], llm)
                if merged is not None:
                    forms[matches[0]] = merged
                continue  # sections the parser read win; nothing is added as a second form
        forms.append(llm)
    return tuple(forms)


def apply_fallback(
    extracted: ExtractedDoc,
    outcome: ParseOutcome | None,
    fallback: TaxFallbackExtractor | None,
    *,
    tax_year: int | None,
) -> FallbackRun:
    """Run `fallback` over what the deterministic `outcome` could not read.

    Args:
        extracted: the file's text layer (original page numbers).
        outcome: the deterministic result, or `None` when parsing failed outright.
        fallback: the opt-in extractor, or `None` (then the outcome is returned unchanged).
        tax_year: the user's override, used only when no parsed document supplies a year.
    """
    det = outcome.document if outcome is not None else None
    if fallback is None or not extracted.has_text_layer:
        return FallbackRun(det, 0, False)
    if det is not None:
        regions: tuple[UnparsedRegion, ...] = det.unparsed
        year: int | None = det.tax_year
    else:
        regions = _whole_file_regions(extracted)
        year = tax_year if tax_year is not None else detect_tax_year(normalize_doc(extracted))
    if not regions or year is None or not MIN_TAX_YEAR <= year <= MAX_TAX_YEAR:
        return FallbackRun(det, 0, False)

    try:
        result = fallback.extract(extracted, regions, tax_year=year)
    except EgressViolation:
        raise
    except Exception as exc:  # the fallback must never fail an import
        logger.warning("tax llm fallback failed: %s", type(exc).__name__)
        if det is None:
            return FallbackRun(None, 0, True)
        return FallbackRun(
            replace(det, warnings=(*det.warnings, check_warning(FALLBACK_FAILED_WARNING))), 0, True
        )

    warnings = tuple(check_warning(w) for w in result.warnings)
    if det is None:
        if not result.forms:
            return FallbackRun(None, result.requests_sent, True)
        document = ParsedTaxDocument(
            tax_year=year, forms=result.forms, warnings=tuple(dict.fromkeys(warnings))
        )
        return FallbackRun(document, result.requests_sent, True)
    forms = _merge_forms(det.forms, result.forms)
    merged = replace(det, forms=forms, warnings=tuple(dict.fromkeys((*det.warnings, *warnings))))
    return FallbackRun(merged, result.requests_sent, True)
