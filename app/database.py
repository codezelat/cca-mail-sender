import os
import sqlite3
from typing import Iterable

from sqlalchemy import Integer, inspect, text
from sqlmodel import SQLModel, Session, create_engine

from .config import settings

# Import all models so SQLModel registers them.
from .models import (  # noqa: F401
    CampaignBatch,
    CampaignRecipient,
    Contact,
    EmailTemplate,
    EmailTemplateVersion,
    ImportSession,
    Job,
    User,
    UserSession,
    UserSettings,
)

DATA_DIR = "data"
sqlite_file_name = os.path.join(DATA_DIR, "app.db")
sqlite_url = f"sqlite:///{sqlite_file_name}"
database_url = settings.database_url or sqlite_url

connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(
    database_url,
    connect_args=connect_args,
    pool_pre_ping=not database_url.startswith("sqlite"),
)


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    return {row[1] for row in rows}


def _add_column_if_missing(
    conn: sqlite3.Connection, table_name: str, column_name: str, ddl: str
):
    if table_name not in {
        row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }:
        return

    if column_name not in _table_columns(conn, table_name):
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {ddl}")


def _create_indexes(conn: sqlite3.Connection, statements: Iterable[str]):
    for statement in statements:
        conn.execute(statement)


def run_migrations():
    os.makedirs(DATA_DIR, exist_ok=True)

    if not database_url.startswith("sqlite"):
        return

    with sqlite3.connect(sqlite_file_name) as conn:
        _add_column_if_missing(
            conn,
            "usersettings",
            "default_template_id",
            "default_template_id INTEGER",
        )
        _add_column_if_missing(
            conn,
            "usersettings",
            "use_env_brevo_api_key",
            "use_env_brevo_api_key INTEGER DEFAULT 0",
        )
        _add_column_if_missing(
            conn,
            "usersettings",
            "use_env_sender_identity",
            "use_env_sender_identity INTEGER DEFAULT 0",
        )

        _add_column_if_missing(
            conn,
            "contact",
            "normalized_email",
            "normalized_email TEXT DEFAULT ''",
        )
        _add_column_if_missing(
            conn,
            "contact",
            "custom_fields_json",
            "custom_fields_json TEXT DEFAULT '{}'",
        )
        _add_column_if_missing(
            conn,
            "contact",
            "unsubscribed_at",
            "unsubscribed_at TIMESTAMP",
        )
        _add_column_if_missing(
            conn,
            "contact",
            "last_delivery_status",
            "last_delivery_status TEXT",
        )
        _add_column_if_missing(
            conn,
            "contact",
            "last_delivery_error",
            "last_delivery_error TEXT",
        )
        _add_column_if_missing(
            conn,
            "campaignrecipient",
            "attempt_count",
            "attempt_count INTEGER DEFAULT 0",
        )
        _add_column_if_missing(
            conn,
            "usersession",
            "token_family",
            "token_family TEXT",
        )
        _add_column_if_missing(
            conn,
            "usersession",
            "csrf_token_hash",
            "csrf_token_hash TEXT",
        )

        conn.execute(
            """
            UPDATE contact
            SET normalized_email = lower(trim(email))
            WHERE email IS NOT NULL
              AND (normalized_email IS NULL OR normalized_email = '')
            """
        )
        conn.execute(
            """
            UPDATE contact
            SET custom_fields_json = '{}'
            WHERE custom_fields_json IS NULL OR custom_fields_json = ''
            """
        )
        conn.execute(
            """
            UPDATE contact
            SET last_delivery_status = status
            WHERE (last_delivery_status IS NULL OR last_delivery_status = '')
              AND status IS NOT NULL
            """
        )
        conn.execute(
            """
            UPDATE contact
            SET last_delivery_error = error_message
            WHERE (last_delivery_error IS NULL OR last_delivery_error = '')
              AND error_message IS NOT NULL
            """
        )

        _create_indexes(
            conn,
            [
                """
                CREATE INDEX IF NOT EXISTS ix_contact_user_normalized_email
                ON contact (user_id, normalized_email)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_campaignrecipient_user_status
                ON campaignrecipient (user_id, status)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_campaignbatch_user_status
                ON campaignbatch (user_id, status)
                """,
                """
                CREATE INDEX IF NOT EXISTS ix_usersession_user_expiry
                ON usersession (user_id, expires_at)
                """,
            ],
        )
        conn.commit()


def sync_postgres_sequences(target_engine=None):
    target_engine = target_engine or engine
    url = str(target_engine.url)
    if not url.startswith("postgresql"):
        return

    inspector = inspect(target_engine)
    with target_engine.begin() as connection:
        for table in SQLModel.metadata.sorted_tables:
            if table.name not in inspector.get_table_names():
                continue

            id_column = table.columns.get("id")
            if id_column is None or not isinstance(id_column.type, Integer):
                continue

            sequence_name = connection.execute(
                text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
                {"table_name": table.name},
            ).scalar()
            if not sequence_name:
                continue

            max_id = connection.execute(
                text(f'SELECT COALESCE(MAX(id), 0) FROM "{table.name}"')
            ).scalar()
            next_value = max(int(max_id or 0), 1)
            is_called = bool(max_id)
            connection.execute(
                text(
                    "SELECT setval(CAST(:sequence_name AS regclass), :next_value, :is_called)"
                ),
                {
                    "sequence_name": sequence_name,
                    "next_value": next_value,
                    "is_called": is_called,
                },
            )


def create_db_and_tables():
    os.makedirs(DATA_DIR, exist_ok=True)
    SQLModel.metadata.create_all(engine)
    run_migrations()
    sync_postgres_sequences()


def get_session():
    with Session(engine) as session:
        yield session
