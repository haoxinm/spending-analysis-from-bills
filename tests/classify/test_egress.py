"""Tests for `classify/llm/egress.py` (I1, I2, I10; §3.7)."""

from __future__ import annotations

import ast
import json
from pathlib import Path
from typing import Any

import litellm
import pytest

from spend_analyzer.classify.llm import egress
from spend_analyzer.config import LLMConfig
from spend_analyzer.core.errors import EgressViolation, LLMError

_LLM_ROOT = (
    Path(__file__).resolve().parent.parent.parent / "src" / "spend_analyzer" / "classify" / "llm"
)

#: I1b: these column names must never appear in any module under classify/llm/, because they
#: name the local-only fields that must never be egressed.
_LOCAL_ONLY_TERMS = (
    "accounts.mask",
    "accounts.issuer_id",
    "issuers.name",
    "issuers.slug",
    "issuers.match_terms",
    "description_raw",
    "transactions.issuer_category",
    "users.name",
    "pii_aliases",
)


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


class _FakeUsage:
    def __init__(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens


class _FakeResponse:
    def __init__(
        self,
        content: str,
        *,
        cost: float | None = 0.001,
        prompt_tokens: int = 10,
        completion_tokens: int = 20,
    ) -> None:
        self.choices = [_FakeChoice(content)]
        self.usage = _FakeUsage(prompt_tokens, completion_tokens)
        self._hidden_params: dict[str, Any] = {"response_cost": cost}


def _items_payload(*items: dict[str, Any]) -> str:
    return json.dumps({"items": list(items)})


def _cfg(**overrides: Any) -> LLMConfig:
    base = {"mode": "remote", "provider": "anthropic", "model": "anthropic/claude-x"}
    base.update(overrides)
    return LLMConfig(**base)


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keychain/keyring must be mocked in tests: `get_api_key` checks the env var first, so
    setting it avoids ever touching the real (and here, backend-less) OS keyring."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real")


def test_build_csv_header_and_rows() -> None:
    payload = egress.build_csv([(1, "TRADER JOES #123 SEATTLE WA"), (2, "DELTA AIR LINES")])
    assert payload == "id,description\n1,TRADER JOES #123 SEATTLE WA\n2,DELTA AIR LINES\n"


@pytest.mark.parametrize(
    "bad_description",
    [
        "CARD 4111111111111111",  # long digit run
        "contact us at billing@example.com",  # email
        "call 555-123-4567 now",  # phone
        "charged $12.34 today",  # currency amount
        "posted 2024-01-15",  # ISO date
    ],
)
def test_assert_safe_raises_on_forbidden_patterns(bad_description: str) -> None:
    payload = egress.build_csv([(1, bad_description)])
    with pytest.raises(EgressViolation):
        egress.assert_safe(payload)


def test_assert_safe_allows_store_numbers() -> None:
    # Short store numbers (#1234) survive normalization and are intentionally safe (§3.7).
    payload = egress.build_csv([(1, "TRADER JOES #1234 SEATTLE WA")])
    egress.assert_safe(payload)  # must not raise


