# Security policy

## Threat model summary

Spend Analyzer is a single-user, single-machine program: one local process, one local SQLite
database, one local web server. There is no multi-tenant deployment, no authentication beyond
"whoever can reach `127.0.0.1` on this machine," and no server component running anywhere but the
user's own computer (see the non-goals in the design record — hosted/multi-tenant deployment and
authentication are explicitly out of scope for v1).

Given that, the threats this project actually defends against are:

1. **A malicious or compromised web page open in the user's browser reaching the local API.**
   Binding `127.0.0.1` alone does not stop this — DNS rebinding lets a page's script address
   `127.0.0.1` directly once resolved, and a same-origin-looking `<form>` POST needs no CORS
   preflight. Mitigated by a `Host` header allowlist and a per-launch random token required on
   every `/api` request (`src/spend_analyzer/api/security.py`).
2. **A transaction description leaking more than intended to an LLM provider.** The core promise
   of this product is that statements, dates, amounts, account numbers, and issuer names never
   leave the machine. Mitigated by funneling every LLM call through one audited module
   (`classify/llm/egress.py`), a `FORBIDDEN`-pattern guard that raises rather than sanitizes, and a
   CI-enforced grep that no local-only field name appears anywhere in that module tree.
3. **A malicious PDF or a malicious layout spec.** An uploaded statement is untrusted input
   (size-capped, magic-byte checked, never trusted for its filename); a layout spec — even a
   user-approved one — is untrusted input too (validated against a JSON Schema, every regex
   length-capped and screened for catastrophic backtracking before it is ever executed).
4. **A secret (an LLM API key) ending up somewhere it shouldn't.** Mitigated by storing it only in
   the OS keychain, never in the database or `config.toml`, and by a defensive log filter that
   redacts anything key-shaped even if it reached a log call by some other path.

**Out of scope / accepted risk for v1** (see the design record's non-goals): database encryption
at rest (the project relies on OS-level disk encryption, e.g. macOS FileVault); multi-user
authentication (there is none — this is a single-user local tool); protecting against an attacker
who already has full access to the user's own account on the machine running it.

See [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) for the itemized checklist this threat
model is verified against, re-checked against the shipped code rather than the design document.

## Supported versions

This project ships from a single, continuously-updated main line. Security fixes land on the
latest release; there is no separate long-term-support branch.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for a security problem. Instead, open a
[private security advisory](../../security/advisories/new) on this repository (GitHub's
"Report a vulnerability" flow), or email the maintainer listed in the repository's contact
information, with:

- A description of the issue and its impact (in particular, whether it could cause a local-only
  field to leave the machine, or let something other than the user reach the local server).
- Steps to reproduce, or a minimal proof of concept.
- The version/commit you tested against.

Please allow a reasonable time for a fix before any public disclosure. There is no bug-bounty
program; reports are still very much welcome and will be credited in the fix's release notes
unless you ask otherwise.
