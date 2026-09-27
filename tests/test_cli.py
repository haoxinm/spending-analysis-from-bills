from __future__ import annotations

import csv
import io
import json
from pathlib import Path

from typer.testing import CliRunner

from spend_analyzer.cli import app
from spend_analyzer.db.session import make_engine_for_path

runner = CliRunner()

#: The generated fixtures Gate 2 walks (§ tests/fixtures/generated/**): each layout's own
#: fictional bank name (found by `uv run python -c "extract(...)..."` against page 1's text)
#: is registered as an `Issuer` before importing, so `issuer_match.match_issuer` matches it
#: confidently by name (A24) and `import` auto-confirms with no manual --issuer-id step (A33).
_GATE2_FIXTURES = (
    ("layout_a_credit", "credit", "Fixture Bank"),
    ("layout_b_credit", "credit", "CASCADE TRUST BANK"),
    ("layout_c_credit", "credit", "Fabrikam Bank"),
    ("layout_d_bank", "checking", "Lakeshore Community Bank"),
)


def _expected_report_total() -> int:
    """Hand-computed grand total for every `_GATE2_FIXTURES` 'normal' golden: the same
    purchase/fee/interest/refund set the report's default `kinds` filter uses (A7), with each
    transaction's `Kind` resolved exactly as the ingest pipeline resolves it at import time
    (`classify.kinds.resolve_kind`, called with each golden's own `kind_hint`/description/amount/
    account_type) — payments, transfers, and the one `adjustment` row are excluded, and the one
    `refund` row nets in with its negative sign (I11/A7)."""
    from spend_analyzer.classify.kinds import resolve_kind

    fixtures_dir = Path(__file__).resolve().parent / "fixtures" / "generated"
    total = 0
    for layout_dir, account_type, _issuer_name in _GATE2_FIXTURES:
        golden = json.loads((fixtures_dir / layout_dir / f"{layout_dir}_normal.json").read_text())
        parsed = golden.get("parsed", golden)  # layout_c's golden wraps success under "parsed"
        for txn in parsed["transactions"]:
            kind = resolve_kind(
                kind_hint=txn["kind_hint"],
                description_clean=txn["description"],
                amount_minor=txn["amount_minor"],
                account_type=account_type,
            )
            if kind in ("purchase", "fee", "interest", "refund"):
                total += txn["amount_minor"]
    return total


