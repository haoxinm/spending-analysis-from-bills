"""Tax parser tests run `extract()` against an isolated data home (never the user's real one)."""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _isolated_home(home: Path) -> Path:
    return home
