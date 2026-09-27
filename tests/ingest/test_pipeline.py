"""Tests for the ingest pipeline (§3.12a, P2-A): the two-phase import, dedupe (§3.5),
reconciliation (A25), drift (A18), account resolution (D4), and transfer pairing (I11, A26).

Every PDF this file needs is built at test time with `tests.fixtures.gen.base`'s shared
`reportlab` helpers, into `tmp_path` — never written into the repository tree.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.orm import Session

from spend_analyzer.core.errors import UnsupportedLayoutError
from spend_analyzer.core.types import KindHint
from spend_analyzer.db.models import Account, Issuer, Transaction, User
from spend_analyzer.ingest import pipeline
from tests.fixtures.gen.base import format_row, render_lines_pdf

_CARD_WIDTHS = (10, 32, 14)
_BANK_WIDTHS = (10, 26, 10, 10, 12)


def _card_row(date_: str, description: str, amount: str) -> str:
    return format_row([date_, description, amount], _CARD_WIDTHS)


def _bank_row(date_: str, description: str, debit: str, credit: str, balance: str) -> str:
    return format_row([date_, description, debit, credit, balance], _BANK_WIDTHS)


def _build_card_pdf(
    path: Path,
    rows: list[tuple[str, str, str]],
    *,
    opening: str = "0.00",
    closing: str,
    period: str = "Statement Period: 01/01/2026 to 01/31/2026",
) -> None:
    lines = [
        f"Previous Balance: ${opening}",
        f"New Balance: ${closing}",
        period,
        "",
        _card_row("Date", "Description", "Amount"),
        *(_card_row(d, desc, amt) for d, desc, amt in rows),
    ]
    render_lines_pdf(path, [lines])


def _build_bank_pdf(
    path: Path,
    rows: list[tuple[str, str, str, str, str]],
    *,
    opening: str,
    closing: str,
    period: str = "Statement Period: 01/01/2026 through 01/31/2026",
) -> None:
    lines = [
        f"Beginning Balance: ${opening}",
        f"Ending Balance: ${closing}",
        period,
        "",
        _bank_row("Date", "Description", "Withdrawals", "Deposits", "Balance"),
        *(_bank_row(d, desc, debit, credit, bal) for d, desc, debit, credit, bal in rows),
    ]
    render_lines_pdf(path, [lines])


def _build_no_text_layer_pdf(path: Path) -> None:
    from reportlab.pdfgen import canvas

    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), invariant=1)
    c.setFillGray(0.6)
    c.rect(50, 500, 400, 200, fill=1, stroke=0)
    c.showPage()
    c.save()


def _make_user(session: Session, name: str = "alice") -> User:
    user = User(name=name)
    session.add(user)
    session.flush()
    return user


def _make_issuer(session: Session, name: str) -> Issuer:
    issuer = Issuer(name=name, slug=name.lower().replace(" ", "-"))
    session.add(issuer)
    session.flush()
    return issuer


def _propose_and_confirm(
    session: Session, pdf_path: Path, *, user_id: int, issuer_id: int, original_name: str = "s.pdf"
) -> tuple[pipeline.ImportProposal, pipeline.ImportResult]:
    proposal = pipeline.propose_import(
        session, pdf_path, user_id=user_id, original_name=original_name
    )
    result = pipeline.confirm_import(
        session,
        proposal.statement_id,
        issuer_id=issuer_id,
        parser_id=proposal.parser_id,
        layout_spec_id=proposal.layout_spec_id,
        remember=True,
    )
    return proposal, result


# --------------------------------------------------------------------------------------------
# Phase 1: no text layer, idempotency
# --------------------------------------------------------------------------------------------


def test_no_text_layer_produces_one_statement_and_zero_transactions(
    session: Session, tmp_path: Path
) -> None:
    pdf_path = tmp_path / "scan.pdf"
    _build_no_text_layer_pdf(pdf_path)
    user = _make_user(session)

    proposal = pipeline.propose_import(session, pdf_path, user_id=user.id, original_name="scan.pdf")

    assert proposal.status == "no_text_layer"
    assert proposal.confident is False
    from spend_analyzer.db.models import Statement

    statements = session.query(Statement).all()
    assert len(statements) == 1
    assert statements[0].status == "no_text_layer"
    assert statements[0].error_detail == pipeline.NO_TEXT_LAYER_MESSAGE
    assert session.query(Transaction).count() == 0


def test_importing_same_file_twice_is_a_noop(session: Session, tmp_path: Path) -> None:
    pdf_path = tmp_path / "statement.pdf"
    _build_card_pdf(
        pdf_path,
        [
            ("01/03/2026", "GROCERY MART", "45.10"),
            ("01/05/2026", "COFFEE SHOP", "12.34"),
            ("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
        ],
        closing="87.43",
    )
    user = _make_user(session)
    issuer = _make_issuer(session, "Invented Card Co")

    _proposal1, result1 = _propose_and_confirm(
        session, pdf_path, user_id=user.id, issuer_id=issuer.id
    )
    assert result1.inserted == 3

    proposal2 = pipeline.propose_import(
        session, pdf_path, user_id=user.id, original_name="statement.pdf"
    )
    assert proposal2.status == "duplicate"
    assert proposal2.statement_id == _proposal1.statement_id

    result2 = pipeline.confirm_import(
        session,
        proposal2.statement_id,
        issuer_id=issuer.id,
        parser_id=proposal2.parser_id,
        layout_spec_id=proposal2.layout_spec_id,
        remember=True,
    )
    assert result2.inserted == 0
    assert result2.transaction_ids == ()

    from spend_analyzer.db.models import Statement

    assert session.query(Statement).count() == 1
    assert session.query(Transaction).count() == 3


# --------------------------------------------------------------------------------------------
# Dedupe (§3.5): overlapping statements, and the "two identical coffees" fixture
# --------------------------------------------------------------------------------------------


def test_overlapping_statements_yield_union_with_no_duplicates(
    session: Session, tmp_path: Path
) -> None:
    user = _make_user(session)
    issuer = _make_issuer(session, "Overlap Bank")

    first_pdf = tmp_path / "first.pdf"
    _build_card_pdf(
        first_pdf,
        [
            ("01/03/2026", "GROCERY MART", "45.10"),
            ("01/05/2026", "COFFEE SHOP", "12.34"),
            ("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
        ],
        closing="87.43",
    )
    _proposal1, result1 = _propose_and_confirm(
        session, first_pdf, user_id=user.id, issuer_id=issuer.id, original_name="first.pdf"
    )
    assert result1.inserted == 3

    # A second, different file (different bytes -> different sha256) that repeats two of the
    # first statement's rows and adds one new one — the overlapping-period case §3.5 requires a
    # *different* file for, since a byte-identical reimport short-circuits on file_sha256 instead.
    second_pdf = tmp_path / "second.pdf"
    _build_card_pdf(
        second_pdf,
        [
            ("01/05/2026", "COFFEE SHOP", "12.34"),
            ("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
            ("01/15/2026", "HARDWARE STORE", "59.95"),
        ],
        closing="147.38",  # a different (and, for this test, irrelevant) statement total
    )
    _proposal2, result2 = _propose_and_confirm(
        session, second_pdf, user_id=user.id, issuer_id=issuer.id, original_name="second.pdf"
    )

    assert result2.inserted == 1  # only HARDWARE STORE is new
    assert result2.skipped_duplicates == 2

    descriptions = {t.description_raw for t in session.query(Transaction).all()}
    assert descriptions == {"GROCERY MART", "COFFEE SHOP", "ONLINE BOOKSTORE", "HARDWARE STORE"}
    assert session.query(Transaction).count() == 4


def test_two_identical_coffees_then_overlap_then_a_third(session: Session, tmp_path: Path) -> None:
    user = _make_user(session)
    issuer = _make_issuer(session, "Coffee Bank")

    pdf1 = tmp_path / "coffees1.pdf"
    _build_card_pdf(
        pdf1,
        [
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/06/2026", "GROCERY MART", "20.00"),
        ],
        closing="30.00",
    )
    _p1, r1 = _propose_and_confirm(
        session, pdf1, user_id=user.id, issuer_id=issuer.id, original_name="coffees1.pdf"
    )
    assert r1.inserted == 3
    assert session.query(Transaction).filter_by(description_raw="COFFEE SHOP").count() == 2

    # Same two coffees plus nothing new: every row collides, nothing new is inserted.
    pdf2 = tmp_path / "coffees2.pdf"
    _build_card_pdf(
        pdf2,
        [
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/06/2026", "GROCERY MART", "20.00"),
        ],
        closing="30.00",
    )
    _p2, r2 = _propose_and_confirm(
        session, pdf2, user_id=user.id, issuer_id=issuer.id, original_name="coffees2.pdf"
    )
    assert r2.inserted == 0
    assert session.query(Transaction).filter_by(description_raw="COFFEE SHOP").count() == 2

    # A statement with a *third* identical coffee: only the new one is inserted.
    pdf3 = tmp_path / "coffees3.pdf"
    _build_card_pdf(
        pdf3,
        [
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/05/2026", "COFFEE SHOP", "5.00"),
            ("01/06/2026", "GROCERY MART", "20.00"),
        ],
        closing="35.00",
    )
    _p3, r3 = _propose_and_confirm(
        session, pdf3, user_id=user.id, issuer_id=issuer.id, original_name="coffees3.pdf"
    )
    assert r3.inserted == 1
    assert session.query(Transaction).filter_by(description_raw="COFFEE SHOP").count() == 3


# --------------------------------------------------------------------------------------------
# Reconciliation (A25) and drift (A18)
# --------------------------------------------------------------------------------------------


def test_layout_a_fixture_reconciles_clean(session: Session) -> None:
    fixture = (
        Path(__file__).resolve().parent.parent
        / "fixtures"
        / "generated"
        / "layout_a_credit"
        / "layout_a_credit_normal.pdf"
    )
    assert fixture.exists()
    user = _make_user(session)
    issuer = _make_issuer(session, "Layout A Bank")

    _proposal, result = _propose_and_confirm(
        session, fixture, user_id=user.id, issuer_id=issuer.id, original_name=fixture.name
    )

    assert result.reconciliation_delta_minor == 0
    assert result.layout_drift is False
    assert result.inserted > 0


def test_reconciliation_mismatch_is_flagged_without_failing(
    session: Session, tmp_path: Path
) -> None:
    pdf_path = tmp_path / "mismatch.pdf"
    # The printed "New Balance" does not match the sum of the rows below it.
    _build_card_pdf(
        pdf_path,
        [
            ("01/03/2026", "GROCERY MART", "45.10"),
            ("01/05/2026", "COFFEE SHOP", "12.34"),
            ("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
        ],
        closing="999.99",
    )
    user = _make_user(session)
    issuer = _make_issuer(session, "Mismatch Bank")

    _proposal, result = _propose_and_confirm(
        session, pdf_path, user_id=user.id, issuer_id=issuer.id
    )

    assert result.inserted == 3  # the import still completes (A25: never blocks)
    assert result.reconciliation_delta_minor is not None
    assert result.reconciliation_delta_minor != 0
    assert result.layout_drift is True


# --------------------------------------------------------------------------------------------
# Transfer pairing (I11, A26)
# --------------------------------------------------------------------------------------------


def test_card_payment_from_checking_is_linked_and_excluded_from_spend(
    session: Session, tmp_path: Path
) -> None:
    user = _make_user(session)
    credit_issuer = _make_issuer(session, "Visa Bank")
    checking_issuer = _make_issuer(session, "Checking Bank")

    # Confirm the credit-card side first: a payment of $200.00 (printed as a credit).
    credit_pdf = tmp_path / "credit.pdf"
    _build_card_pdf(
        credit_pdf,
        [
            ("01/10/2026", "GROCERY MART", "50.00"),
            ("01/20/2026", "PAYMENT THANK YOU", "200.00 CR"),
            ("01/22/2026", "RESTAURANT", "30.00"),
        ],
        closing="-120.00",
    )
    _cp, credit_result = _propose_and_confirm(
        session, credit_pdf, user_id=user.id, issuer_id=credit_issuer.id, original_name="credit.pdf"
    )
    assert credit_result.inserted == 3

    payment_txn = session.query(Transaction).filter_by(description_raw="PAYMENT THANK YOU").one()
    assert payment_txn.kind == "payment"
    assert payment_txn.amount_minor == -20000
    assert payment_txn.is_spend is False
    assert payment_txn.notes is None

    # Now the checking side: a debit of the same $200.00, described as a card payment, within
    # +/-5 days of the credit-side payment.
    checking_pdf = tmp_path / "checking.pdf"
    _build_bank_pdf(
        checking_pdf,
        [
            # A credit-side row is included so the debit/credit columns both carry at least one
            # value somewhere in the fixture — `infer_column_bands` needs visible content on
            # both sides of a column gap to place it; an entirely blank credit column (every row
            # here would otherwise be a debit) gives it nothing to infer from.
            ("01/02/2026", "PAYCHECK DEPOSIT", "", "300.00", "1,300.00"),
            ("01/03/2026", "ATM WITHDRAWAL", "40.00", "", "1,260.00"),
            ("01/21/2026", "CRD PMT VISA", "200.00", "", "1,060.00"),
            ("01/25/2026", "ONLINE SHOPPING", "60.00", "", "1,000.00"),
        ],
        opening="1,000.00",
        closing="1,000.00",
    )
    # Forced to the generic parser explicitly: this fixture's header row (Withdrawals/Deposits/
    # Balance) alone is enough to also score `layout_d_bank` highly, but that layout further
    # requires its own named section headings (absent here on purpose, since it is the generic
    # parser's debit/credit mode — not layout_d_bank — that this test, and A26, exercise).
    checking_proposal = pipeline.propose_import(
        session, checking_pdf, user_id=user.id, original_name="checking.pdf"
    )
    checking_result = pipeline.confirm_import(
        session,
        checking_proposal.statement_id,
        issuer_id=checking_issuer.id,
        parser_id="generic_table",
        layout_spec_id=None,
        remember=True,
    )
    assert checking_result.inserted == 4

    transfer_txn = session.query(Transaction).filter_by(description_raw="CRD PMT VISA").one()
    assert transfer_txn.kind == "transfer"
    assert transfer_txn.amount_minor == 20000
    assert transfer_txn.is_spend is False

    session.refresh(payment_txn)
    assert transfer_txn.notes is not None
    assert payment_txn.notes is not None
    import json

    assert json.loads(transfer_txn.notes) == {"transfer_pair_id": payment_txn.id}
    assert json.loads(payment_txn.notes) == {"transfer_pair_id": transfer_txn.id}


# --------------------------------------------------------------------------------------------
# Unsupported layout
# --------------------------------------------------------------------------------------------


def test_unsupported_layout_sets_status_and_reraises(session: Session, tmp_path: Path) -> None:
    pdf_path = tmp_path / "malformed.pdf"
    lines = [
        _card_row("Date", "Description", "Amount"),
        _card_row("01/03/2026", "GROCERY MART", "45.10"),
        _card_row("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
    ]
    render_lines_pdf(pdf_path, [lines])
    user = _make_user(session)
    issuer = _make_issuer(session, "Malformed Bank")

    proposal = pipeline.propose_import(
        session, pdf_path, user_id=user.id, original_name="malformed.pdf"
    )
    assert proposal.parser_id == "generic_table"

    with pytest.raises(UnsupportedLayoutError):
        pipeline.confirm_import(
            session,
            proposal.statement_id,
            issuer_id=issuer.id,
            parser_id=proposal.parser_id,
            layout_spec_id=proposal.layout_spec_id,
            remember=True,
        )

    from spend_analyzer.db.models import Statement

    statement = session.get(Statement, proposal.statement_id)
    assert statement is not None
    assert statement.status == "unsupported_layout"
    assert session.query(Transaction).count() == 0


# --------------------------------------------------------------------------------------------
# reparse and reassign
# --------------------------------------------------------------------------------------------


def test_reparse_rebuilds_rows_without_duplicating(session: Session, tmp_path: Path) -> None:
    pdf_path = tmp_path / "statement.pdf"
    _build_card_pdf(
        pdf_path,
        [
            ("01/03/2026", "GROCERY MART", "45.10"),
            ("01/05/2026", "COFFEE SHOP", "12.34"),
            ("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
        ],
        closing="87.43",
    )
    user = _make_user(session)
    issuer = _make_issuer(session, "Reparse Bank")

    proposal, result = _propose_and_confirm(session, pdf_path, user_id=user.id, issuer_id=issuer.id)
    assert result.inserted == 3

    result2 = pipeline.reparse(
        session, proposal.statement_id, parser_id="generic_table", layout_spec_id=None
    )
    session.commit()

    assert result2.inserted == 3
    assert session.query(Transaction).filter_by(statement_id=proposal.statement_id).count() == 3


def test_reparse_without_stored_copy_raises(session: Session, tmp_path: Path) -> None:
    from spend_analyzer.core.errors import SpendAnalyzerError
    from spend_analyzer.db.models import Statement

    statement = Statement(
        file_sha256="0" * 64,
        original_name="x.pdf",
        stored_path=None,
        status="pending",
        ingested_at="now",
    )
    session.add(statement)
    session.flush()

    with pytest.raises(SpendAnalyzerError):
        pipeline.reparse(session, statement.id, parser_id="generic_table", layout_spec_id=None)


def test_reassign_moves_rows_and_deletes_true_duplicates(session: Session, tmp_path: Path) -> None:
    pdf_path = tmp_path / "statement.pdf"
    _build_card_pdf(
        pdf_path,
        [
            ("01/03/2026", "GROCERY MART", "45.10"),
            ("01/05/2026", "COFFEE SHOP", "12.34"),
            ("01/09/2026", "ONLINE BOOKSTORE", "29.99"),
        ],
        closing="87.43",
    )
    user = _make_user(session)
    issuer = _make_issuer(session, "Reassign Bank")

    proposal, result = _propose_and_confirm(session, pdf_path, user_id=user.id, issuer_id=issuer.id)
    assert result.inserted == 3

    other_user = _make_user(session, "bob")
    other_account = Account(
        user_id=other_user.id,
        issuer_id=issuer.id,
        account_type="credit",
        display_name="Bob's card",
        mask="9999",
    )
    session.add(other_account)
    session.flush()

    rows_moved, duplicates_deleted = pipeline.reassign(
        session, proposal.statement_id, user_id=other_user.id, account_id=other_account.id
    )
    session.commit()

    assert rows_moved == 3
    assert duplicates_deleted == 0
    moved = session.query(Transaction).filter_by(statement_id=proposal.statement_id).all()
    assert {t.account_id for t in moved} == {other_account.id}
    assert {t.user_id for t in moved} == {other_user.id}


# --------------------------------------------------------------------------------------------
# Pure-function unit tests: kind resolution and the transfer override
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("hint", "description", "amount_minor", "expected"),
    [
        ("purchase", "GROCERY MART", 1000, "purchase"),
        ("payment_or_refund", "PAYMENT THANK YOU", -2000, "payment"),
        ("payment_or_refund", "MERCHANDISE CREDIT", -500, "refund"),
        (None, "SOME CHARGE", 500, "purchase"),
        (None, "SOME CREDIT", -500, "refund"),
    ],
)
def test_resolve_kind(
    hint: KindHint | None, description: str, amount_minor: int, expected: str
) -> None:
    assert pipeline._resolve_kind(hint, description, amount_minor) == expected


def test_apply_transfer_override_only_on_checking_accounts() -> None:
    assert (
        pipeline._apply_transfer_override("purchase", "AUTOPAY PAYMENT", "checking") == "transfer"
    )
    assert pipeline._apply_transfer_override("purchase", "GROCERY MART", "checking") == "purchase"
    assert pipeline._apply_transfer_override("purchase", "AUTOPAY PAYMENT", "credit") == "purchase"
