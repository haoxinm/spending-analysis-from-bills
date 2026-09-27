"""Data directory locations (§3.11).

All application state lives under one data directory: the SQLite database, statement PDF copies,
the extract-only-if-enabled debug cache, layout-spec YAML mirrors, `config.toml`, and log files.

The default location is the macOS Application Support directory. Set `SPEND_ANALYZER_HOME` to
override it — every test in this repository does, so CI (which runs on Linux) never touches a
real user's Application Support directory.
"""

from __future__ import annotations

import contextlib
import os
import stat
from pathlib import Path

#: Environment variable that overrides the default data directory. Read fresh on every call so
#: tests can change it mid-process via `monkeypatch.setenv`.
SPEND_ANALYZER_HOME_ENV = "SPEND_ANALYZER_HOME"

_DEFAULT_HOME = Path.home() / "Library" / "Application Support" / "SpendAnalyzer"

#: Directories created (mode 0700) inside the data home.
_SUBDIRS = ("statements", "extract_cache", "specs", "logs")


def get_home() -> Path:
    """Return the data directory, honoring `SPEND_ANALYZER_HOME`. Does not create it."""
    override = os.environ.get(SPEND_ANALYZER_HOME_ENV)
    return Path(override).expanduser() if override else _DEFAULT_HOME


def ensure_home() -> Path:
    """Return the data directory, creating it and its standard subdirectories (mode 0700) if
    absent. Safe to call repeatedly."""
    home = get_home()
    _mkdir_0700(home)
    for name in _SUBDIRS:
        _mkdir_0700(home / name)
    return home


def _mkdir_0700(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    # Some filesystems (e.g. certain CI/container mounts) don't support chmod; the directory
    # still exists and works, just without the permission tightening.
    with contextlib.suppress(OSError):
        path.chmod(stat.S_IRWXU)  # 0o700: owner rwx only


def db_path() -> Path:
    return get_home() / "spend.db"


def config_path() -> Path:
    return get_home() / "config.toml"


def statements_dir() -> Path:
    return get_home() / "statements"


def extract_cache_dir() -> Path:
    return get_home() / "extract_cache"


def specs_dir() -> Path:
    return get_home() / "specs"


def logs_dir() -> Path:
    return get_home() / "logs"
