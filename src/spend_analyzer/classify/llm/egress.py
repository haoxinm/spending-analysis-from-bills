"""LLM egress boundary (§3.7). The **only** module in this tree that may `import litellm` (I2).

This module owns invariants **I1** (only `description_clean`, as CSV, ever leaves the machine),
**I2** (the sole `litellm` import site), and **I10** (every automated classification records
provider, model, prompt version, schema mode, cost, and confidence — via `BatchResult`).

Public surface (per §3.7): `build_csv`, `assert_safe`, `classify_batch`, `preview_payload`.
`propose_layout_spec` (A20) is Phase 5 only and is not present here.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import time
from collections import Counter
from dataclasses import dataclass
from typing import Literal

import litellm
from pydantic import ValidationError

from spend_analyzer.classify.llm.prompt import PROMPT_VERSION, SYSTEM_PROMPT
from spend_analyzer.classify.llm.schema import ClassificationBatch, Item
from spend_analyzer.config import LLMConfig, get_api_key
from spend_analyzer.core.errors import EgressViolation, LLMError

#: Patterns that must never appear in a payload sent to an LLM (§3.7). `assert_safe` raises
#: rather than sanitizes: a match means normalization has a bug upstream, and papering over it
#: at this boundary would hide that bug (A13 catches the same patterns earlier, at normalization
#: time, without raising, so the bug surfaces at its source too).
FORBIDDEN: tuple[str, ...] = (
    r"\d{6,}",  # long digit runs (cards, account numbers)
    r"[\w.+-]+@[\w-]+\.\w+",  # email
    r"\+?\d[\d\-\(\) ]{8,}\d",  # phone
    r"\$\s?\d",  # currency amounts
    r"\b\d{4}-\d{2}-\d{2}\b",  # ISO dates
)

_FORBIDDEN_RE = tuple(re.compile(pattern) for pattern in FORBIDDEN)

SchemaMode = Literal["json_schema", "json_object"]


@dataclass(frozen=True, slots=True)
class BatchResult:
    """The outcome of one `classify_batch` call: the validated classifications, plus everything
    `llm_runs` (§3.2, I10) needs recorded about the call. This module never writes to the
    database — P2-B persists.

    `items` are keyed by the ephemeral per-request id `build_csv` assigned to the `descriptions`
    passed to this call (1..N, not a database id — A2). `missing_ids` lists ids that the response
    did not echo exactly once, or that failed schema/taxonomy validation; the caller
    (`batching.py`) decides whether to retry them.
    """

    items: tuple[Item, ...]
    missing_ids: tuple[int, ...]
    provider: str
    model: str
    prompt_version: str
    schema_mode: SchemaMode
    row_count: int
    tokens_in: int | None
    tokens_out: int | None
    cost_usd: float
    latency_ms: int
    status: Literal["ok", "partial"]
    request_sha256: str


def build_csv(rows: list[tuple[int, str]]) -> str:
    """Build the exact two-column CSV payload sent to the LLM: `id,description`.

    `id` is `1..N` **per request**, not a database id (§3.7) — nothing correlates across
    requests. Uses `\\n` line endings (no `\\r\\n`) so `request_sha256` is stable across
    platforms.
    """
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["id", "description"])
    for row_id, description in rows:
        writer.writerow([row_id, description])
    return buf.getvalue()


def assert_safe(csv_payload: str) -> None:
    """Raise `EgressViolation` if `csv_payload` matches any `FORBIDDEN` pattern.

    Called unconditionally before every network call, including for local models (I1). In
    correct operation this never fires — normalization already strips everything `FORBIDDEN`
    matches — so a match here means normalization has a bug, and it is raised rather than
    sanitized so the bug is not hidden.

    Raises:
        EgressViolation: a forbidden pattern was found in the payload.
    """
    for pattern in _FORBIDDEN_RE:
        if pattern.search(csv_payload):
            raise EgressViolation(
                f"egress payload matches a FORBIDDEN pattern ({pattern.pattern!r}); this "
                "indicates a bug in normalization, not a recoverable condition"
            )


def preview_payload(descriptions: list[str]) -> str:
    """Return exactly the CSV payload that `classify_batch` would send for `descriptions`.

    Makes **no network call**. Used by the review UI to show the user what will be sent before
    they approve an LLM run. Still runs `assert_safe`, so a preview cannot hide a violation that
    the real call would raise on.

    Raises:
        EgressViolation: the payload contains a `FORBIDDEN` pattern.
    """
    rows = list(enumerate(descriptions, start=1))
    payload = build_csv(rows)
    assert_safe(payload)
    return payload


def classify_batch(descriptions: list[str], cfg: LLMConfig) -> BatchResult:
    """Classify `descriptions` in a single LLM request.

    Sends only `description` values, as a two-column CSV (`id,description`), through
    `litellm.completion`. Never sends raw PDF text, dates, amounts, issuer names, account
    identifiers, or any other local-only field (I1, I1b) — callers are responsible for passing
    already-normalized `description_clean` values.

    Args:
        descriptions: one `description_clean` per row, in the order the returned `Item.id`
            values (1-based) refer to.
        cfg: the LLM provider configuration (`config.toml` `[llm]` section).

    Returns:
        A `BatchResult` with every row that validated (schema + taxonomy) and the ids of every
        row that did not.

    Raises:
        EgressViolation: the payload contains a `FORBIDDEN` pattern (never swallowed).
        LLMError: no provider is configured (`cfg.mode == "none"` or `cfg.provider`/`cfg.model`
            is empty — a first-class mode per D2, not a crash), or the request itself failed
            (network, auth, timeout, malformed response after retries).
    """
    if cfg.mode == "none" or not cfg.provider or not cfg.model:
        raise LLMError("no provider configured")

    rows = list(enumerate(descriptions, start=1))
    csv_payload = build_csv(rows)
    assert_safe(csv_payload)
    request_sha256 = hashlib.sha256(csv_payload.encode("utf-8")).hexdigest()

    schema_mode: SchemaMode
    try:
        supported = litellm.supports_response_schema(
            model=cfg.model, custom_llm_provider=cfg.provider or None
        )
    except Exception:
        supported = False  # defensive: never let this helper break a run

    if supported:
        response_format: dict[str, object] = {
            "type": "json_schema",
            "json_schema": {
                "name": "classification",
                "strict": True,
                "schema": ClassificationBatch.model_json_schema(),  # A8: dict, never the class
            },
        }
        schema_mode = "json_schema"
    else:
        response_format = {"type": "json_object"}
        schema_mode = "json_object"

    api_key = get_api_key(cfg.provider) if cfg.provider else None

    started = time.monotonic()
    try:
        resp = litellm.completion(
            model=cfg.model,
            api_base=cfg.api_base or None,
            api_key=api_key,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": csv_payload},
            ],
            response_format=response_format,
            temperature=0,
            num_retries=2,
            timeout=cfg.timeout_s,
        )
    except Exception as exc:
        raise LLMError(f"LLM request failed: {exc}") from exc
    latency_ms = int((time.monotonic() - started) * 1000)

    content = _response_text(resp)
    raw_items = _parse_raw_items(content)
    expected_ids = set(range(1, len(descriptions) + 1))
    items, missing_ids = _validate_items(raw_items, expected_ids)

    usage = getattr(resp, "usage", None)
    tokens_in = getattr(usage, "prompt_tokens", None) if usage is not None else None
    tokens_out = getattr(usage, "completion_tokens", None) if usage is not None else None

    cost_usd = _extract_cost(resp)

    return BatchResult(
        items=tuple(items),
        missing_ids=tuple(missing_ids),
        provider=cfg.provider,
        model=cfg.model,
        prompt_version=PROMPT_VERSION,
        schema_mode=schema_mode,
        row_count=len(descriptions),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_usd=cost_usd,
        latency_ms=latency_ms,
        status="ok" if not missing_ids else "partial",
        request_sha256=request_sha256,
    )


def _response_text(resp: object) -> str:
    try:
        return str(resp.choices[0].message.content or "")  # type: ignore[attr-defined]
    except (AttributeError, IndexError) as exc:
        raise LLMError(f"malformed LLM response: no message content ({exc})") from exc


def _parse_raw_items(content: str) -> list[object]:
    """Parse the model's JSON reply into a list of raw item dicts, tolerating a markdown code
    fence around the JSON (some providers add one even when asked for JSON only)."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[len("json") :]
        text = text.strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"LLM response was not valid JSON: {exc}") from exc
    if isinstance(parsed, dict):
        items = parsed.get("items", [])
    elif isinstance(parsed, list):
        items = parsed
    else:
        raise LLMError("LLM response JSON was neither an object with 'items' nor a list")
    if not isinstance(items, list):
        raise LLMError("LLM response 'items' was not a list")
    return items


