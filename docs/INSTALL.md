# Installing Spend Analyzer

Spend Analyzer is a single local program: one `spend-analyzer` command that manages a SQLite
database on your machine and serves a web UI on `127.0.0.1`. There is no server to run elsewhere,
no account to create, and no data leaves your machine except the specific text you explicitly send
to an LLM provider for classification (see [Privacy](#privacy), below).

## Requirements

- **Python 3.12** (3.13 is not yet supported; the package pins `>=3.12,<3.13`).
- **macOS or Linux.** The data directory defaults to macOS's `~/Library/Application Support/`; on
  Linux (or in CI), set `SPEND_ANALYZER_HOME` to a directory you control (see
  [Data location](#data-location)).
- macOS Keychain (used automatically for storing an LLM API key) or, on Linux, any
  [`keyring`](https://pypi.org/project/keyring/)-compatible secret service (e.g. `gnome-keyring`,
  KWallet, or the `keyrings.alt` package for a plain encrypted file when no OS keychain is
  available). Only needed if you configure a remote LLM provider — the default `[llm] mode =
  "none"` needs no secret store at all.
- No Node.js/npm needed to *install* — the published wheel already contains the built web UI.
  Node is only needed to build the package from source (see
  [Building from source](#building-from-source)).

## Install

### Option A — `pipx` (recommended)

[`pipx`](https://pipx.pypa.io/) installs the command into its own isolated environment and puts
`spend-analyzer` on your `PATH`, without touching any other Python project's dependencies.

```console
$ pipx install spend-analyzer
```

Or, from a downloaded wheel (e.g. attached to a
[GitHub Release](https://github.com/)) rather than an index:

```console
$ pipx install ./spend_analyzer-1.0.0-py3-none-any.whl
```

### Option B — `pip` into a virtual environment

```console
$ python3.12 -m venv .venv-spend-analyzer
$ .venv-spend-analyzer/bin/pip install spend-analyzer
$ .venv-spend-analyzer/bin/spend-analyzer --help
```

(On Windows, activate with `.venv-spend-analyzer\Scripts\activate` first; Spend Analyzer itself
targets macOS/Linux, matching its Keychain-backed secret storage.)

## First run

```console
$ spend-analyzer migrate
Database migrated and taxonomy synced.

$ spend-analyzer doctor
PASS  Python version >= 3.12
PASS  Data directory (/Users/you/Library/Application Support/SpendAnalyzer) writable
PASS  Database migrated to head (0001_initial)
PASS  Keychain read/write
SKIP  LLM connectivity (mode='none')

$ spend-analyzer serve
Spend Analyzer is running at http://127.0.0.1:8756/?token=<per-launch token>
Per-launch API token: <per-launch token>
```

`serve` opens your default browser to that URL automatically (pass `--no-open-browser` to skip
that). The URL and the printed token are only valid for this one running process — every launch of
`serve` mints a fresh token (`I8`/`A31`), and the server refuses any `/api` request that doesn't
carry it (as the `token` query parameter for the page load, or an `X-Spend-Token` header for API
calls) or whose `Host` header isn't `127.0.0.1`/`localhost`. It never binds to any interface other
than `127.0.0.1`, so nothing on your network — let alone the internet — can reach it.

If `doctor` reports a `FAIL`, fix that before continuing — it means a real problem: an
unwritable data directory, a database that failed to migrate, a broken Keychain/keyring backend,
or (only if you've configured a remote LLM) a provider your machine can't reach.

From there:

```console
$ spend-analyzer import ~/Downloads/january-statement.pdf
$ spend-analyzer classify
$ spend-analyzer report --from 2026-01-01 --to 2026-01-31
```

or do the same from the web UI the browser just opened.

## Data location

| OS | Default location |
|---|---|
| macOS | `~/Library/Application Support/SpendAnalyzer/` |
| Linux / other | set `SPEND_ANALYZER_HOME` yourself — there is no built-in default |

Inside: `spend.db` (SQLite, WAL mode), `statements/<sha256>.pdf` (a copy of each imported PDF,
unless you set `[privacy] store_pdf_copies = false` in `config.toml`), `config.toml`, and
`logs/app.log`. Nothing here is ever uploaded anywhere by Spend Analyzer itself — there is no
telemetry, no analytics, and no update check.

Override the location for a second profile, a test, or a non-macOS machine:

```console
$ SPEND_ANALYZER_HOME=/path/to/a/directory spend-analyzer serve
```

## Privacy

This is the whole reason to run this instead of a hosted budgeting app: your statements, your
transaction descriptions, and your spending never leave your machine, with one narrow, optional
exception. If you configure a remote LLM provider (`spend-analyzer` asks for this in Settings, or
you set `[llm] mode = "remote"` in `config.toml`), the *only* thing ever sent to it is the
normalized, redacted merchant description of a transaction your local rules couldn't already
classify — never a raw statement line, a date, an amount, an account number, an issuer name, or
anything else. See the running app's Settings screen for a live preview of exactly what a call
would send before any data is sent. Set `[llm] mode = "none"` (the default) to never call an LLM
at all; the local rules engine still classifies most transactions.

## Upgrading

```console
$ pipx upgrade spend-analyzer      # or: pip install --upgrade spend-analyzer
$ spend-analyzer migrate           # re-run after every upgrade — brings the DB schema
                                    # and taxonomy up to date; safe to run when already current
```

## Uninstalling

```console
$ pipx uninstall spend-analyzer    # or: pip uninstall spend-analyzer
```

This removes the program only. Your data directory (see [above](#data-location)) is left in
place; delete it yourself if you want to remove your statements and database too.

## Troubleshooting

Run `spend-analyzer doctor` first — it checks the Python version, data directory permissions,
database migration state, Keychain/keyring access, and (if configured) LLM connectivity, and
prints one `PASS`/`FAIL` line per check.

- **`FAIL  Keychain access failed: ...`** — on Linux without a running secret service, install one
  (`gnome-keyring`, or `pip install keyrings.alt` for a plain, less-secure fallback keyring) and
  ensure a keyring backend is registered. This only matters if you plan to use a remote LLM
  provider (`[llm] mode = "none"`, the default, needs no secret storage).
- **Browser shows a blank page / 404 for `/assets/...`** — the wheel you installed is missing the
  built web UI. This should never happen from a published release, but if you built the wheel
  yourself, see [Building from source](#building-from-source): the frontend build step must
  succeed and populate `src/spend_analyzer/web/` before packaging.
- **Port already in use** — another process (or a previous, still-running `spend-analyzer serve`)
  is using the configured port (default `8756`). Stop it, or set `[server] port = <other port>` in
  `config.toml`.
- **`spend-analyzer: command not found`** — the install didn't put its `bin`/`Scripts` directory on
  your `PATH`. `pipx` normally handles this for you (`pipx ensurepath`, then open a new shell); for
  a plain `pip install` into a virtualenv, activate that virtualenv or invoke the binary from its
  `bin/` (or `Scripts/`, on Windows) directory directly.

## Building from source

Building the wheel yourself (rather than installing a published release) additionally requires
**Node.js 22+ and npm** on `PATH`, because a `hatchling` build hook (`hatch_build.py`) runs the
frontend's own production build (`frontend/`'s `vite build`) and bundles its output into
`src/spend_analyzer/web/` before the wheel is packaged — that is what makes the installed wheel a
single self-contained program with no separate frontend build step for the person installing it.

```console
$ git clone <this repository>
$ cd spending-analysis-from-bills
$ uv build                 # writes dist/*.whl and dist/*.tar.gz
$ pip install dist/*.whl   # or: pipx install dist/*.whl
```

An editable/development install (`uv sync`, `pip install -e .`) skips the frontend build entirely
(so day-to-day Python development needs no Node.js at all) and serves the API standalone; point
`frontend`'s own dev server at it instead (`cd frontend && npm run dev`) to work on the UI. Set
`SPEND_ANALYZER_SKIP_FRONTEND_BUILD=1` to build a wheel deliberately without the UI (e.g. an API-
only environment); `spend-analyzer serve` still runs, it just won't have a page to serve at `/`.
