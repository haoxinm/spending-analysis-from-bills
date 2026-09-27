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
    result = runner.invoke(app, ["report"])
    assert result.exit_code == 2