def _validate_items(
    raw_items: list[object], expected_ids: set[int]
) -> tuple[list[Item], list[int]]:
    """Validate each raw item independently against the schema and taxonomy, so **one bad row
    never fails a run**: an invalid item is simply excluded, not the whole response.

    Every id must be echoed exactly once; an id echoed more than once is treated as invalid (its
    value is ambiguous) and reported missing, same as an id that never appears.
    """
    id_counts: Counter[int] = Counter()
    parsed_by_id: dict[int, Item] = {}

    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        raw_id = raw.get("id")
        try:
            item = Item.model_validate(raw)
        except ValidationError:
            if isinstance(raw_id, int):
                id_counts[raw_id] += 1
            continue
        id_counts[item.id] += 1
        parsed_by_id[item.id] = item

    valid_ids = {
        item_id
        for item_id in expected_ids
        if id_counts.get(item_id, 0) == 1 and item_id in parsed_by_id
    }
    items = [parsed_by_id[item_id] for item_id in sorted(valid_ids)]
    missing_ids = sorted(expected_ids - valid_ids)
    return items, missing_ids


def _extract_cost(resp: object) -> float:
    """Best-effort cost extraction; must never fail a run (defaults to `0.0`)."""
    try:
        hidden = resp._hidden_params  # type: ignore[attr-defined]
        cost = hidden.get("response_cost")
        if cost is not None:
            return float(cost)
    except Exception:
        pass
    try:
        cost = litellm.completion_cost(completion_response=resp)
        if cost is not None:
            return float(cost)
    except Exception:
        pass
    return 0.0