def test_preview_payload_makes_no_network_call(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fail(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("preview_payload must not call litellm.completion")

    monkeypatch.setattr(egress.litellm, "completion", _fail)
    payload = egress.preview_payload(["TRADER JOES #123", "DELTA AIR LINES"])
    assert payload == egress.build_csv([(1, "TRADER JOES #123"), (2, "DELTA AIR LINES")])


def test_preview_payload_raises_on_violation() -> None:
    with pytest.raises(EgressViolation):
        egress.preview_payload(["email me at a@b.com"])


def test_classify_batch_raises_when_no_provider_configured() -> None:
    with pytest.raises(LLMError, match="no provider configured"):
        egress.classify_batch(["TRADER JOES"], LLMConfig(mode="none"))


def test_classify_batch_raises_when_provider_or_model_blank() -> None:
    with pytest.raises(LLMError, match="no provider configured"):
        egress.classify_batch(["TRADER JOES"], LLMConfig(mode="remote", provider="", model=""))


def test_classify_batch_uses_json_schema_mode_when_supported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def _fake_completion(**kwargs: Any) -> _FakeResponse:
        captured.update(kwargs)
        return _FakeResponse(
            _items_payload(
                {
                    "id": 1,
                    "category": "grocery",
                    "subcategory": "grocery_stores",
                    "merchant_canonical": "Trader Joes",
                    "confidence": 0.95,
                    "is_online_store": False,
                }
            )
        )

    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(egress.litellm, "completion", _fake_completion)

    result = egress.classify_batch(["TRADER JOES #123"], _cfg())

    assert result.schema_mode == "json_schema"
    assert captured["response_format"]["type"] == "json_schema"
    assert result.status == "ok"
    assert result.missing_ids == ()
    assert len(result.items) == 1
    assert result.items[0].merchant_canonical == "Trader Joes"
    assert result.cost_usd == 0.001
    assert result.tokens_in == 10
    assert result.tokens_out == 20
    assert result.provider == "anthropic"
    assert result.row_count == 1


def test_classify_batch_falls_back_to_json_object_when_unsupported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    def _fake_completion(**kwargs: Any) -> _FakeResponse:
        captured.update(kwargs)
        return _FakeResponse(_items_payload())

    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: False)
    monkeypatch.setattr(egress.litellm, "completion", _fake_completion)

    result = egress.classify_batch([], _cfg())

    assert result.schema_mode == "json_object"
    assert captured["response_format"] == {"type": "json_object"}
    assert result.row_count == 0


def test_classify_batch_supports_response_schema_exception_falls_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(**_: Any) -> bool:
        raise RuntimeError("provider metadata unavailable")

    monkeypatch.setattr(egress.litellm, "supports_response_schema", _raise)
    monkeypatch.setattr(egress.litellm, "completion", lambda **_: _FakeResponse(_items_payload()))

    result = egress.classify_batch(["ACME"], _cfg())
    assert result.schema_mode == "json_object"


def test_classify_batch_rejects_out_of_taxonomy_category(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(
        egress.litellm,
        "completion",
        lambda **_: _FakeResponse(
            _items_payload(
                {
                    "id": 1,
                    "category": "not_a_real_category",
                    "subcategory": "whatever",
                    "merchant_canonical": "X",
                    "confidence": 0.5,
                }
            )
        ),
    )

    result = egress.classify_batch(["MYSTERY MERCHANT"], _cfg())

    assert result.items == ()
    assert result.missing_ids == (1,)
    assert result.status == "partial"


def test_classify_batch_rejects_subcategory_not_in_category(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(
        egress.litellm,
        "completion",
        lambda **_: _FakeResponse(
            _items_payload(
                {
                    "id": 1,
                    "category": "grocery",
                    "subcategory": "flights",  # valid subcategory, wrong category
                    "merchant_canonical": "X",
                    "confidence": 0.5,
                }
            )
        ),
    )

    result = egress.classify_batch(["MYSTERY MERCHANT"], _cfg())
    assert result.missing_ids == (1,)


def test_classify_batch_accepts_dynamic_online_shopping_slug(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(
        egress.litellm,
        "completion",
        lambda **_: _FakeResponse(
            _items_payload(
                {
                    "id": 1,
                    "category": "online_shopping",
                    "subcategory": "yami",
                    "merchant_canonical": "Yamibuy",
                    "confidence": 0.8,
                    "is_online_store": True,
                }
            )
        ),
    )

    result = egress.classify_batch(["YAMIBUY"], _cfg())
    assert result.status == "ok"
    assert result.items[0].subcategory == "yami"


def test_classify_batch_duplicate_id_treated_as_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(
        egress.litellm,
        "completion",
        lambda **_: _FakeResponse(
            _items_payload(
                {
                    "id": 1,
                    "category": "grocery",
                    "subcategory": "grocery_stores",
                    "merchant_canonical": "A",
                    "confidence": 0.9,
                },
                {
                    "id": 1,
                    "category": "fuel",
                    "subcategory": "gasoline",
                    "merchant_canonical": "B",
                    "confidence": 0.9,
                },
            )
        ),
    )

    result = egress.classify_batch(["SOMETHING"], _cfg())
    assert result.items == ()
    assert result.missing_ids == (1,)


def test_classify_batch_cost_extraction_degrades_to_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)

    def _fake_completion(**_: Any) -> _FakeResponse:
        return _FakeResponse(_items_payload(), cost=None)

    monkeypatch.setattr(egress.litellm, "completion", _fake_completion)

    def _raise_cost(**_: Any) -> float:
        raise RuntimeError("no pricing data")

    monkeypatch.setattr(egress.litellm, "completion_cost", _raise_cost)

    result = egress.classify_batch(["X"], _cfg())
    assert result.cost_usd == 0.0


def test_classify_batch_request_failure_raises_llm_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(**_: Any) -> Any:
        raise RuntimeError("connection refused")

    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(egress.litellm, "completion", _raise)

    with pytest.raises(LLMError):
        egress.classify_batch(["X"], _cfg())


def test_classify_batch_malformed_json_raises_llm_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(egress.litellm, "completion", lambda **_: _FakeResponse("not json at all"))

    with pytest.raises(LLMError):
        egress.classify_batch(["X"], _cfg())


def test_classify_batch_strips_markdown_code_fence(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    fenced = (
        "```json\n"
        + _items_payload(
            {
                "id": 1,
                "category": "grocery",
                "subcategory": "grocery_stores",
                "merchant_canonical": "X",
                "confidence": 0.9,
            }
        )
        + "\n```"
    )
    monkeypatch.setattr(egress.litellm, "completion", lambda **_: _FakeResponse(fenced))

    result = egress.classify_batch(["X"], _cfg())
    assert result.status == "ok"
    assert result.items[0].id == 1


def test_request_sha256_is_deterministic_for_same_descriptions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(egress.litellm, "completion", lambda **_: _FakeResponse(_items_payload()))

    r1 = egress.classify_batch(["A", "B"], _cfg())
    r2 = egress.classify_batch(["A", "B"], _cfg())
    assert r1.request_sha256 == r2.request_sha256

    payload = egress.build_csv([(1, "A"), (2, "B")])
    import hashlib

    assert r1.request_sha256 == hashlib.sha256(payload.encode("utf-8")).hexdigest()


def test_classify_batch_real_litellm_mock_response_integration() -> None:
    """End-to-end through the real `litellm.completion(mock_response=...)` path, per the plan's
    note that this is what makes CI network-free (no monkeypatching of litellm internals)."""
    content = _items_payload(
        {
            "id": 1,
            "category": "others",
            "subcategory": "uncategorized",
            "merchant_canonical": "Unknown",
            "confidence": 0.1,
        }
    )
    original_completion = litellm.completion

    def _completion_with_mock(**kwargs: Any) -> Any:
        kwargs["mock_response"] = content
        return original_completion(**kwargs)

    import spend_analyzer.classify.llm.egress as egress_module

    egress_module_completion = egress_module.litellm.completion
    try:
        egress_module.litellm.completion = _completion_with_mock  # type: ignore[method-assign]
        result = egress.classify_batch(["ACME WIDGET CO"], _cfg())
    finally:
        egress_module.litellm.completion = egress_module_completion  # type: ignore[method-assign]

    assert result.status == "ok"
    assert result.items[0].category == "others"


def test_only_egress_imports_litellm_within_llm_package() -> None:
    for path in sorted(_LLM_ROOT.glob("*.py")):
        if path.name == "egress.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module is not None:
                imported.add(node.module.split(".")[0])
        assert "litellm" not in imported, f"{path} must not import litellm"


def test_llm_package_never_mentions_local_only_columns() -> None:
    """I1b: a CI guard specific to classify/llm/ — none of the local-only field names may
    appear anywhere in this module tree, not even in a comment or docstring."""
    for path in sorted(_LLM_ROOT.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        for term in _LOCAL_ONLY_TERMS:
            assert term not in text, f"{path} mentions local-only field {term!r} (I1b)"
