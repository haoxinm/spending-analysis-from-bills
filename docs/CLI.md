# CLI reference

Every command reads/writes the local database at `$SPEND_ANALYZER_HOME` (see
[INSTALL.md](INSTALL.md#data-location)); none of them make a network call unless you've
configured a remote LLM provider and run `classify` or `doctor`.

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
future imports). Re-importing a byte-identical file is a no-op; an overlapping statement period
never creates duplicate transaction rows.

## `classify`

```console
$ spend-analyzer classify
  40/40 classified ($0.0000)
Classified 38 transaction(s); 2 need review; 1 LLM request(s); $0.0012 spent.
```

Runs the rules-first classification cascade over transactions that don't yet have a category.
Options: `--user-id` / `--all-users`, `--statement-id` (limit to one import). With
`[llm] mode = "none"` (the default) this never calls an LLM — everything it can't resolve locally
lands in the Review queue with `needs_review=true` instead.

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
SKIP  LLM connectivity (mode='none')
```

Diagnoses the local install: Python version, data directory permissions, migration state,
keychain/keyring access, and (only if an LLM provider is configured) connectivity. Exits non-zero
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
