# CLI reference

Every command reads/writes the local database in the data directory (see
[INSTALL.md](INSTALL.md#data-location); override with `SPEND_ANALYZER_HOME`). None of them make a
network call unless you've enabled an LLM and run `classify`, `import` with the LLM extractor,
`doctor`, or `llm test`. Commands work the same on Windows, macOS and Linux.

Run `spend-analyzer --help` or `spend-analyzer <command> --help` at any time for the exact,
current option list — this page shows the common case for each command.

## `migrate`

```console
$ spend-analyzer migrate
Database migrated and taxonomy synced.
```

Creates or upgrades the local SQLite database to the latest schema, seeds/updates the taxonomy
from `taxonomy.yaml`, syncs the built-in rules corpus, and ensures a default user exists. Safe to
run repeatedly, and required after every upgrade.

## `serve`

```console
$ spend-analyzer serve
Spend Analyzer is running at http://127.0.0.1:8756/?token=<per-launch token>
```

Starts the local web server. Binds `127.0.0.1` only, mints a fresh random token for this one run,
and opens your browser to it automatically (`--no-open-browser` to skip that). See the
[privacy model](../README.md#privacy-model) for what the token and `Host` check protect against.

## `import`

```console
$ spend-analyzer import statement.pdf --user-id 1
```

Imports one or more statement PDFs (globs are expanded by your shell, not by this command).
Extracts text, proposes an issuer and parser, and — when the proposal is confident — parses and
persists the transactions in the same step. When it isn't confident, the statement is left
`awaiting_extractor` and the exact confirming command is printed:

```console
$ spend-analyzer import statement.pdf --user-id 1
statement.pdf: statement #7 awaiting_extractor (detect_score=0.4); confirm with:
  spend-analyzer import statement.pdf --user-id 1 --issuer-id 3 --parser-id layout_a_credit
```

Options: `--user-id`, `--issuer-id` / `--parser-id` / `--layout-spec-id` (pin the extractor
instead of accepting the proposal), `--remember` (make this the issuer's default extractor for
future imports), `--pages` (see below). Re-importing a byte-identical file is a no-op; an
overlapping statement period never creates duplicate transaction rows.

### Choosing pages and the LLM extractor

`--pages 1-3,5` keeps and parses only those pages (1-based; default: all). Template parsers see
only the selected pages too, so you can drop cover sheets, ads, or legal pages.

`--parser-id llm` parses the statement with the LLM configured via [`llm`](#llm) instead of a
template. It is opt-in per statement, needs an enabled LLM, and **sends the selected pages' text
to that endpoint** after redaction (card/account numbers masked to the last 4, emails replaced,
`[privacy] pii_terms` and user aliases removed; amounts and dates are kept). LLM imports are never
auto-confirmed — you choose the pages and confirm explicitly:

```console
$ spend-analyzer import odd-statement.pdf --user-id 1
odd-statement.pdf: statement #8 awaiting_extractor ...; confirm with:
  spend-analyzer import odd-statement.pdf --user-id 1 --parser-id llm --pages 1-4
$ spend-analyzer import odd-statement.pdf --user-id 1 --parser-id llm --pages 2-3
```

To see the exact text that would be sent first, use the Import screen's preview
(`GET /api/statements/{id}/llm-preview`). Set `spend-analyzer llm set --default-extractor llm` to
make the LLM the default for new imports.

## `classify`

```console
$ spend-analyzer classify
  40/40 classified ($0.0000)
Classified 38 transaction(s); 2 need review; 1 LLM request(s); $0.0012 spent.
```

Runs the rules-first classification cascade over transactions that don't yet have a category.
Options: `--user-id` / `--all-users`, `--statement-id` (limit to one import). With
the LLM disabled (`[llm] enabled = false`, the default) this never calls an LLM — everything it can't resolve locally
lands in the Review queue with `needs_review=true` instead.

## `llm`

Configures the one LLM endpoint used for classification and (opt-in, per statement) statement
parsing. Every subcommand edits `config.toml`, and **changes take effect immediately, even for a
running `spend-analyzer serve`** — the file is re-read on every request. The same settings are on
the web UI's Settings screen, and as `[llm]` in `config.toml` (README: [Using an LLM](../README.md#using-an-llm-local-or-remote)).

```console
$ spend-analyzer llm show
config file: /home/you/.local/share/spend-analyzer/config.toml
enabled: true
base_url: "http://localhost:11434"
api_format: "openai_chat"
...
mode: local
resolved_url: http://localhost:11434/v1/chat/completions
api key on file: no
[ingest] default_extractor: auto
```

`mode` is derived, not set: `none` (disabled or no base URL; the model is optional), `local` (`localhost`,
`127.0.0.1`, `::1`), or `remote` (anything else). `show` never prints the API key.

### `llm set`

Changes only the options you pass.

| Option | Meaning |
|---|---|
| `--preset NAME` | `ollama`, `lm-studio`, `openai`, `openai-responses`, `anthropic`, `openrouter`; fills in base URL and format (explicit options override) |
| `--base-url URL` | endpoint root, e.g. `http://localhost:11434` |
| `--format FMT` | `openai_chat` (`/v1/chat/completions`), `openai_responses` (`/v1/responses`), `anthropic_messages` (`/v1/messages`) |
| `--path PATH` | request path; `''` = the format's default |
| `--model NAME` | model id as the server knows it; optional for single-model local servers (llama.cpp, vLLM) — left blank, no `model` is sent — but required by OpenAI and Anthropic |
| `--temperature X` | float, or `none` to not send one |
| `--max-tokens N` | int, or `none` for the provider default |
| `--reasoning-effort E` | `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; `''` clears |
| `--extra-body JSON` | JSON object merged into every request body |
| `--extra-header KEY=VALUE` | repeatable; `--clear-extra-headers` removes all |
| `--structured-output` / `--no-structured-output` | ask for schema-constrained JSON (retried without it if the server rejects it) |
| `--batch-size N` | descriptions per classification request |
| `--timeout S` | request timeout in seconds |
| `--confidence-threshold X` | below this, a classification goes to Review |
| `--pages-per-request N` | statement parsing: pages per request (`0` = all selected pages at once) |
| `--enable` / `--disable` | turn the LLM on/off |
| `--default-extractor auto\|llm` | `[ingest] default_extractor` for new imports |

```console
# Local (nothing leaves this machine)
$ spend-analyzer llm set --preset ollama --model llama3.1 --enable
$ spend-analyzer llm set --preset lm-studio --model qwen2.5-7b-instruct --enable

# Remote
$ spend-analyzer llm set --preset openai --model gpt-4.1-mini --enable
$ spend-analyzer llm set-key
$ spend-analyzer llm set --preset anthropic --model claude-sonnet-4-5 --max-tokens 4096 --enable
$ spend-analyzer llm set-key

# Any OpenAI-compatible server (vLLM, llama.cpp, a gateway) with a custom path and extras
$ spend-analyzer llm set --base-url http://gpu-box:8000 --format openai_chat \
      --path /openai/v1/chat/completions --model my-model --temperature 0 \
      --reasoning-effort low --extra-body '{"top_p": 0.9}' --extra-header X-Team=finance --enable
```

### `llm enable` / `llm disable`

`enable` turns the LLM on (it needs a base URL — set it with `llm set`; a model is optional for single-model local servers); `disable`
turns it off. While it is off, nothing is ever sent anywhere.

### `llm set-key` / `llm clear-key`

```console
$ spend-analyzer llm set-key                       # hidden prompt, for the configured base URL
$ printf '%s' "$KEY" | spend-analyzer llm set-key  # or from stdin
$ spend-analyzer llm set-key --base-url https://api.openai.com
$ spend-analyzer llm clear-key
```

Stores/removes the API key in the OS credential store (macOS Keychain, Windows Credential Manager,
Linux Secret Service), **one key per host**, so a key saved for one endpoint is never sent to
another. Local servers usually need none. On a headless machine without a credential store, set
the `SPEND_ANALYZER_LLM_API_KEY` environment variable instead.

### `llm test`

```console
$ spend-analyzer llm test
OK  ...
```

Makes one real round trip to the configured endpoint; exit code 1 on failure (the message says why:
unreachable, 401, unknown model, wrong path/format, ...).

Environment overrides (take precedence over `config.toml`): `SPEND_ANALYZER_LLM__<FIELD>` (for
example `SPEND_ANALYZER_LLM__MODEL`), and `SPEND_ANALYZER_LLM_API_KEY`.

## `report`

```console
$ spend-analyzer report --from 2026-01-01 --to 2026-01-31
Period   Category       Currency  Total   Count  Avg
-------  -------------  --------  ------  -----  -----
2026-01  groceries      USD       412.33  14     29.45
2026-01  dining         USD       201.10  9      22.34
```

Prints monthly category totals for a date range. `--csv` prints machine-readable CSV instead of a
table; `--user-id` / `--all-users` and `--currency` (D5: aggregations never convert currency,
they filter to one) narrow the result.

## `export`

```console
$ spend-analyzer export --output transactions.csv
```

Exports transactions to CSV (default) or `--format json`, to a file or `-` for stdout.
**Never includes `accounts.mask`** (the last-4 account digits) — this is checked directly by
`tests/api/test_export.py`, not only by the response schema. `--user-id` / `--all-users` narrow
the export; with neither, everything is exported.

## `doctor`

```console
$ spend-analyzer doctor
PASS  Python version >= 3.12
PASS  Data directory (...) writable
PASS  Database migrated to head (0001_initial)
PASS  Keychain read/write
SKIP  LLM connectivity (disabled — run `spend-analyzer llm set ...` to configure)
```

Diagnoses the local install: Python version, data directory permissions, migration state,
credential-store access, and (only if an LLM is enabled) connectivity to it
(`PASS  LLM connectivity (...)` or `FAIL  LLM connectivity failed: ...`). Exits non-zero
on any `FAIL`.

## `eval`

Runs the classifier evaluation harness (precision/recall against a labelled CSV of
description → expected category) — used when tuning the built-in rules corpus, not day-to-day.

## `users`

```console
$ spend-analyzer users list
$ spend-analyzer users add "Alex"
$ spend-analyzer users set-default 2
```

Manage local users (D4: statements are imported against a user; the account itself is
auto-matched/auto-created). Most single-person installs never need this beyond the default user
`migrate` creates.

## `issuers`

```console
$ spend-analyzer issuers list
$ spend-analyzer issuers add "My Credit Union" --match-term "MY CREDIT UNION" --match-term "MYCU"
```

Manage issuers and their `match_terms` (§2f.4/§3.12a). Issuer names are **your own local data** —
none is hard-coded, none is ever sent anywhere (see [I1b](../README.md#privacy-model)) — adding
one before your first import from that bank lets later imports auto-confirm instead of asking.
