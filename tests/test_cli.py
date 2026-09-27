from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from spend_analyzer.cli import app
from spend_analyzer.db.session import make_engine_for_path

runner = CliRunner()


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


def test_help_lists_all_subcommands() -> None:
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    for name in ("serve", "import", "classify", "report", "migrate", "export", "doctor", "eval"):
        assert name in result.output


def test_unimplemented_subcommand_exits_2(home: Path) -> None:
    # `eval` (P4-C, the classifier eval harness) is the one subcommand P2-C does not implement.
    result = runner.invoke(app, ["eval"])
    assert result.exit_code == 2


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


def test_import_reports_ingest_pipeline_unavailable(
    home: Path, tmp_path: Path, monkeypatch: object
) -> None:
    """The CLI must fail clearly, not crash with an unhandled `ModuleNotFoundError`, if the
    §3.12a ingest pipeline it calls through `gateway` is ever missing (parallel-development
    guard; `ingest/pipeline.py` is present in this build, so the failure is faked directly)."""
    from spend_analyzer.api.services import gateway

    def _raise(*args: object, **kwargs: object) -> None:
        raise ModuleNotFoundError("spend_analyzer.ingest.pipeline")

    monkeypatch.setattr(gateway, "propose_import", _raise)  # type: ignore[attr-defined]
    runner.invoke(app, ["migrate"])
    pdf_file = tmp_path / "statement.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake statement bytes")
    result = runner.invoke(app, ["import", str(pdf_file), "--user-id", "1"])
    assert result.exit_code == 2
    assert "ingest pipeline unavailable" in result.output


def test_import_of_unparseable_pdf_reports_error_cleanly(home: Path, tmp_path: Path) -> None:
    """A real PDF that isn't a recognizable statement fails with a clean per-file message
    (exit code 1, not an uncaught-exception traceback)."""
    runner.invoke(app, ["migrate"])
    pdf_file = tmp_path / "statement.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 fake statement bytes")
    result = runner.invoke(app, ["import", str(pdf_file), "--user-id", "1"], catch_exceptions=False)
    assert result.exit_code == 1, result.output


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
