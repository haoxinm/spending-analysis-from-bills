"""CLI commands (P0-6 skeleton, P2-C fills every stub in).

A33: `import` auto-confirms confident proposals and otherwise leaves the statement
`awaiting_extractor`, printing the exact command that confirms it; `report` prints monthly
category totals as a terminal table or `--csv`, built on `analytics/query.py`.
"""

from __future__ import annotations

import csv
import os
import sys
import webbrowser
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from pathlib import Path

import typer
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from spend_analyzer.analytics.query import SpendQuery, run_query
from spend_analyzer.api.services import crud, gateway
from spend_analyzer.config import load_settings
from spend_analyzer.core.errors import SpendAnalyzerError
from spend_analyzer.core.logging import configure_logging, get_logger
from spend_analyzer.core.paths import ensure_home
from spend_analyzer.db.migrate import upgrade_head
from spend_analyzer.db.models import Transaction

app = typer.Typer(
    name="spend-analyzer",
    help="Locally-run spend analysis for credit/debit card bills and bank statements.",
    no_args_is_help=True,
)

users_app = typer.Typer(help="Manage local users (D4).")
app.add_typer(users_app, name="users")

issuers_app = typer.Typer(help="Manage issuers (§3.12a, A23/A24), so later imports auto-confirm.")
app.add_typer(issuers_app, name="issuers")

_NOT_YET_IMPLEMENTED = "not yet implemented in this build"

#: A12: same PDF magic-byte check the upload endpoint applies (`api/routers/statements.py`).
_PDF_MAGIC = b"%PDF-"


def _stub(command: str) -> None:
    typer.echo(f"spend-analyzer {command}: {_NOT_YET_IMPLEMENTED}", err=True)
    raise typer.Exit(code=2)


@contextmanager
def _open_engine() -> Iterator[Engine]:
    from spend_analyzer.db.session import make_engine

    home = ensure_home()
    configure_logging(home=home)
    engine = make_engine()
    try:
        yield engine
    finally:
        engine.dispose()


@contextmanager
def _open_session(engine: Engine) -> Iterator[Session]:
    from spend_analyzer.db.session import make_session_factory

    factory = make_session_factory(engine)
    session = factory()
    try:
        yield session
    finally:
        session.close()


def _session_factory_for(engine: Engine) -> sessionmaker[Session]:
    from spend_analyzer.db.session import make_session_factory

    return make_session_factory(engine)


def _sync_taxonomy_and_defaults(session: Session) -> None:
    """Everything `migrate` and `serve` startup both need before the database is usable:
    taxonomy + builtin rules synced (idempotent), and a default user guaranteed to exist (D4) so
    `import`/`report`/`classify`/`export` always have a user to fall back to on a fresh home."""
    from spend_analyzer.classify.rules import sync_builtin_rules
    from spend_analyzer.classify.taxonomy import sync_taxonomy

    sync_taxonomy(session)
    sync_builtin_rules(session)
    crud.ensure_default_user(session)
    session.commit()


def _require_user_id(session: Session, user_id: int | None) -> int:
    """Resolve a required user id: the given `--user-id` (validated), or the `is_default` user
    when none was given.

    Raises:
        typer.Exit: an explicit `user_id` does not exist, or none was given and no user exists
            yet (a clean message, not a traceback — Gate 2's original failure mode).
    """
    if user_id is not None:
        if crud.get_user(session, user_id) is None:
            typer.echo(f"no user with id {user_id}", err=True)
            raise typer.Exit(code=1)
        return user_id
    default = crud.default_user(session)
    if default is None:
        typer.echo(
            "no user exists yet; run 'spend-analyzer migrate' first, or create one with "
            "'spend-analyzer users add <name>'",
            err=True,
        )
        raise typer.Exit(code=1)
    return default.id


