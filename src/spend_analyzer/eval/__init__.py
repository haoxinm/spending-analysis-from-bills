"""Classifier eval harness (P4-C). See `spend_analyzer.eval.harness` for the public surface."""

from __future__ import annotations

from spend_analyzer.eval.harness import EvalMode, EvalReport, EvalRow, MisclassifiedRow, run_eval

__all__ = ["EvalMode", "EvalReport", "EvalRow", "MisclassifiedRow", "run_eval"]
