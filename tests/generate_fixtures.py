"""Fixture-generation discovery runner (P0-7).

Discovers every `LayoutBuilder`-shaped object exported by a module in `tests/fixtures/gen/`
(excluding `base.py`) and calls its `.build()` for each declared variant, writing a PDF to
``tests/fixtures/generated/<layout_id>/<layout_id>_<variant>.pdf`` and the expected
`ParsedStatement` golden next to it as matching ``.json``.

There is deliberately no shared registry file to edit: a parser work package adds its own module
under `tests/fixtures/gen/` and this runner finds it by discovery — which is what keeps the four
layout-parser WPs and the generic-parser WP conflict-free on this file.

Run as a script: ``uv run python tests/generate_fixtures.py``.
"""

from __future__ import annotations

import importlib
import json
import pkgutil
import sys
from pathlib import Path
from typing import Any

_EXCLUDED_MODULES = {"base"}


def _discover_builders() -> list[Any]:
    import tests.fixtures.gen as gen_pkg

    builders: list[Any] = []
    for module_info in pkgutil.iter_modules(gen_pkg.__path__, prefix=f"{gen_pkg.__name__}."):
        module_name = module_info.name.rsplit(".", 1)[-1]
        if module_name in _EXCLUDED_MODULES:
            continue
        module = importlib.import_module(module_info.name)
        for attr_name in dir(module):
            if attr_name.startswith("_"):
                continue
            obj = getattr(module, attr_name)
            if _looks_like_builder(obj):
                builders.append(obj)
    return builders


def _looks_like_builder(obj: object) -> bool:
    return (
        not isinstance(obj, type)
        and hasattr(obj, "layout_id")
        and hasattr(obj, "variants")
        and callable(getattr(obj, "build", None))
    )


def generate_all(out_root: Path) -> list[Path]:
    """Generate every discovered builder's every variant under ``out_root/<layout_id>/``, writing
    each golden next to its PDF. Returns the list of PDF paths written."""
    written: list[Path] = []
    for builder in _discover_builders():
        layout_dir = out_root / builder.layout_id
        for variant in builder.variants:
            golden = builder.build(layout_dir, variant=variant, seed=0)
            pdf_path = layout_dir / f"{builder.layout_id}_{variant}.pdf"
            golden_path = layout_dir / f"{builder.layout_id}_{variant}.json"
            golden_path.write_text(json.dumps(golden, indent=2, sort_keys=True, default=str))
            written.append(pdf_path)
    return written


def main() -> int:
    out_root = Path(__file__).resolve().parent / "fixtures" / "generated"
    for path in generate_all(out_root):
        print(f"generated {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
