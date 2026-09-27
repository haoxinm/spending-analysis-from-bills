"""Tests for `spend_analyzer.eval.harness` (P4-C).

`run_eval` never touches the database, so no `session`/`engine` fixture is needed here. The LLM
path is exercised with `litellm.completion` monkeypatched, exactly as `tests/classify/
test_egress.py` does — never a real network call (§6.5).
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

import pytest

from spend_analyzer.classify.llm import egress
from spend_analyzer.config import LLMConfig
from spend_analyzer.core.errors import ConfigError
from spend_analyzer.eval import harness

_REAL_CSV = Path(__file__).parent / "descriptions.csv"


def _write_csv(path: Path, rows: list[tuple[str, str, str]]) -> Path:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["description", "category", "subcategory"])
        writer.writerows(rows)
    return path


def _cfg(**overrides: Any) -> LLMConfig:
    base = {"mode": "remote", "provider": "anthropic", "model": "anthropic/claude-x"}
    base.update(overrides)
    return LLMConfig(**base)


class _FakeMessage:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeChoice:
    def __init__(self, content: str) -> None:
        self.message = _FakeMessage(content)


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.choices = [_FakeChoice(content)]
        self.usage = None
        self._hidden_params: dict[str, Any] = {"response_cost": 0.0}


def _items_payload(*items: dict[str, Any]) -> str:
    return json.dumps({"items": list(items)})


@pytest.fixture(autouse=True)
def _fake_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keychain/keyring must be mocked in tests (per the common brief)."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test-key-not-real")


# --------------------------------------------------------------------------------------------
# load_eval_csv
# --------------------------------------------------------------------------------------------


def test_load_eval_csv_rejects_missing_column(tmp_path: Path) -> None:
    path = tmp_path / "bad.csv"
    path.write_text("description,category\nSTARBUCKS,restaurant\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="expected columns"):
        harness.load_eval_csv(path)


def test_load_eval_csv_rejects_unknown_category(tmp_path: Path) -> None:
    path = _write_csv(tmp_path / "bad.csv", [("STARBUCKS", "not_a_category", "dine_in")])
    with pytest.raises(ConfigError, match="unknown category"):
        harness.load_eval_csv(path)


def test_load_eval_csv_rejects_unknown_subcategory(tmp_path: Path) -> None:
    path = _write_csv(tmp_path / "bad.csv", [("STARBUCKS", "restaurant", "flights")])
    with pytest.raises(ConfigError, match="unknown subcategory"):
        harness.load_eval_csv(path)


def test_load_eval_csv_rejects_empty_file(tmp_path: Path) -> None:
    path = tmp_path / "empty.csv"
    path.write_text("description,category,subcategory\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="no data rows"):
        harness.load_eval_csv(path)


def test_load_eval_csv_loads_the_real_fixture() -> None:
    rows = harness.load_eval_csv(_REAL_CSV)
    assert len(rows) >= 250
    # Non-English descriptions are present (I1's non-Latin-script preservation, exercised here).
    assert any(any(ord(ch) > 0x2FFF for ch in row.description) for row in rows)


# --------------------------------------------------------------------------------------------
# run_eval(mode="rules")
# --------------------------------------------------------------------------------------------


def test_run_eval_rules_mode_makes_no_network_call(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def _fail(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("mode='rules' must never call litellm.completion")

    monkeypatch.setattr(egress.litellm, "completion", _fail)
    csv_path = _write_csv(
        tmp_path / "eval.csv",
        [
            ("STARBUCKS STORE #1234 SEATTLE WA", "restaurant", "dine_in"),
            ("NETFLIX.COM", "entertainment", "streaming"),
            ("MYSTERY MERCHANT XYZ", "grocery", "grocery_stores"),
        ],
    )
    report = harness.run_eval(
        _cfg(mode="none", provider="", model=""), csv_path=csv_path, mode="rules"
    )

    assert report.mode == "rules"
    assert report.total == 3
    assert report.llm_requests == 0
    assert report.cost_usd == 0.0
    # STARBUCKS and NETFLIX both hit a builtin rule; the "MYSTERY MERCHANT" row falls back to
    # others/uncategorized, which does not match its "grocery/grocery_stores" label.
    assert report.correct == 2
    assert report.accuracy == pytest.approx(2 / 3)
    fallback_row = next(r for r in report.misclassified if r.classified_by == "fallback")
    assert fallback_row.predicted_category == "others"
    assert fallback_row.predicted_subcategory == "uncategorized"


def test_run_eval_rules_mode_does_not_require_a_configured_provider(tmp_path: Path) -> None:
    csv_path = _write_csv(tmp_path / "eval.csv", [("STARBUCKS", "restaurant", "dine_in")])
    report = harness.run_eval(LLMConfig(mode="none"), csv_path=csv_path, mode="rules")
    assert report.total == 1
    assert report.correct == 1


def test_run_eval_perfect_score_confusion_matrix_is_diagonal(tmp_path: Path) -> None:
    csv_path = _write_csv(
        tmp_path / "eval.csv",
        [
            ("STARBUCKS #1", "restaurant", "dine_in"),
            ("STARBUCKS #2", "restaurant", "dine_in"),
            ("NETFLIX.COM", "entertainment", "streaming"),
        ],
    )
    report = harness.run_eval(LLMConfig(mode="none"), csv_path=csv_path, mode="rules")
    assert report.accuracy == 1.0
    assert report.category_accuracy == {"restaurant": 1.0, "entertainment": 1.0}
    assert report.confusion == {
        "restaurant": {"restaurant": 2},
        "entertainment": {"entertainment": 1},
    }
    assert report.misclassified == ()


# --------------------------------------------------------------------------------------------
# run_eval(mode="llm")
# --------------------------------------------------------------------------------------------


def test_run_eval_llm_mode_requires_a_configured_provider(tmp_path: Path) -> None:
    csv_path = _write_csv(tmp_path / "eval.csv", [("STARBUCKS", "restaurant", "dine_in")])
    with pytest.raises(ConfigError, match="requires a configured"):
        harness.run_eval(LLMConfig(mode="none"), csv_path=csv_path, mode="llm")


def test_run_eval_llm_mode_only_sends_rows_rules_left_unresolved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
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
                    "merchant_canonical": "Mystery Merchant",
                    "confidence": 0.9,
                    "is_online_store": False,
                }
            )
        )

    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(egress.litellm, "completion", _fake_completion)

    csv_path = _write_csv(
        tmp_path / "eval.csv",
        [
            ("STARBUCKS STORE #1234 SEATTLE WA", "restaurant", "dine_in"),  # resolved by rules
            ("MYSTERY MERCHANT XYZ", "grocery", "grocery_stores"),  # goes to the LLM
        ],
    )
    report = harness.run_eval(_cfg(), csv_path=csv_path, mode="llm")

    # Only the unresolved row's description was sent — the rules-resolved row never reaches
    # the LLM egress path at all.
    assert "MYSTERY MERCHANT XYZ" in captured["messages"][1]["content"]
    assert "STARBUCKS" not in captured["messages"][1]["content"]
    assert report.total == 2
    assert report.correct == 2
    assert report.llm_requests == 1
    assert not report.misclassified


def test_run_eval_llm_mode_falls_back_when_llm_returns_nothing_useful(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(egress.litellm, "supports_response_schema", lambda **_: True)
    monkeypatch.setattr(egress.litellm, "completion", lambda **_: _FakeResponse(_items_payload()))
    csv_path = _write_csv(
        tmp_path / "eval.csv", [("UNMATCHABLE MERCHANT NAME", "grocery", "grocery_stores")]
    )
    report = harness.run_eval(_cfg(), csv_path=csv_path, mode="llm")
    assert report.correct == 0
    assert report.misclassified[0].classified_by == "llm"
    assert report.misclassified[0].predicted_category == "others"
    assert report.misclassified[0].predicted_subcategory == "uncategorized"


# --------------------------------------------------------------------------------------------
# EvalReport rendering
# --------------------------------------------------------------------------------------------


def test_text_table_contains_accuracy_and_confusion(tmp_path: Path) -> None:
    csv_path = _write_csv(
        tmp_path / "eval.csv",
        [("STARBUCKS", "restaurant", "dine_in"), ("NETFLIX.COM", "entertainment", "streaming")],
    )
    report = harness.run_eval(LLMConfig(mode="none"), csv_path=csv_path, mode="rules")
    table = report.text_table()
    assert "Eval report (mode=rules): 2/2 correct" in table
    assert "Accuracy by category" in table
    assert "Confusion matrix" in table
    assert "restaurant" in table
    assert "entertainment" in table


def test_to_json_round_trips(tmp_path: Path) -> None:
    csv_path = _write_csv(
        tmp_path / "eval.csv", [("MYSTERY MERCHANT", "grocery", "grocery_stores")]
    )
    report = harness.run_eval(LLMConfig(mode="none"), csv_path=csv_path, mode="rules")
    data = json.loads(report.to_json())
    assert data["mode"] == "rules"
    assert data["total"] == 1
    assert data["correct"] == 0
    assert data["misclassified"][0]["expected_category"] == "grocery"
    assert data["misclassified"][0]["predicted_category"] == "others"