def test_migrate_creates_valid_db(home: Path) -> None:
    result = runner.invoke(app, ["migrate"])
    assert result.exit_code == 0, result.output

    db_file = home / "spend.db"
    assert db_file.exists()

    engine = make_engine_for_path(db_file)
    try:
        with engine.connect() as conn:
            names = {
                row[0]
                for row in conn.exec_driver_sql(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
    finally:
        engine.dispose()
    assert {"users", "accounts", "transactions", "categories"} <= names


def test_migrate_creates_a_default_user_on_a_fresh_home(home: Path) -> None:
    """Gate 2 regression: a fresh `migrate` must leave a usable default user behind so `import`
    (and friends) have someone to attach statements to without requiring `--user-id` (D4)."""
    result = runner.invoke(app, ["migrate"])
    assert result.exit_code == 0, result.output

    list_result = runner.invoke(app, ["users", "list"])
    assert list_result.exit_code == 0, list_result.output
    assert "(default)" in list_result.output

    # Idempotent: migrating an already-migrated home never creates a second default user.
    runner.invoke(app, ["migrate"])
    second_list = runner.invoke(app, ["users", "list"])
    assert second_list.output.count("(default)") == 1


def test_users_add_and_set_default(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    added = runner.invoke(app, ["users", "add", "Jordan"])
    assert added.exit_code == 0, added.output
    assert "Jordan" in added.output

    list_result = runner.invoke(app, ["users", "list"])
    lines = [line for line in list_result.output.splitlines() if "Jordan" in line]
    assert len(lines) == 1
    jordan_id = lines[0].split("\t")[0]

    set_default = runner.invoke(app, ["users", "set-default", jordan_id])
    assert set_default.exit_code == 0, set_default.output

    final_list = runner.invoke(app, ["users", "list"])
    assert final_list.output.count("(default)") == 1
    assert f"{jordan_id}\tJordan (default)" in final_list.output


def test_help_lists_all_subcommands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for name in ("serve", "import", "classify", "report", "migrate", "export", "doctor", "eval"):
        assert name in result.output


def test_eval_rules_mode_prints_a_text_table(home: Path) -> None:
    # `eval` (P4-C's classifier eval harness): rules mode never touches the network, so it
    # needs no LLM configured and can run against the real fixture CSV as-is.
    result = runner.invoke(app, ["eval", "--mode", "rules"])
    assert result.exit_code == 0, result.output
    assert "Eval report (mode=rules)" in result.output
    assert "Accuracy by category:" in result.output


def test_eval_rules_mode_json(home: Path) -> None:
    result = runner.invoke(app, ["eval", "--mode", "rules", "--json"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["mode"] == "rules"
    assert payload["total"] > 0


def test_eval_rejects_an_unknown_mode(home: Path) -> None:
    result = runner.invoke(app, ["eval", "--mode", "bogus"])
    assert result.exit_code == 2


def test_eval_reports_a_clean_error_for_a_missing_csv(home: Path) -> None:
    result = runner.invoke(app, ["eval", "--csv", "does-not-exist.csv"])
    assert result.exit_code == 2
    assert "eval failed" in result.output


def test_report_prints_a_table(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    result = runner.invoke(app, ["report"])
    assert result.exit_code == 0, result.output
    assert "No transactions match this report." in result.output


def test_report_csv(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    result = runner.invoke(app, ["report", "--csv"])
    assert result.exit_code == 0, result.output


def test_import_rejects_missing_file(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    result = runner.invoke(app, ["import", "does-not-exist.pdf", "--user-id", "1"])
    assert result.exit_code == 1
    assert "no such file" in result.output


def test_import_rejects_non_pdf(home: Path, tmp_path: Path) -> None:
    runner.invoke(app, ["migrate"])
    bad_file = tmp_path / "not-a-pdf.pdf"
    bad_file.write_bytes(b"not a pdf")
    result = runner.invoke(app, ["import", str(bad_file), "--user-id", "1"])
    assert result.exit_code == 1
    assert "not a PDF file" in result.output


def test_import_of_unparseable_pdf_reports_error_cleanly(home: Path, tmp_path: Path) -> None:
    """A real PDF that isn't a recognizable statement fails with a clean per-file message
    (exit code 1, not an uncaught-exception traceback)."""
    runner.invoke(app, ["migrate"])
    pdf_file = tmp_path / "statement.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake statement bytes")
    result = runner.invoke(app, ["import", str(pdf_file), "--user-id", "1"], catch_exceptions=False)
    assert result.exit_code == 1, result.output


def test_import_without_user_id_uses_the_default_user(home: Path, tmp_path: Path) -> None:
    """Gate 2 regression: `import` with no `--user-id` must not require one (D4's default
    user), and must fail cleanly (not a raw traceback/IntegrityError) rather than crash."""
    runner.invoke(app, ["migrate"])
    pdf_file = tmp_path / "statement.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake statement bytes")
    result = runner.invoke(app, ["import", str(pdf_file)], catch_exceptions=False)
    # The fixture bytes aren't a real statement, so this fails at parsing (exit 1) — the point
    # is that it never fails on a missing --user-id or an unhandled FK IntegrityError.
    assert result.exit_code == 1, result.output
    assert "Missing option" not in result.output
    assert "IntegrityError" not in result.output


def test_import_with_unknown_user_id_reports_a_clean_error(home: Path, tmp_path: Path) -> None:
    runner.invoke(app, ["migrate"])
    pdf_file = tmp_path / "statement.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake statement bytes")
    result = runner.invoke(
        app, ["import", str(pdf_file), "--user-id", "999999"], catch_exceptions=False
    )
    assert result.exit_code == 1, result.output
    assert "no user with id 999999" in result.output


def test_classify_reports_nothing_to_classify(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    result = runner.invoke(app, ["classify"])
    assert result.exit_code == 0, result.output
    assert "Nothing to classify." in result.output


def test_export_writes_empty_csv(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    result = runner.invoke(app, ["export"])
    assert result.exit_code == 0, result.output


def test_doctor_reports_pass_fail_lines(home: Path) -> None:
    runner.invoke(app, ["migrate"])
    result = runner.invoke(app, ["doctor"])
    assert "Python version" in result.output
    assert "Database migrated" in result.output


def test_gate2_end_to_end_import_classify_report(home: Path) -> None:
    """Reproduces Gate 2's own failing flow end-to-end on a fresh home: `migrate` -> `import`
    every layout's 'normal' fixture with no `--user-id` -> `classify` (LLM `mode='none'`, D2's
    graceful fallback) -> `report`. Asserts the report's grand total matches the hand-computed
    total from `_expected_report_total()` (purchases/fees/interest by month; payments/transfers/
    the one adjustment excluded, the one refund netted in with its sign — I11/A7)."""
    from spend_analyzer.db.models import Issuer
    from spend_analyzer.db.session import make_session_factory

    migrate_result = runner.invoke(app, ["migrate"], catch_exceptions=False)
    assert migrate_result.exit_code == 0, migrate_result.output

    engine = make_engine_for_path(home / "spend.db")
    session_factory = make_session_factory(engine)
    with session_factory() as session:
        for _layout_dir, _account_type, issuer_name in _GATE2_FIXTURES:
            session.add(
                Issuer(
                    name=issuer_name,
                    slug=issuer_name.lower().replace(" ", "-"),
                    match_terms="[]",
                )
            )
        session.commit()
    engine.dispose()

    fixtures_dir = Path(__file__).resolve().parent / "fixtures" / "generated"
    for layout_dir, _account_type, _issuer_name in _GATE2_FIXTURES:
        pdf_path = fixtures_dir / layout_dir / f"{layout_dir}_normal.pdf"
        result = runner.invoke(app, ["import", str(pdf_path)], catch_exceptions=False)
        assert result.exit_code == 0, f"{layout_dir}: {result.output}"
        assert "imported" in result.output, f"{layout_dir}: {result.output}"

    classify_result = runner.invoke(app, ["classify"], catch_exceptions=False)
    assert classify_result.exit_code == 0, classify_result.output
    assert "Classified" in classify_result.output

    report_result = runner.invoke(app, ["report", "--csv"], catch_exceptions=False)
    assert report_result.exit_code == 0, report_result.output

    rows = list(csv.reader(io.StringIO(report_result.output)))
    header, data_rows = rows[0], [r for r in rows[1:] if r]
    total_idx = header.index("total_minor")
    actual_total = sum(int(row[total_idx]) for row in data_rows)
    assert actual_total == _expected_report_total()
