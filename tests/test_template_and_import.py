import asyncio
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Request, Response
from app.config import AppSettings
from sqlmodel import Session, SQLModel, create_engine

from app.auth import _hash_value
from app.models import Contact, EmailTemplate, EmailTemplateVersion, ImportSession, User, UserSettings
from app.models import UserSession
from app.routers.auth_routes import logout_v1
from app.services.import_service import evaluate_import_session
from app.services import settings_service
from app.services.template_service import (
    ensure_schema,
    render_template_html,
    schema_from_source,
    validate_template_version_data,
)


def test_builder_render_escapes_dynamic_tokens():
    design = {
        "blocks": [
            {
                "id": "block-1",
                "type": "section",
                "heading": "Hello {{ name }}",
                "body": "Welcome to the campaign.",
                "background_color": "#ffffff",
                "text_color": "#111827",
                "padding": 24,
                "align": "left",
            }
        ]
    }
    errors, schema, compiled_html = validate_template_version_data(
        "builder",
        "Campaign Subject",
        "Preview text",
        design,
        None,
        [],
    )

    assert errors == []
    assert any(field["key"] == "email" for field in schema)

    rendered = render_template_html(
        compiled_html,
        {"name": "<script>alert(1)</script>", "email": "alex@example.com"},
        user_id=1,
    )

    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in rendered
    assert "<script>alert(1)</script>" not in rendered


def test_schema_extraction_normalizes_unsubscribe_alias():
    schema = schema_from_source(
        '<a href="{{ unsubscribe }}">Unsubscribe</a><p>{{ company_name }}</p>'
    )
    keys = [field["key"] for field in schema]

    assert "unsubscribe_url" in keys
    assert "company_name" in keys
    assert "unsubscribe" not in keys


def test_import_validation_reports_duplicates_and_missing_required_fields(tmp_path: Path):
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)

    csv_path = tmp_path / "contacts.csv"
    csv_path.write_text(
        "\n".join(
            [
                "Email,Name,Company",
                "existing@example.com,Existing Person,Existing Co",
                "new@example.com,New Person,New Co",
                "new@example.com,Duplicate Person,Duplicate Co",
                "missing@example.com,Missing Company,",
            ]
        ),
        encoding="utf-8",
    )

    with Session(engine) as session:
        user = User(email="owner@example.com", password_hash="hash")
        session.add(user)
        session.commit()
        session.refresh(user)

        existing_contact = Contact(
            user_id=user.id,
            email="existing@example.com",
            normalized_email="existing@example.com",
            name="Existing Person",
            custom_fields_json={"company_name": "Old Co"},
        )
        session.add(existing_contact)
        session.commit()

        template = EmailTemplate(
            user_id=user.id,
            name="Campaign",
            slug="campaign",
            editor_mode="builder",
        )
        session.add(template)
        session.commit()
        session.refresh(template)

        version = EmailTemplateVersion(
            template_id=template.id,
            version_number=1,
            status="published",
            editor_mode="builder",
            subject="Hello {{ name }}",
            preheader="Preview",
            compiled_html="<p>{{ company_name }}</p>",
            merge_fields_schema=ensure_schema(
                [
                    {
                        "key": "company_name",
                        "label": "Company Name",
                        "required": True,
                        "default_value": "",
                        "sample_value": "Acme",
                        "description": "Required company field",
                    }
                ]
            ),
        )
        session.add(version)
        session.commit()
        session.refresh(version)

        import_session = ImportSession(
            user_id=user.id,
            template_version_id=version.id,
            original_filename="contacts.csv",
            stored_path=str(csv_path),
            selected_sheet="CSV",
            mapping_json={
                "email": "Email",
                "name": "Name",
                "company_name": "Company",
            },
        )
        session.add(import_session)
        session.commit()
        session.refresh(import_session)

        result = evaluate_import_session(session, user, import_session, version)

    assert result["summary_counts"]["valid_rows"] == 2
    assert result["summary_counts"]["invalid_rows"] == 2
    assert result["summary_counts"]["created"] == 1
    assert result["summary_counts"]["updated"] == 1
    assert any("Duplicate email within import file." == row["error"] for row in result["row_errors"])
    assert any("Missing required template fields." == row["error"] for row in result["row_errors"])


def test_env_sender_settings_auto_activate_when_manual_values_are_missing(monkeypatch):
    monkeypatch.setattr(
        settings_service,
        "settings",
        AppSettings(
            app_name="CCA Campaign Manager",
            secret_key="secret",
            jwt_algorithm="HS256",
            access_token_expire_minutes=15,
            refresh_token_expire_days=30,
            database_url="sqlite://",
            redis_url="redis://127.0.0.1:6379/0",
            web_origin="http://127.0.0.1:3000",
            public_base_url="http://127.0.0.1:8000",
            secure_cookies=False,
            queue_backend="dramatiq",
            email_provider="brevo",
            brevo_smtp_api_key="env-brevo-key",
            kit_api_key="",
            kit_email_template_id=0,
            kit_broadcast_poll_interval_seconds=5,
            kit_broadcast_timeout_seconds=300,
            sender_email="ca@codezela.com",
            sender_name="Codezela Technologies",
        ),
    )

    resolved = settings_service.resolve_sender_settings(
        UserSettings(hourly_limit=25, daily_limit=250)
    )
    serialized = settings_service.serialize_user_settings(
        UserSettings(hourly_limit=25, daily_limit=250)
    )

    assert resolved.provider == "brevo"
    assert resolved.use_env_provider_api_key is True
    assert resolved.use_env_sender_identity is True
    assert resolved.provider_api_key == "env-brevo-key"
    assert resolved.sender_email == "ca@codezela.com"
    assert resolved.sender_name == "Codezela Technologies"
    assert serialized["effective_provider_api_key_configured"] is True
    assert serialized["provider_api_key"] == ""
    assert serialized["effective_sender_email"] == "ca@codezela.com"


