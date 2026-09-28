# Spend Analyzer

Spend Analyzer turns your credit-card, debit-card, and bank-statement PDFs into a searchable,
categorized spending history — entirely on your own machine. There is no account, no hosted
service, and no server to trust with your statements.

```console
$ pipx install spend-analyzer
$ spend-analyzer migrate
$ spend-analyzer import ~/Downloads/january-statement.pdf
$ spend-analyzer classify
$ spend-analyzer report --from 2026-01-01 --to 2026-01-31
$ spend-analyzer serve       # opens the local web UI
```

## Privacy model

This is the reason to run this instead of a hosted budgeting app, so it comes first.

- **Everything runs locally.** PDF extraction, parsing, deduplication, the rules engine, the
  database, and the web UI all run as one program on your machine. Nothing is uploaded anywhere,
  ever, by Spend Analyzer itself — there is no telemetry, no analytics, and no update check.
- **The default mode calls no LLM at all** (`[llm] mode = "none"`). The local rules cascade
  classifies most transactions on its own; anything it can't classify lands in a Review queue for
  you, not an API call.
- **The only thing that can ever leave your machine — and only if you turn it on** — is the
  normalized, redacted merchant description of a transaction the local rules couldn't already
  classify (e.g. `AMZN MKTP US*1A2B3` → `amazon`), sent as plain CSV text to the LLM provider you
  configure. Never sent, under any circumstance, to any provider, local or remote: raw statement
  text, dates, amounts, account numbers, issuer/bank names, or your issuer's own category codes.
  This is enforced at a single code seam (`classify/llm/egress.py`) that is the only module in the
  codebase allowed to talk to an LLM, checked by CI on every change.
- **Egress preview.** Before any classification run that uses an LLM, the web UI's Review screen
  (via `GET /api/classify/preview`) shows you the exact CSV payload that call would send — the
  same bytes, not a mockup, built and validated by the same `classify/llm/egress.py` code path
  the real call uses — so you can see precisely what leaves your machine before it does.
- **Secrets** (an LLM API key) live only in your OS keychain — never in the database, the config
  file, or a log line.
- **The local web server** binds `127.0.0.1` only, checks every request's `Host` header, and
  requires a random token minted fresh on every launch — so nothing else on your machine's network,
  let alone the internet, can reach it, and a malicious web page open in your browser can't either.

See [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) for the full, code-verified security
checklist, and [SECURITY.md](SECURITY.md) for the threat model and how to report a vulnerability.

## Quick start

```console
$ pipx install spend-analyzer          # or: pip install spend-analyzer
$ spend-analyzer migrate               # create/upgrade the local database, sync the taxonomy
$ spend-analyzer import statement.pdf  # extract + propose an issuer/parser; confirms automatically
                                        # when confident, otherwise prints the confirm command
$ spend-analyzer classify               # run the rules-first cascade over new transactions
$ spend-analyzer report --from 2026-01-01 --to 2026-01-31
$ spend-analyzer serve                 # local web UI at http://127.0.0.1:<port>/?token=<token>
```

See [docs/INSTALL.md](docs/INSTALL.md) for requirements, upgrading, uninstalling, and
troubleshooting, and [docs/CLI.md](docs/CLI.md) for the full command reference.

## What it does

- **Imports native digital PDF statements** (not scanned/OCR) from credit cards, debit cards, and
  bank accounts, extracting one row per transaction with a signed amount in cents, a posted date,
  and a normalized merchant description.
- **Classifies every transaction** into a fixed two-level category/subcategory taxonomy via a
  rules-first cascade: kind detection → your own rules → your past corrections (which always win)
  → ~120 built-in high-precision rules → the issuer's own category column, where the statement
  prints one → a cache of past classifications → an LLM, only for what nothing local could resolve
  → an `others/uncategorized` fallback that still needs your review.
- **Reconciles every import** against the statement's own printed totals (section subtotals,
  running balance, or the opening/closing balance equation, whichever the layout provides), and
  banners a warning rather than silently accepting numbers that don't add up.
- **Never double-counts a card payment.** A payment to a credit card from a tracked checking
  account is classified as a transfer on both sides, not as spend — the purchase was already
  counted on the card statement.
- **Serves a local web UI and a CLI** for reviewing transactions, correcting categories, mapping an
  unrecognized layout by hand, and charting spending by category over time — plus a `report`
  command for the same numbers in a terminal.
- **Deduplicates on import.** Re-importing the same PDF is a no-op; importing an overlapping
  statement period never creates duplicate rows.

## Supported statement layouts

Four built-in layouts, identified by structure (never by bank name — which bank issued a statement
is separate, user-editable data):

| Layout | Shape | Typical source |
|---|---|---|
| **A** — `layout_a_credit` | Sectioned, dual-date (transaction date + posting date), per-section totals | Credit card |
| **B** — `layout_b_credit` | Two tables — an activity table plus a separate, non-transactional interest-charged table | Credit card |
| **C** — `layout_c_credit` | Repeating column-header rows double as section delimiters, no explicit section headings | Credit card |
| **D** — `layout_d_bank` | Separate debit/credit columns, a running balance on every row | Bank statement; also most **debit-card** activity |

**Debit cards have no dedicated layout.** Debit-card activity is either a bank statement (Layout D,
or the generic parser's debit/credit-column mode) or a card-style statement with signed amounts
(Layouts A–C, or the generic parser's signed-amount mode) — see D11 in the design record.

**Anything else** goes through the **generic fallback parser**, and if that isn't confident either,
an **unknown-layout funnel**: a correctable preview table, then a point-and-click column mapper
that produces a reusable, versioned **layout spec** (plain YAML, no code, no LLM) saved locally and
tried automatically on the account's next statement. See [docs/LAYOUTS.md](docs/LAYOUTS.md) for
the full per-layout specification and how to write one by hand.

## CLI reference

```
spend-analyzer migrate              create/upgrade the DB, sync the taxonomy and builtin rules
spend-analyzer serve                start the local web server (binds 127.0.0.1, per-launch token)
spend-analyzer import <pdf>...      import one or more statement PDFs
spend-analyzer classify             run the classification cascade over unclassified transactions
spend-analyzer report               print monthly category totals for a date range
spend-analyzer export               export transactions to CSV/JSON (never includes account masks)
spend-analyzer doctor               diagnose the local install: Python, data dir, DB, keychain, LLM
spend-analyzer eval                 run the classifier evaluation harness against a labelled CSV
spend-analyzer users                manage local users (list / add / set-default)
spend-analyzer issuers              manage issuers (list / add), so later imports auto-confirm
```

Run `spend-analyzer --help` or `spend-analyzer <command> --help` for full options; see
[docs/CLI.md](docs/CLI.md) for a worked example of each command.

## Documentation

- [docs/INSTALL.md](docs/INSTALL.md) — installing, upgrading, uninstalling, troubleshooting
- [docs/CLI.md](docs/CLI.md) — full CLI command reference
- [docs/LAYOUTS.md](docs/LAYOUTS.md) — the four built-in layout specifications and how to add one
- [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) — the security checklist, re-verified against
  the shipped code
- [SECURITY.md](SECURITY.md) — threat model and vulnerability reporting
- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, checks, and how to add a parser

## License

MIT — see [LICENSE](LICENSE).
