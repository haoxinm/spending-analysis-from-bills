"""Kind resolution — the cascade's first step (§2b P2-B, A26, A29).

A parser's `kind_hint` is the most reliable signal available (it comes from a statement's own
section headings), but two situations need help from this module, the single source of truth for
every pattern used to resolve a `Kind`:

- ``kind_hint == 'payment_or_refund'``: a heading like "PAYMENTS AND OTHER CREDITS" cannot tell a
  payment from a refund on its own (A29, `core/types.KindHint`). `resolve_kind` applies the
  payment pattern here: a match is a `payment`, anything else is a `refund`.
- ``kind_hint is None``: a parser with no section headings at all (the generic fallback parser,
  P1-B) leaves kind detection entirely to sign-plus-pattern rules, applied in the order the plan
  specifies: interest charge, then fee, then (for checking/savings accounts only) a card payment
  to a credit card — A26/I11, so that spend already counted on the card statement is never
  double-counted as a `purchase` on the checking side — then a generic transfer pattern, then a
  generic payment pattern, then the sign default (`purchase` for an outflow, `refund` for an
  inflow).

Every other `kind_hint` value is already a concrete `Kind` (e.g. Layout D resolves its own
card-payment rows to `transfer` at parse time, per §2c) and is returned unchanged.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from spend_analyzer.core.types import Kind, KindHint

#: A payment leaving through this description (§2b: "PAYMENT THANK YOU", "AUTOPAY", "ONLINE
#: PAYMENT - THANK YOU", "CARD AUTOPAY PAYMENT", ...). Used both to resolve the ambiguous
#: ``'payment_or_refund'`` hint and, when there is no hint at all, as a general payment pattern.
_PAYMENT_RE = re.compile(r"\b(PAYMENT|AUTOPAY|PMT)\b", re.IGNORECASE)

#: A card payment specifically — the same phrasing Layout D resolves itself (§2c), kept here so
#: the generic (hint-less) fallback path can apply the identical rule (A26).
_CARD_PAYMENT_RE = re.compile(
    r"\b(AUTOPAY|CRD\s*PMT|CREDIT\s*CARD\s*PAYMENT|EPAY|PAYMENT|PMT)\b", re.IGNORECASE
)

#: A bare "TRANSFER" (e.g. "ONLINE TRANSFER TO ...") when no parser hint is available.
_TRANSFER_RE = re.compile(r"\bTRANSFER\b", re.IGNORECASE)

#: "INTEREST CHARGE", "INTEREST CHARGED", etc.
_INTEREST_RE = re.compile(r"\bINTEREST\b", re.IGNORECASE)

#: "ANNUAL MEMBERSHIP FEE", "LATE FEE", "SERVICE FEE", ...
_FEE_RE = re.compile(r"\bFEE\b", re.IGNORECASE)

#: How close a configured issuer's `match_terms` occurrence must be to a PAYMENT/PMT token to
#: count as "next to" it (A26): within this many characters, either order.
#:
#: Note: `_CARD_PAYMENT_RE` above already includes bare "PAYMENT"/"PMT", so with its current word
#: list every description this check would catch already matches `_CARD_PAYMENT_RE` on its own.
#: This check is kept anyway for A26's literal wording, and to keep working correctly if that
#: word list is ever narrowed to require a more specific phrase.
_ISSUER_PAYMENT_PROXIMITY_CHARS = 20

_PAYMENT_TOKEN_RE = re.compile(r"\b(?:PAYMENT|PMT)\b", re.IGNORECASE)


def resolve_kind(
    *,
    kind_hint: KindHint | None,
    description_clean: str,
    amount_minor: int,
    account_type: str,
    issuer_match_terms: Sequence[str] = (),
) -> Kind:
    """Resolve the final `Kind` for one transaction (cascade step 1).

    Args:
        kind_hint: the parser's own hint, if any (`RawTransaction.kind_hint`). `None` means the
            parser (typically the generic fallback) could not tell.
        description_clean: the normalized, egress-safe description (`ingest.normalize`). Never
            sent anywhere by this function; used only for local pattern matching.
        amount_minor: the transaction's signed amount (I5: positive = outflow). Only consulted
            when no hint and no pattern resolves the kind.
        account_type: the owning account's type (``credit`` | ``checking`` | ``savings``). Card
            payments only ever count as `transfer` on a checking/savings account (A26) — on a
            credit account the identical wording is the *card's own* payment-received row, which
            reaches this function via the ambiguous hint path, not this one.
        issuer_match_terms: local-only (I1b) `match_terms` of every configured issuer, consulted
            only for a checking/savings account, to catch a card payment described with the
            issuer's own name next to "PAYMENT"/"PMT" instead of a generic card-payment word
            (A26). Never egressed by this or any caller.

    Returns:
        The resolved `Kind`. Never raises.
    """
    if kind_hint is not None:
        if kind_hint == "payment_or_refund":
            return "payment" if _PAYMENT_RE.search(description_clean) else "refund"
        return kind_hint

    if account_type in ("checking", "savings") and (
        _CARD_PAYMENT_RE.search(description_clean)
        or _issuer_payment_match(description_clean, issuer_match_terms)
    ):
        return "transfer"
    if _INTEREST_RE.search(description_clean):
        return "interest"
    if _FEE_RE.search(description_clean):
        return "fee"
    if _TRANSFER_RE.search(description_clean):
        return "transfer"
    if _PAYMENT_RE.search(description_clean):
        return "payment"
    return "purchase" if amount_minor >= 0 else "refund"


def is_spend(kind: Kind) -> bool:
    """`transactions.is_spend` (§3.2): true for `purchase`, `fee`, and `interest` only."""
    return kind in ("purchase", "fee", "interest")


def _issuer_payment_match(description: str, issuer_match_terms: Sequence[str]) -> bool:
    """True if any `issuer_match_terms` entry appears within
    `_ISSUER_PAYMENT_PROXIMITY_CHARS` characters of a PAYMENT/PMT token in `description`
    (A26: "PAYMENT"/"PMT" next to any configured issuer's `match_terms`)."""
    if not issuer_match_terms:
        return False
    payment_positions = [m.start() for m in _PAYMENT_TOKEN_RE.finditer(description)]
    if not payment_positions:
        return False
    for term in issuer_match_terms:
        term = term.strip()
        if not term:
            continue
        for m in re.finditer(re.escape(term), description, re.IGNORECASE):
            if any(
                abs(m.start() - p) <= _ISSUER_PAYMENT_PROXIMITY_CHARS for p in payment_positions
            ):
                return True
    return False
