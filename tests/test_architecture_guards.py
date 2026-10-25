"""CI architecture guards (I2, I3, P0-1).

Walk the source tree with `ast` (not regex, so aliased and conditional imports are caught too)
to enforce two invariants that everything else in this codebase depends on:

- **I2**: exactly one module (`llm/client.py`) may import an HTTP client, and only the two egress
  seams (`classify/llm/egress.py`, `llm/statement_parser.py`) may import `llm.client`.
- no module imports `litellm` (replaced by the httpx client).
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
    "urllib.request",
}

_CLIENT = "src/spend_analyzer/llm/client.py"
_CLIENT_CALLERS = {
    "src/spend_analyzer/classify/llm/egress.py",
    "src/spend_analyzer/llm/statement_parser.py",
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


def _rel(path: Path) -> str:
    return path.relative_to(_SRC_ROOT.parent.parent).as_posix()


def _parse(path: Path) -> ast.AST:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _imports_http_client(tree: ast.AST) -> set[str]:
    full = _full_imported_modules(tree)
    return {m for m in full if m in _HTTP_CLIENT_MODULES} | (
        _imported_top_level_modules(tree) & _HTTP_CLIENT_MODULES
    )


def _imports_llm_client(tree: ast.AST) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(alias.name == "spend_analyzer.llm.client" for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module is not None:
            if node.module == "spend_analyzer.llm.client":
                return True
            if node.module == "spend_analyzer.llm" and any(
                alias.name == "client" for alias in node.names
            ):
                return True
    return False


def test_only_llm_client_imports_an_http_client() -> None:
    offenders: dict[str, set[str]] = {}
    for path in _iter_py_files(_SRC_ROOT):
        hits = _imports_http_client(_parse(path))
        if hits and _rel(path) != _CLIENT:
            offenders[_rel(path)] = hits
    assert not offenders, f"HTTP client imported outside {_CLIENT}: {offenders}"


def test_only_egress_seams_import_llm_client() -> None:
    offenders = [
        _rel(path)
        for path in _iter_py_files(_SRC_ROOT)
        if _imports_llm_client(_parse(path)) and _rel(path) not in _CLIENT_CALLERS
    ]
    assert not offenders, f"llm.client imported outside the egress seams: {offenders}"


def test_nothing_imports_litellm() -> None:
    offenders = [
        _rel(path)
        for path in _iter_py_files(_SRC_ROOT)
        if "litellm" in _imported_top_level_modules(_parse(path))
    ]
    assert not offenders, f"litellm is no longer a dependency: {offenders}"


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
