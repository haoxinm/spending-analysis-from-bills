"""CLI skeleton (P0-6).

In Phase 0, only `migrate` is functional. Every other subcommand prints a clear "not yet
implemented in this build" message and exits with code 2 — this is the one sanctioned stub in the
plan; every later work package fills one of these in.
"""

from __future__ import annotations

import sys

import typer

from spend_analyzer.core.logging import configure_logging, get_logger
from spend_analyzer.core.paths import ensure_home
from spend_analyzer.db.migrate import upgrade_head

app = typer.Typer(
    name="spend-analyzer",
    help="Locally-run spend analysis for credit/debit card bills and bank statements.",
    no_args_is_help=True,
)

_NOT_YET_IMPLEMENTED = "not yet implemented in this build"


def _stub(command: str) -> None:
    typer.echo(f"spend-analyzer {command}: {_NOT_YET_IMPLEMENTED}", err=True)
    raise typer.Exit(code=2)


@app.command()
def migrate() -> None:
    """Create/upgrade the local database to the latest schema and sync the taxonomy."""
    from spend_analyzer.classify.taxonomy import sync_taxonomy
    from spend_analyzer.db.session import make_engine, make_session_factory

    home = ensure_home()
    configure_logging(home=home)
    logger = get_logger("cli")

    upgrade_head()
    engine = make_engine()
    try:
        session_factory = make_session_factory(engine)
        with session_factory() as session:
            sync_taxonomy(session)
            session.commit()
    finally:
        engine.dispose()

    logger.info("migrate: database ready")
    typer.echo("Database migrated and taxonomy synced.")


@app.command(name="serve")
def serve_cmd() -> None:
    """Start the local web server."""
    _stub("serve")


@app.command(name="import")
def import_cmd() -> None:
    """Import one or more statement PDFs."""
    _stub("import")


@app.command()
def classify() -> None:
    """Run the classification cascade over unclassified transactions."""
    _stub("classify")


@app.command()
def report() -> None:
    """Print monthly category totals."""
    _stub("report")


@app.command()
def export() -> None:
    """Export transactions to CSV/JSON."""
    _stub("export")


@app.command()
def doctor() -> None:
    """Diagnose the local install and configuration."""
    _stub("doctor")


@app.command(name="eval")
def eval_cmd() -> None:
    """Run the classifier evaluation harness."""
    _stub("eval")


def main() -> None:  # pragma: no cover - thin wrapper around Typer's own entry point
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
    sys.exit(0)
