"""industrial runtime baseline

Revision ID: 20260326_01
Revises:
Create Date: 2026-03-26 00:00:00.000000
"""

from alembic import op
from sqlalchemy import inspect
from sqlmodel import SQLModel

from app.models import *  # noqa: F401,F403

revision = "20260326_01"
down_revision = None
branch_labels = None
depends_on = None


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.create_all(bind=bind)
    inspector = inspect(bind)

    if _has_column(inspector, "campaignrecipient", "attempt_count") is False:
        op.execute("ALTER TABLE campaignrecipient ADD COLUMN attempt_count INTEGER DEFAULT 0")

    if _has_column(inspector, "usersession", "token_family") is False and "usersession" in inspector.get_table_names():
        op.execute("ALTER TABLE usersession ADD COLUMN token_family TEXT")

    if _has_column(inspector, "usersession", "csrf_token_hash") is False and "usersession" in inspector.get_table_names():
        op.execute("ALTER TABLE usersession ADD COLUMN csrf_token_hash TEXT")


def downgrade() -> None:
    pass
