# Contributing

This is a stub. Contribution guidelines are written in full in Phase 4 (P4-E).

For now:

- Install dependencies with `uv sync --extra dev`.
- Run `uv run pytest`, `uv run ruff check`, `uv run ruff format --check`, and
  `uv run mypy --strict src` before submitting a change.
- Never commit a real bank/card statement, a `.db` file, or a secret.
