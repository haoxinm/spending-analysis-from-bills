# Spend Analyzer

Automatically parses credit/debit card bills and bank statements (native digital PDFs) and
classifies transactions into a fixed two-level taxonomy, entirely locally.

This is a stub README. The full user-facing documentation is written in Phase 4 (P4-E).

## Development

```sh
uv sync --extra dev
uv run spend-analyzer migrate
uv run pytest
```