def _resolve_user_filter(session: Session, user_id: int | None, *, all_users: bool) -> int | None:
    """Resolve the optional `--user-id`/`--all-users` pair to a filter value: `None` means "no
    filter, every user" (either `--all-users`, or no default user exists yet to fall back to);
    otherwise the id to filter on (D4: an omitted `--user-id` defaults to the `is_default` user).

    Raises:
        typer.Exit: an explicit `user_id` does not exist (a clean message, not a traceback).
    """
    if all_users:
        return None
    if user_id is not None:
        if crud.get_user(session, user_id) is None:
            typer.echo(f"no user with id {user_id}", err=True)
            raise typer.Exit(code=1)
        return user_id
    default = crud.default_user(session)
    return default.id if default is not None else None


@app.command()
def migrate() -> None:
    """Create/upgrade the local database to the latest schema, sync the taxonomy and builtin
    rules, and ensure a default user exists (D4)."""
    with _open_engine() as engine:
        upgrade_head()
        with _open_session(engine) as session:
            _sync_taxonomy_and_defaults(session)

    get_logger("cli").info("migrate: database ready")
    typer.echo("Database migrated and taxonomy synced.")


@app.command(name="serve")
def serve_cmd(
    open_browser: bool = typer.Option(
        True, help="Open the default browser once the server starts."
    ),
) -> None:
    """Start the local web server (I8: binds 127.0.0.1 only; A31: per-launch token)."""
    import uvicorn

    from spend_analyzer.api.app import create_app

    settings = load_settings()
    with _open_engine() as engine:
        with _open_session(engine) as session:
            _sync_taxonomy_and_defaults(session)
        app_instance = create_app(engine=engine, settings=settings)
        token = app_instance.state.token
        port = settings.server.port
        url = f"http://127.0.0.1:{port}/?token={token}"
        typer.echo(f"Spend Analyzer is running at {url}")
        typer.echo(f"Per-launch API token: {token}")
        if open_browser:
            webbrowser.open(url)
        uvicorn.run(app_instance, host="127.0.0.1", port=port, log_level="warning")


