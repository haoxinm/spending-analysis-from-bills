"""CI architecture guards (I2, I3, P0-1).

Walk the source tree with `ast` (not regex, so aliased and conditional imports are caught too)
to enforce two invariants that everything else in this codebase depends on:

- **I2**: exactly one module may `import litellm`: `classify/llm/egress.py`.
- **I3**: `ingest/` imports no HTTP client and makes no network call, ever.
"""

from __future__ import annotations

import ast
from pathlib import Path

_SRC_ROOT = Path(__file__).resolve().parent.parent / "src" / "spend_analyzer"

_HTTP_CLIENT_MODULES = {
    "httpx",
    "requests",
    "urllib3",
    "aiohttp",
    "http.client",
    "socket",
}


def _iter_py_files(root: Path) -> list[Path]:
    return sorted(root.rglob("*.py"))


def _imported_top_level_modules(tree: ast.AST) -> set[str]:
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module is not None and node.level == 0:
            modules.add(node.module.split(".")[0])
    return modules


def _full_imported_modules(tree: ast.AST) -> set[str]:
    """Like `_imported_top_level_modules` but keeps the full dotted path (e.g. 'http.client')."""
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module is not None and node.level == 0:
            modules.add(node.module)
    return modules


def test_only_egress_imports_litellm() -> None:
    offenders: list[str] = []
    for path in _iter_py_files(_SRC_ROOT):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        if "litellm" in _imported_top_level_modules(tree):
            rel = path.relative_to(_SRC_ROOT.parent.parent)
            offenders.append(str(rel))

    allowed = {"src/spend_analyzer/classify/llm/egress.py"}
    unexpected = set(offenders) - allowed
    assert not unexpected, f"litellm imported outside classify/llm/egress.py: {unexpected}"


def test_ingest_imports_no_http_client() -> None:
    ingest_root = _SRC_ROOT / "ingest"
    offenders: dict[str, set[str]] = {}
    for path in _iter_py_files(ingest_root):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        full_modules = _full_imported_modules(tree)
        top_modules = _imported_top_level_modules(tree)
        hits = {m for m in full_modules if m in _HTTP_CLIENT_MODULES} | (
            top_modules & _HTTP_CLIENT_MODULES
        )
        if hits:
            offenders[str(path.relative_to(_SRC_ROOT.parent.parent))] = hits

    assert not offenders, f"ingest/ imports a network-capable module: {offenders}"