def test_manual_sender_settings_fallback_when_env_preferences_are_enabled_but_env_missing(monkeypatch):
    monkeypatch.setattr(
        settings_service,
        "settings",
        AppSettings(
            app_name="CCA Campaign Manager",
            secret_key="secret",
            jwt_algorithm="HS256",
            access_token_expire_minutes=15,
            refresh_token_expire_days=30,
            database_url="sqlite://",
            redis_url="redis://127.0.0.1:6379/0",
            web_origin="http://127.0.0.1:3000",
            public_base_url="http://127.0.0.1:8000",
            secure_cookies=False,
            queue_backend="dramatiq",
            email_provider="brevo",
            brevo_smtp_api_key="",
            kit_api_key="",
            kit_email_template_id=0,
            kit_broadcast_poll_interval_seconds=5,
            kit_broadcast_timeout_seconds=300,
            sender_email="",
            sender_name="",
        ),
    )

    resolved = settings_service.resolve_sender_settings(
        UserSettings(
            brevo_api_key="manual-brevo-key",
            sender_email="manual@example.com",
            sender_name="Manual Sender",
            use_env_brevo_api_key=True,
            use_env_sender_identity=True,
        )
    )

    assert resolved.provider == "brevo"
    assert resolved.use_env_provider_api_key is False
    assert resolved.use_env_sender_identity is False
    assert resolved.provider_api_key == "manual-brevo-key"
    assert resolved.sender_email == "manual@example.com"
    assert resolved.sender_name == "Manual Sender"


def test_kit_provider_uses_kit_env_api_key(monkeypatch):
    monkeypatch.setattr(
        settings_service,
        "settings",
        AppSettings(
            app_name="CCA Campaign Manager",
            secret_key="secret",
            jwt_algorithm="HS256",
            access_token_expire_minutes=15,
            refresh_token_expire_days=30,
            database_url="sqlite://",
            redis_url="redis://127.0.0.1:6379/0",
            web_origin="http://127.0.0.1:3000",
            public_base_url="http://127.0.0.1:8000",
            secure_cookies=False,
            queue_backend="dramatiq",
            email_provider="kit",
            brevo_smtp_api_key="env-brevo-key",
            kit_api_key="env-kit-key",
            kit_email_template_id=9,
            kit_broadcast_poll_interval_seconds=5,
            kit_broadcast_timeout_seconds=300,
            sender_email="kit@example.com",
            sender_name="Kit Sender",
        ),
    )

    resolved = settings_service.resolve_sender_settings(
        UserSettings(
            kit_api_key="manual-kit-key",
            sender_email="manual@example.com",
            sender_name="Manual Sender",
            use_env_brevo_api_key=True,
            use_env_sender_identity=True,
        )
    )

    assert resolved.provider == "kit"
    assert resolved.use_env_provider_api_key is True
    assert resolved.provider_api_key == "env-kit-key"
    assert resolved.sender_email == "kit@example.com"
    assert resolved.sender_name == "Kit Sender"


def test_logout_clears_cookies_even_without_valid_access_session():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        user = User(email="owner@example.com", password_hash="hash")
        session.add(user)
        session.commit()
        session.refresh(user)

        user_session = UserSession(
            id="session-1",
            user_id=user.id,
            refresh_token_hash=_hash_value("refresh-secret"),
            csrf_token_hash=_hash_value("csrf-secret"),
            token_family="family-1",
            expires_at=datetime.utcnow() + timedelta(days=7),
        )
        session.add(user_session)
        session.commit()

        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/api/v1/auth/logout",
                "headers": [(b"cookie", b"cca_refresh=session-1.refresh-secret")],
                "query_string": b"",
                "client": ("127.0.0.1", 3000),
                "server": ("testserver", 80),
                "scheme": "http",
            }
        )
        response = Response()

        result = asyncio.run(logout_v1(response=response, request=request, session=session))

        session.refresh(user_session)

    assert result == {"status": "success"}
    assert user_session.revoked_at is not None
    cookie_headers = [value.decode() for key, value in response.raw_headers if key == b"set-cookie"]
    assert any(header.startswith("cca_access=") for header in cookie_headers)
    assert any(header.startswith("cca_refresh=") for header in cookie_headers)
    assert any(header.startswith("cca_csrf=") for header in cookie_headers)
