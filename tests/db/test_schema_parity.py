"""Proves the ORM metadata and the Alembic migration produce identical schemas (P0-3 Accepts)."""

from __future__ import annotations

from pathlib import Path

from spend_analyzer.db.migrate import upgrade_head
from spend_analyzer.db.models import Base
from spend_analyzer.db.session import make_engine_for_path


def _sqlite_master_rows(db_path: Path) -> set[tuple[str, str, str]]:
    engine = make_engine_for_path(db_path)
    try:
        with engine.connect() as conn:
            rows = conn.exec_driver_sql(
                "SELECT type, name, sql FROM sqlite_master "
                "WHERE name NOT LIKE 'sqlite_%' AND name != 'alembic_version' "
                "ORDER BY type, name"
            ).fetchall()
    finally:
        engine.dispose()
    return {(str(r[0]), str(r[1]), str(r[2])) for r in rows}


def test_orm_metadata_and_migration_produce_identical_schema(tmp_path: Path) -> None:
    via_migration_path = tmp_path / "via_migration.db"
    upgrade_head(f"sqlite:///{via_migration_path}")

    via_metadata_path = tmp_path / "via_metadata.db"
    engine = make_engine_for_path(via_metadata_path)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        engine.dispose()

    migration_schema = _sqlite_master_rows(via_migration_path)
    metadata_schema = _sqlite_master_rows(via_metadata_path)
    assert migration_schema == metadata_schema
