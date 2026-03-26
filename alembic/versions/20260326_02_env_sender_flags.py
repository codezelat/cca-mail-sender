"""add env sender preference flags

Revision ID: 20260326_02
Revises: 20260326_01
Create Date: 2026-03-26 00:30:00.000000
"""

from alembic import op
from sqlalchemy import inspect

revision = "20260326_02"
down_revision = "20260326_01"
branch_labels = None
depends_on = None


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    if table_name not in inspector.get_table_names():
        return False
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if _has_column(inspector, "usersettings", "use_env_brevo_api_key") is False:
        op.execute(
            "ALTER TABLE usersettings ADD COLUMN use_env_brevo_api_key BOOLEAN DEFAULT FALSE"
        )

    if _has_column(inspector, "usersettings", "use_env_sender_identity") is False:
        op.execute(
            "ALTER TABLE usersettings ADD COLUMN use_env_sender_identity BOOLEAN DEFAULT FALSE"
        )


def downgrade() -> None:
    pass
