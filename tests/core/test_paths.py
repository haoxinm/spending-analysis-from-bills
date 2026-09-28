from __future__ import annotations

import stat
from pathlib import Path

from spend_analyzer.core import paths


def test_get_home_honors_env_override(home: Path) -> None:
    assert paths.get_home() == home


def test_ensure_home_creates_subdirs_with_0700(home: Path) -> None:
    result = paths.ensure_home()
    assert result == home
    for name in ("statements", "extract_cache", "specs", "logs"):
        sub = home / name
        assert sub.is_dir()
        mode = stat.S_IMODE(sub.stat().st_mode)
        assert mode == stat.S_IRWXU


def test_derived_paths_live_under_home(home: Path) -> None:
    assert paths.db_path() == home / "spend.db"
    assert paths.config_path() == home / "config.toml"
    assert paths.statements_dir() == home / "statements"
    assert paths.extract_cache_dir() == home / "extract_cache"
    assert paths.specs_dir() == home / "specs"
    assert paths.logs_dir() == home / "logs"
