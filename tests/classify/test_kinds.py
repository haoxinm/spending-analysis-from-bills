"""Tests for `classify/kinds.py` (§2b P2-B, A26, A29)."""

from __future__ import annotations

from spend_analyzer.classify import kinds
from spend_analyzer.classify.kinds import is_spend, resolve_kind


def test_payment_or_refund_hint_resolves_payment_pattern_to_payment() -> None:
    assert (
        resolve_kind(
            kind_hint="payment_or_refund",
            description_clean="ONLINE PAYMENT - THANK YOU",
            amount_minor=-50000,
            account_type="credit",
        )
        == "payment"
    )


def test_payment_or_refund_hint_resolves_non_payment_to_refund() -> None:
    assert (
        resolve_kind(
            kind_hint="payment_or_refund",
            description_clean="MERCHANDISE REFUND STORE X",
            amount_minor=-1500,
            account_type="credit",
        )
        == "refund"
    )


def test_concrete_kind_hint_is_returned_unchanged() -> None:
    for kind in ("purchase", "refund", "payment", "transfer", "fee", "interest", "adjustment"):
        assert (
            resolve_kind(
                kind_hint=kind,
                description_clean="ANYTHING AT ALL",
                amount_minor=100,
                account_type="checking",
            )
            == kind
        )


def test_no_hint_checking_card_payment_pattern_is_transfer() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="CARD AUTOPAY PAYMENT",
            amount_minor=20000,
            account_type="checking",
        )
        == "transfer"
    )


def test_no_hint_credit_account_same_wording_is_not_forced_to_transfer() -> None:
    # A26: the card-payment-to-transfer rule only applies to checking/savings accounts; on the
    # credit side, the same wording without a hint falls through to the generic payment pattern.
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="CARD AUTOPAY PAYMENT",
            amount_minor=-20000,
            account_type="credit",
        )
        == "payment"
    )


def test_no_hint_checking_issuer_match_term_next_to_payment_is_transfer() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="ACME BANK PAYMENT REF 998877",
            amount_minor=15000,
            account_type="checking",
            issuer_match_terms=("Acme Bank",),
        )
        == "transfer"
    )


def test_no_hint_checking_issuer_term_far_from_payment_does_not_match() -> None:
    # "Acme Bank" appears, but nowhere near a PAYMENT/PMT token: this is not a card payment.
    long_gap = "ACME BANK " + ("X" * 40) + " PURCHASE"
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean=long_gap,
            amount_minor=500,
            account_type="checking",
            issuer_match_terms=("Acme Bank",),
        )
        == "purchase"
    )


def test_no_hint_interest_pattern() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="INTEREST CHARGE ON PURCHASES",
            amount_minor=299,
            account_type="credit",
        )
        == "interest"
    )


def test_no_hint_fee_pattern() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="ANNUAL MEMBERSHIP FEE",
            amount_minor=9500,
            account_type="credit",
        )
        == "fee"
    )


def test_no_hint_transfer_pattern() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="ONLINE TRANSFER TO SAVINGS",
            amount_minor=10000,
            account_type="checking",
        )
        == "transfer"
    )


def test_no_hint_payment_pattern() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="PAYMENT THANK YOU",
            amount_minor=-1500,
            account_type="credit",
        )
        == "payment"
    )


def test_no_hint_default_sign_purchase_for_outflow() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="GROCERY STORE",
            amount_minor=4599,
            account_type="credit",
        )
        == "purchase"
    )


def test_no_hint_default_sign_refund_for_inflow() -> None:
    assert (
        resolve_kind(
            kind_hint=None,
            description_clean="GROCERY STORE",
            amount_minor=-4599,
            account_type="credit",
        )
        == "refund"
    )


def test_is_spend() -> None:
    assert is_spend("purchase")
    assert is_spend("fee")
    assert is_spend("interest")
    for kind in ("refund", "payment", "transfer", "adjustment"):
        assert not is_spend(kind)


# `_issuer_payment_match` is exercised directly here because, with the current word list of
# `_CARD_PAYMENT_RE` (which already includes bare "PAYMENT"/"PMT"), `resolve_kind` never reaches
# this helper through a public call: any description an issuer-term match would catch already
# matches `_CARD_PAYMENT_RE` on its own "PAYMENT"/"PMT" token. It is kept for A26's literal wording
# and to keep working correctly if that word list is ever narrowed.


def test_issuer_payment_match_no_terms_configured() -> None:
    assert kinds._issuer_payment_match("ACME BANK PAYMENT", ()) is False


def test_issuer_payment_match_no_payment_token_at_all() -> None:
    assert kinds._issuer_payment_match("ACME BANK PURCHASE", ("Acme Bank",)) is False


def test_issuer_payment_match_skips_blank_terms() -> None:
    assert kinds._issuer_payment_match("SOME PAYMENT HERE", ("", "   ")) is False


def test_issuer_payment_match_term_adjacent_to_token() -> None:
    assert kinds._issuer_payment_match("ACME BANK PAYMENT REF", ("Acme Bank",)) is True


def test_issuer_payment_match_term_far_from_token() -> None:
    far = "ACME BANK " + ("X" * 40) + " PAYMENT"
    assert kinds._issuer_payment_match(far, ("Acme Bank",)) is False
