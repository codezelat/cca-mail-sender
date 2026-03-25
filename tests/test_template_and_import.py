from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.models import Contact, EmailTemplate, EmailTemplateVersion, ImportSession, User
from app.services.import_service import evaluate_import_session
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