@app.command(name="import")
def import_cmd(
    paths: list[str] = typer.Argument(  # noqa: B008 - typer's documented pattern
        ..., help="Statement PDF paths (globs are expanded by the shell, not by this command)."
    ),
    user_id: int | None = typer.Option(
        None,
        "--user-id",
        help="The user these statements belong to (defaults to the default user).",
    ),
    issuer_id: int | None = typer.Option(
        None, "--issuer-id", help="Confirm with this issuer instead of the auto-proposed one."
    ),
    parser_id: str | None = typer.Option(None, "--parser-id", help="Confirm with this parser id."),
    layout_spec_id: int | None = typer.Option(None, "--layout-spec-id"),
    remember: bool = typer.Option(
        False, "--remember", help="Remember this extractor for the issuer."
    ),
) -> None:
    """Import one or more statement PDFs (A22/A33).

    Auto-confirms a confident proposal (unless `[ingest] always_confirm_extractor` is set);
    otherwise leaves the statement `awaiting_extractor` and prints the exact `import` command,
    with `--issuer-id`/`--parser-id`, that confirms it.
    """
    settings = load_settings()
    with _open_engine() as engine, _open_session(engine) as session:
        resolved_user_id = _require_user_id(session, user_id)
        any_error = False
        for raw_path in paths:
            pdf_path = Path(raw_path)
            if not pdf_path.is_file():
                typer.echo(f"{raw_path}: no such file", err=True)
                any_error = True
                continue
            if pdf_path.read_bytes()[: len(_PDF_MAGIC)] != _PDF_MAGIC:
                typer.echo(f"{raw_path}: not a PDF file", err=True)
                any_error = True
                continue

            try:
                proposal = gateway.propose_import(
                    session, pdf_path, user_id=resolved_user_id, original_name=pdf_path.name
                )
                session.commit()
            except SpendAnalyzerError as exc:
                typer.echo(f"{raw_path}: {exc}", err=True)
                any_error = True
                continue

            if proposal.status != "awaiting_extractor":
                typer.echo(f"{raw_path}: statement #{proposal.statement_id} -> {proposal.status}")
                if proposal.status == "error":
                    any_error = True
                continue

            # An explicit --issuer-id/--parser-id/--layout-spec-id is the user (or the printed
            # confirm command above, on a re-run) pinning the extractor by hand: confirm with it
            # even when `propose_import` was not confident (or, on a re-run of the same file's
            # sha, never re-scored it at all — I9's idempotent "reported as-is" path). Falling
            # back to `proposal.issuer_id` covers the case where an issuer did match but the
            # score was still below the confidence threshold.
            explicit_extractor_given = (
                issuer_id is not None or parser_id is not None or layout_spec_id is not None
            )
            resolved_issuer_id = issuer_id if issuer_id is not None else proposal.issuer_id
            should_confirm = explicit_extractor_given or (
                proposal.confident and not settings.ingest.always_confirm_extractor
            )

            if not should_confirm:
                confirm_cmd = f"spend-analyzer import {raw_path} --user-id {resolved_user_id}"
                if proposal.issuer_id is not None:
                    confirm_cmd += f" --issuer-id {proposal.issuer_id}"
                if proposal.parser_id is not None:
                    confirm_cmd += f" --parser-id {proposal.parser_id}"
                typer.echo(
                    f"{raw_path}: statement #{proposal.statement_id} awaiting_extractor "
                    f"(detect_score={proposal.detect_score}); confirm with:\n  {confirm_cmd}"
                )
                continue

            if resolved_issuer_id is None:
                # No issuer matched (none is registered yet, or none matches this statement's
                # text) and the user did not pass --issuer-id either: confirm against the
                # placeholder "Unknown" issuer rather than blocking the import. `issuers add`
                # (below) lets a later import of the same bank's statements match confidently.
                resolved_issuer_id = crud.unknown_issuer_id(session)

            try:
                result = gateway.confirm_import(
                    session,
                    proposal.statement_id,
                    issuer_id=resolved_issuer_id,
                    parser_id=parser_id if parser_id is not None else proposal.parser_id,
                    layout_spec_id=(
                        layout_spec_id if layout_spec_id is not None else proposal.layout_spec_id
                    ),
                    remember=remember or issuer_id is not None,
                )
                session.commit()
            except SpendAnalyzerError as exc:
                typer.echo(f"{raw_path}: statement #{proposal.statement_id} -> {exc}", err=True)
                any_error = True
                continue

            typer.echo(
                f"{raw_path}: statement #{proposal.statement_id} imported "
                f"{result.inserted} transaction(s), skipped {result.skipped_duplicates} "
                "duplicate(s)" + (" [layout drift detected]" if result.layout_drift else "")
            )
            for warning in result.warnings:
                typer.echo(f"  warning: {warning}")

    if any_error:
        raise typer.Exit(code=1)


@app.command()
def classify(
    user_id: int | None = typer.Option(
        None, "--user-id", help="Only this user's transactions (defaults to the default user)."
    ),
    all_users: bool = typer.Option(
        False, "--all-users", help="Classify every user's transactions, ignoring --user-id."
    ),
    statement_id: int | None = typer.Option(None, "--statement-id"),
    only_unclassified: bool = typer.Option(
        True, help="Skip transactions that already have a category."
    ),
) -> None:
    """Run the classification cascade over unclassified transactions."""
    import uuid

    settings = load_settings()
    with _open_engine() as engine, _open_session(engine) as session:
        resolved_user_id = _resolve_user_filter(session, user_id, all_users=all_users)
        stmt = select(Transaction.id)
        if resolved_user_id is not None:
            stmt = stmt.where(Transaction.user_id == resolved_user_id)
        if statement_id is not None:
            stmt = stmt.where(Transaction.statement_id == statement_id)
        if only_unclassified:
            stmt = stmt.where(Transaction.category_id.is_(None))
        transaction_ids = tuple(session.execute(stmt).scalars().all())

        if not transaction_ids:
            typer.echo("Nothing to classify.")
            return

        # classify.cascade's `progress_cb` (P2-B) fires once per cascade stage, which often
        # reports the same (done, total, cost_usd) two or three times in a row when the
        # deterministic stages alone classify everything — print a line only when something
        # about it actually changed, so the run reads as one line per real change rather than
        # the same line repeated.
        last_progress: tuple[int, int, float] | None = None

        def progress_cb(done: int, total: int, cost_usd: float) -> None:
            nonlocal last_progress
            current = (done, total, cost_usd)
            if current == last_progress:
                return
            last_progress = current
            typer.echo(f"  {done}/{total} classified (${cost_usd:.4f})", err=True)

        result = gateway.classify_transactions(
            _session_factory_for(engine),
            transaction_ids,
            cfg=settings.llm,
            group_id=str(uuid.uuid4()),
            progress_cb=progress_cb,
        )

    typer.echo(
        f"Classified {result.classified} transaction(s); {result.needs_review} need review; "
        f"{result.llm_requests} LLM request(s); ${result.cost_usd:.4f} spent."
    )


