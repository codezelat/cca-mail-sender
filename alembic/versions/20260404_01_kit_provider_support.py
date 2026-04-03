"""add kit provider support

Revision ID: 20260404_01
Revises: 20260326_02
Create Date: 2026-04-04 12:00:00.000000
"""

from alembic import op
from sqlalchemy import inspect

revision = "20260404_01"
down_revision = "20260326_02"
branch_labels = None
depends_on = None


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _has_column(inspector, "usersettings", "kit_api_key") is False:
        op.execute("ALTER TABLE usersettings ADD COLUMN kit_api_key TEXT")


def downgrade() -> None:
    pass
