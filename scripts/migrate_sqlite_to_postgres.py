import os
import sqlite3

from sqlmodel import Session, SQLModel, create_engine, select

from app.models import (  # noqa: F401
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


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    return {row[1] for row in rows}


def _add_column_if_missing(
    conn: sqlite3.Connection, table_name: str, column_name: str, ddl: str
) -> None:
    tables = {
        row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if table_name not in tables:
        return
    if column_name not in _table_columns(conn, table_name):
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {ddl}")


def _prepare_source_sqlite(source_url: str) -> None:
    if not source_url.startswith("sqlite:///"):
        return

    sqlite_path = source_url.removeprefix("sqlite:///")
    if not os.path.exists(sqlite_path):
        return

    with sqlite3.connect(sqlite_path) as conn:
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
        conn.commit()


def main() -> None:
    source_url = os.getenv("SOURCE_SQLITE_URL", "sqlite:///data/app.db")
    target_url = os.getenv("TARGET_DATABASE_URL")
    if not target_url:
        raise SystemExit("Set TARGET_DATABASE_URL to the Postgres database URL.")

    _prepare_source_sqlite(source_url)
    source_engine = create_engine(source_url, connect_args={"check_same_thread": False})
    target_engine = create_engine(target_url, pool_pre_ping=True)
    SQLModel.metadata.drop_all(target_engine)
    SQLModel.metadata.create_all(target_engine)

    ordered_models = [
        User,
        EmailTemplate,
        UserSettings,
        Contact,
        EmailTemplateVersion,
        CampaignBatch,
        CampaignRecipient,
        ImportSession,
        Job,
        UserSession,
    ]

    with Session(source_engine) as source, Session(target_engine) as target:
        for model in ordered_models:
            rows = source.exec(select(model)).all()
            for row in rows:
                payload = row.model_dump()
                target.merge(model(**payload))
            target.commit()
            print(f"Migrated {len(rows)} rows from {model.__name__}.")


if __name__ == "__main__":
    main()