@app.command()
def report(
    date_from: str | None = typer.Option(None, "--from", help="YYYY-MM-DD"),
    date_to: str | None = typer.Option(None, "--to", help="YYYY-MM-DD"),
    user_id: int | None = typer.Option(
        None, "--user-id", help="Only this user's transactions (defaults to the default user)."
    ),
    all_users: bool = typer.Option(
        False, "--all-users", help="Report on every user's transactions, ignoring --user-id."
    ),
    currency: str = typer.Option("USD"),
    csv_output: bool = typer.Option(False, "--csv", help="Print as CSV instead of a table."),
) -> None:
    """Print monthly category totals for a date range (A33)."""
    with _open_engine() as engine, _open_session(engine) as session:
        resolved_user_id = _resolve_user_filter(session, user_id, all_users=all_users)
        query = SpendQuery(
            user_ids=[resolved_user_id] if resolved_user_id is not None else None,
            date_from=date.fromisoformat(date_from) if date_from else None,
            date_to=date.fromisoformat(date_to) if date_to else None,
            granularity="month",
            group_by=["period", "category"],
            currency=currency,
        )
        rows = run_query(session, query)

    _print_report(rows, as_csv=csv_output)


def _print_report(rows: list[dict[str, object]], *, as_csv: bool) -> None:
    if not rows:
        typer.echo("No transactions match this report.")
        return

    if as_csv:
        writer = csv.writer(sys.stdout)
        writer.writerow(["period", "category", "currency", "total_minor", "txn_count", "avg_minor"])
        for row in rows:
            writer.writerow(
                [
                    row["period"],
                    row["category"],
                    row["currency"],
                    row["total_minor"],
                    row["txn_count"],
                    row["avg_minor"],
                ]
            )
        return

    headers = ("Period", "Category", "Currency", "Total", "Count", "Avg")
    table_rows = [
        (
            str(row["period"]),
            str(row["category"]),
            str(row["currency"]),
            _format_minor(row["total_minor"]),  # type: ignore[arg-type]
            str(row["txn_count"]),
            _format_minor(row["avg_minor"]),  # type: ignore[arg-type]
        )
        for row in rows
    ]
    widths = [max(len(headers[i]), *(len(r[i]) for r in table_rows)) for i in range(len(headers))]
    typer.echo("  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)))
    typer.echo("  ".join("-" * w for w in widths))
    for table_row in table_rows:
        typer.echo("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(table_row)))


def _format_minor(amount_minor: int) -> str:
    sign = "-" if amount_minor < 0 else ""
    return f"{sign}{abs(amount_minor) / 100:.2f}"


@app.command()
def export(
    output: str = typer.Option("-", "--output", help="File path, or '-' for stdout."),
    format: str = typer.Option("csv", "--format", help="csv or json"),
    user_id: int | None = typer.Option(
        None, "--user-id", help="Only this user's transactions (defaults to the default user)."
    ),
    all_users: bool = typer.Option(
        False, "--all-users", help="Export every user's transactions, ignoring --user-id."
    ),
) -> None:
    """Export transactions to CSV/JSON. Never includes `accounts.mask` (A12/export guard)."""
    if format not in ("csv", "json"):
        typer.echo("--format must be 'csv' or 'json'", err=True)
        raise typer.Exit(code=2)

    from spend_analyzer.api.routers.export import export_transactions

    with _open_engine() as engine, _open_session(engine) as session:
        resolved_user_id = _resolve_user_filter(session, user_id, all_users=all_users)
        response = export_transactions(
            format=format,  # type: ignore[arg-type]
            session=session,
            user_id=resolved_user_id,
        )
        body = (
            response.body.decode("utf-8")
            if isinstance(response.body, bytes)
            else str(response.body)
        )

    if output == "-":
        typer.echo(body)
    else:
        Path(output).write_text(body, encoding="utf-8")
        typer.echo(f"Wrote {output}")


@app.command()
def doctor() -> None:
    """Diagnose the local install and configuration: Python version, data directory permissions,
    DB migration state, keychain access, and LLM connectivity, one pass/fail line each."""
    ok = True
    ok &= _check("Python version >= 3.12", sys.version_info >= (3, 12))

    try:
        home = ensure_home()
        ok &= _check(f"Data directory ({home}) writable", os.access(home, os.W_OK))
    except OSError as exc:
        ok &= _check(f"Data directory writable: {exc}", False)

    ok &= _doctor_migrations()
    ok &= _doctor_keychain()
    ok &= _doctor_llm()

    if not ok:
        raise typer.Exit(code=1)


@users_app.command(name="list")
def users_list() -> None:
    """List every local user (D4)."""
    with _open_engine() as engine, _open_session(engine) as session:
        users = crud.list_users(session)
        if not users:
            typer.echo("No users yet. Create one with 'spend-analyzer users add <name>'.")
            return
        for user in users:
            marker = " (default)" if user.is_default else ""
            typer.echo(f"{user.id}\t{user.name}{marker}")


@users_app.command(name="add")
def users_add(
    name: str = typer.Argument(..., help="The new user's display name."),
    default: bool = typer.Option(
        False, "--default", help="Make this the default user (D4: used when --user-id is omitted)."
    ),
) -> None:
    """Create a new local user."""
    with _open_engine() as engine, _open_session(engine) as session:
        user = crud.create_user(session, name=name, is_default=default)
        session.commit()
        marker = " (default)" if user.is_default else ""
        typer.echo(f"Created user #{user.id}: {user.name}{marker}")


@users_app.command(name="set-default")
def users_set_default(user_id: int = typer.Argument(..., help="The user to make default.")) -> None:
    """Make an existing user the default (D4)."""
    with _open_engine() as engine, _open_session(engine) as session:
        user = crud.get_user(session, user_id)
        if user is None:
            typer.echo(f"no user with id {user_id}", err=True)
            raise typer.Exit(code=1)
        crud.update_user(session, user, name=None, is_default=True)
        session.commit()
        typer.echo(f"User #{user.id} ({user.name}) is now the default.")


@issuers_app.command(name="list")
def issuers_list() -> None:
    """List every issuer, with its match terms (§3.12a: used by `import`'s issuer matching)."""
    import json as _json

    with _open_engine() as engine, _open_session(engine) as session:
        issuers = crud.list_issuers(session)
        if not issuers:
            typer.echo(
                "No issuers yet. Create one with 'spend-analyzer issuers add <name>' so a later "
                "import of its statements can auto-confirm."
            )
            return
        for issuer in issuers:
            terms = ", ".join(_json.loads(issuer.match_terms))
            typer.echo(f"{issuer.id}\t{issuer.name}\tmatch_terms=[{terms}]")


@issuers_app.command(name="add")
def issuers_add(
    name: str = typer.Argument(..., help="The issuer's display name (e.g. a bank's name)."),
    match_term: list[str] = typer.Option(  # noqa: B008 - typer's documented pattern
        [],
        "--match-term",
        help="Text that identifies this issuer on a statement's first page (repeatable); "
        "defaults to the name itself.",
    ),
    default_spec: int | None = typer.Option(
        None, "--default-spec", help="An approved layout_specs.id to remember for this issuer."
    ),
) -> None:
    """Register an issuer so `import` can match its statements confidently (§3.12a)."""
    with _open_engine() as engine, _open_session(engine) as session:
        issuer = crud.create_issuer(session, name=name, match_terms=list(match_term))
        if default_spec is not None:
            issuer = crud.update_issuer(
                session, issuer, name=None, match_terms=None, default_spec_id=default_spec
            )
        session.commit()
        typer.echo(f"Created issuer #{issuer.id}: {issuer.name}")


def _doctor_migrations() -> bool:
    from alembic.runtime.migration import MigrationContext

    from spend_analyzer.db.migrate import build_alembic_config
    from spend_analyzer.db.session import make_engine

    try:
        engine = make_engine()
        try:
            with engine.connect() as conn:
                context = MigrationContext.configure(conn)
                current = context.get_current_revision()
            from alembic.script import ScriptDirectory

            script = ScriptDirectory.from_config(build_alembic_config())
            head = script.get_current_head()
            return _check(f"Database migrated to head ({head})", current == head)
        finally:
            engine.dispose()
    except Exception as exc:
        return _check(f"Database migration check failed: {exc}", False)


def _doctor_keychain() -> bool:
    from spend_analyzer.config import delete_api_key, get_api_key, set_api_key

    provider = "spend-analyzer-doctor-check"
    try:
        set_api_key(provider, "doctor-check-value")
        round_tripped = get_api_key(provider) == "doctor-check-value"
        delete_api_key(provider)
        return _check("Keychain read/write", round_tripped)
    except Exception as exc:
        return _check(f"Keychain access failed: {exc}", False)


def _doctor_llm() -> bool:
    settings = load_settings()
    if settings.llm.mode == "none":
        typer.echo("SKIP  LLM connectivity (mode='none')")
        return True
    try:
        from spend_analyzer.classify.llm.egress import classify_batch

        classify_batch(["Doctor Check"], settings.llm)
        return _check("LLM connectivity", True)
    except ModuleNotFoundError as exc:
        return _check(f"LLM connectivity: egress module unavailable ({exc})", False)
    except Exception as exc:
        return _check(f"LLM connectivity failed: {exc}", False)


def _check(label: str, passed: bool) -> bool:
    typer.echo(f"{'PASS' if passed else 'FAIL'}  {label}")
    return passed


@app.command(name="eval")
def eval_cmd(
    csv_path: str = typer.Option(
        "tests/eval/descriptions.csv",
        "--csv",
        help="Labelled CSV (description,category,subcategory).",
    ),
    mode: str = typer.Option(
        "rules", "--mode", help="'rules' (deterministic only) or 'llm' (rules, then the LLM)."
    ),
    as_json: bool = typer.Option(False, "--json", help="Print the full report as JSON."),
) -> None:
    """Run the classifier evaluation harness (P4-C) against a labelled CSV."""
    if mode not in ("rules", "llm"):
        typer.echo("--mode must be 'rules' or 'llm'", err=True)
        raise typer.Exit(code=2)

    from spend_analyzer.eval.harness import EvalMode, run_eval

    resolved_csv = Path(csv_path)
    if not resolved_csv.is_file():
        typer.echo(f"eval failed: no such file: {resolved_csv}", err=True)
        raise typer.Exit(code=2)

    settings = load_settings()
    eval_mode: EvalMode = "rules" if mode == "rules" else "llm"
    try:
        report = run_eval(settings.llm, csv_path=resolved_csv, mode=eval_mode)
    except SpendAnalyzerError as exc:
        typer.echo(f"eval failed: {exc}", err=True)
        raise typer.Exit(code=2) from None

    typer.echo(report.to_json() if as_json else report.text_table())


def main() -> None:  # pragma: no cover - thin wrapper around Typer's own entry point
    app()


if __name__ == "__main__":  # pragma: no cover
    main()
    sys.exit(0)
