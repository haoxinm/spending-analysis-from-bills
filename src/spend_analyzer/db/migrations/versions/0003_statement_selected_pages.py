"""statements: selected_pages (JSON list of pages to parse; NULL = all)

Revision ID: 0003_statement_selected_pages
Revises: 0002_txn_category_subcategory_check
Create Date: 2026-10-25 00:00:00
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_statement_selected_pages"
down_revision: str | None = "0002_txn_category_subcategory_check"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("statements", sa.Column("selected_pages", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("statements") as batch_op:
        batch_op.drop_column("selected_pages")
