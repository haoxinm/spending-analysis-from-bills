#!/usr/bin/env python3
"""Pre-commit hook: reject any PDF outside tests/fixtures/generated/, and reject
filenames that look like a real bank/card statement (to keep real financial
documents out of the repository; see IMPLEMENTATION_PLAN.md §0.4, §6.4)."""

from __future__ import annotations

import re
import sys

ALLOWED_PDF_PREFIX = "tests/fixtures/generated/"

STATEMENT_NAME_RE = re.compile(
    r"(?i)(^|[/_\-\s])(statement|estatement|billing|e-?bill)([/_\-\s.]|$)"
)


def is_offending(path: str) -> str | None:
    if path.lower().endswith(".pdf") and not path.startswith(ALLOWED_PDF_PREFIX):
        return f"{path}: .pdf files are only allowed under {ALLOWED_PDF_PREFIX}"
    if STATEMENT_NAME_RE.search(path):
        return f"{path}: filename looks like a real bank/card statement"
    return None


def main(argv: list[str]) -> int:
    problems = [msg for path in argv if (msg := is_offending(path))]
    for msg in problems:
        print(f"check_no_statements: {msg}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
