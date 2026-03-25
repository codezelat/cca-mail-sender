import csv
import io
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd
from sqlalchemy import or_
from sqlmodel import Session, select

from app.models import (
    CampaignBatch,
    CampaignRecipient,
    Contact,
    EmailTemplateVersion,
    ImportSession,
    User,
)
from app.services.template_service import ensure_schema, render_template_version

SUPPORTED_IMPORT_EXTENSIONS = {".csv", ".xlsx", ".xls"}
MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024
MAX_IMPORT_ROWS = 20000
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

HEADER_ALIASES = {
    "email": {"email", "email_address", "e_mail", "work_email"},
    "name": {"name", "full_name", "contact_name", "recipient_name"},
}


def normalize_header(value: Any) -> str:
    value = str(value or "").strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value


def normalize_value(value: Any) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value or ""))


def list_mappable_fields(
    merge_fields_schema: Iterable[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    schema = ensure_schema(merge_fields_schema)
    fields = [
        {
            "key": "email",
            "label": "Email",
            "required": True,
            "builtin": True,
            "description": "Required for every import.",
        },
        {
            "key": "name",
            "label": "Name",
            "required": False,
            "builtin": True,
            "description": "Optional, but improves personalization.",
        },
    ]
    for field in schema:
        if field["key"] in {"email", "name", "first_name", "last_name", "unsubscribe_url"}:
            continue
        fields.append(field)
    return fields


def detect_duplicate_headers(columns: Iterable[str]) -> List[str]:
    seen = set()
    duplicates = []
    for column in columns:
        normalized = normalize_header(column)
        if normalized in seen and normalized not in duplicates:
            duplicates.append(normalized)
        seen.add(normalized)
    return duplicates


def suggest_mapping(
    columns: Iterable[str], merge_fields_schema: Iterable[Dict[str, Any]]
) -> Tuple[Dict[str, str], List[str]]:
    mapping: Dict[str, str] = {}
    warnings: List[str] = []
    columns = list(columns)
    normalized_columns = {column: normalize_header(column) for column in columns}

    for field in list_mappable_fields(merge_fields_schema):
        key = field["key"]
        aliases = HEADER_ALIASES.get(key, set()) | {normalize_header(key)}
        exact_matches = [column for column, normalized in normalized_columns.items() if normalized in aliases]

        if len(exact_matches) == 1:
            mapping[key] = exact_matches[0]
        elif len(exact_matches) > 1:
            warnings.append(
                f"Field '{key}' matches multiple columns: {', '.join(exact_matches)}."
            )

    return mapping, warnings


def save_import_file(contents: bytes, filename: str) -> str:
    os.makedirs(os.path.join("data", "imports"), exist_ok=True)
    ext = os.path.splitext(filename)[1].lower()
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join("data", "imports", stored_name)
    with open(stored_path, "wb") as handle:
        handle.write(contents)
    return stored_path


def load_workbook(stored_path: str) -> Tuple[List[str], str, pd.DataFrame]:
    ext = os.path.splitext(stored_path)[1].lower()
    if ext == ".csv":
        frame = pd.read_csv(stored_path)
        return ["CSV"], "CSV", frame

    workbook = pd.ExcelFile(stored_path)
    sheet_names = workbook.sheet_names
    selected_sheet = sheet_names[0]
    frame = pd.read_excel(workbook, sheet_name=selected_sheet)
    return sheet_names, selected_sheet, frame


def load_dataframe_from_session(import_session: ImportSession, sheet_name: Optional[str] = None) -> pd.DataFrame:
    ext = os.path.splitext(import_session.stored_path)[1].lower()
    selected_sheet = sheet_name or import_session.selected_sheet
    if ext == ".csv":
        return pd.read_csv(import_session.stored_path)
    return pd.read_excel(import_session.stored_path, sheet_name=selected_sheet)


def preview_rows(frame: pd.DataFrame, limit: int = 5) -> List[Dict[str, Any]]:
    preview: List[Dict[str, Any]] = []
    for _, row in frame.head(limit).iterrows():
        preview.append({str(column): normalize_value(row[column]) for column in frame.columns})
    return preview


def create_import_session(
    session: Session,
    user: User,
    template_version: EmailTemplateVersion,
    filename: str,
    contents: bytes,
) -> Dict[str, Any]:
    if len(contents) > MAX_IMPORT_FILE_SIZE:
        raise ValueError("Import file exceeds the 10MB limit.")

    extension = os.path.splitext(filename)[1].lower()
    if extension not in SUPPORTED_IMPORT_EXTENSIONS:
        raise ValueError("Only CSV, XLSX, and XLS files are supported.")

    stored_path = save_import_file(contents, filename)
    sheet_names, selected_sheet, frame = load_workbook(stored_path)
    if len(frame.index) > MAX_IMPORT_ROWS:
        raise ValueError(f"Import file exceeds the {MAX_IMPORT_ROWS} row limit.")

    duplicate_headers = detect_duplicate_headers(frame.columns)
    suggested_mapping, warnings = suggest_mapping(
        frame.columns, template_version.merge_fields_schema
    )

    import_session = ImportSession(
        user_id=user.id or 0,
        template_version_id=template_version.id or 0,
        original_filename=filename,
        stored_path=stored_path,
        selected_sheet=selected_sheet,
        status="analyzed",
        sheet_names_json=sheet_names,
        detected_columns_json=[str(column) for column in frame.columns],
        mapping_json=suggested_mapping,
        validation_json={"warnings": warnings, "duplicate_headers": duplicate_headers},
        sample_rows_json=preview_rows(frame),
        expires_at=datetime.utcnow() + timedelta(days=2),
    )
    session.add(import_session)
    session.commit()
    session.refresh(import_session)

    return serialize_import_session(import_session, template_version.merge_fields_schema)


def serialize_import_session(
    import_session: ImportSession, merge_fields_schema: Iterable[Dict[str, Any]]
) -> Dict[str, Any]:
    validation = import_session.validation_json or {}
    return {
        "id": import_session.id,
        "template_version_id": import_session.template_version_id,
        "original_filename": import_session.original_filename,
        "selected_sheet": import_session.selected_sheet,
        "status": import_session.status,
        "sheet_names": import_session.sheet_names_json or [],
        "detected_columns": import_session.detected_columns_json or [],
        "mapping": import_session.mapping_json or {},
        "required_fields": [
            field
            for field in list_mappable_fields(merge_fields_schema)
            if field.get("required")
        ],
        "mappable_fields": list_mappable_fields(merge_fields_schema),
        "warnings": validation.get("warnings", []),
        "duplicate_headers": validation.get("duplicate_headers", []),
        "sample_rows": import_session.sample_rows_json or [],
        "summary_counts": validation.get("summary_counts", {}),
        "sample_previews": validation.get("sample_previews", []),
        "error_report_available": bool(import_session.error_report_path),
    }


def save_mapping(
    import_session: ImportSession,
    template_version: EmailTemplateVersion,
    mapping: Dict[str, str],
    selected_sheet: Optional[str] = None,
) -> Dict[str, Any]:
    if selected_sheet:
        import_session.selected_sheet = selected_sheet

    mapped_columns = list(mapping.values())
    if len(mapped_columns) != len(set(mapped_columns)):
        raise ValueError("Each column can only map to one template field.")

    required_fields = [
        field["key"]
        for field in list_mappable_fields(template_version.merge_fields_schema)
        if field.get("required")
    ]
    for required_key in required_fields:
        if not mapping.get(required_key):
            raise ValueError(f"Field '{required_key}' must be mapped before validation.")

    import_session.mapping_json = mapping
    import_session.status = "mapped"
    import_session.updated_at = datetime.utcnow()
    return serialize_import_session(import_session, template_version.merge_fields_schema)


def _effective_row_is_empty(row_payload: Dict[str, Any]) -> bool:
    return not any(str(value).strip() for value in row_payload.values())


def _write_error_report(import_session: ImportSession, row_errors: List[Dict[str, Any]]) -> Optional[str]:
    if not row_errors:
        return None

    os.makedirs(os.path.join("data", "import_reports"), exist_ok=True)
    path = os.path.join(
        "data",
        "import_reports",
        f"import_{import_session.id}_{uuid.uuid4().hex[:8]}.csv",
    )
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["row_number", "email", "error", "details"],
        )
        writer.writeheader()
        for row in row_errors:
            writer.writerow(
                {
                    "row_number": row["row_number"],
                    "email": row.get("email", ""),
                    "error": row["error"],
                    "details": row.get("details", ""),
                }
            )
    return path


def _existing_contacts_map(session: Session, user_id: int, emails: Iterable[str]) -> Dict[str, Contact]:
    emails = [email for email in emails if email]
    if not emails:
        return {}

    contacts = session.exec(
        select(Contact).where(
            Contact.user_id == user_id,
            Contact.normalized_email.in_(emails),
        )
    ).all()
    return {contact.normalized_email: contact for contact in contacts}


def evaluate_import_session(
    session: Session,
    user: User,
    import_session: ImportSession,
    template_version: EmailTemplateVersion,
) -> Dict[str, Any]:
    mapping = import_session.mapping_json or {}
    frame = load_dataframe_from_session(import_session)
    duplicate_headers = detect_duplicate_headers(frame.columns)
    if duplicate_headers:
        raise ValueError(
            "Duplicate headers were detected after normalization: "
            + ", ".join(duplicate_headers)
        )

    if frame.empty:
        raise ValueError("The selected sheet is empty.")

    row_errors: List[Dict[str, Any]] = []
    provisional_rows: List[Dict[str, Any]] = []
    custom_required_fields = [
        field["key"]
        for field in list_mappable_fields(template_version.merge_fields_schema)
        if field["key"] not in {"email", "name"} and field.get("required")
    ]

    for index, row in frame.iterrows():
        row_number = index + 2
        payload: Dict[str, Any] = {}

        for field_key, column_name in mapping.items():
            if column_name not in frame.columns:
                row_errors.append(
                    {
                        "row_number": row_number,
                        "error": f"Mapped column '{column_name}' was not found.",
                        "details": field_key,
                    }
                )
                payload = {}
                break
            payload[field_key] = normalize_value(row[column_name])

        if not payload:
            continue

        if _effective_row_is_empty(payload):
            row_errors.append(
                {
                    "row_number": row_number,
                    "error": "Empty effective row.",
                    "details": "All mapped values were blank.",
                }
            )
            continue

        normalized = normalize_email(payload.get("email", ""))
        payload["email"] = normalized
        if not normalized:
            row_errors.append(
                {
                    "row_number": row_number,
                    "error": "Missing email value.",
                    "details": "",
                }
            )
            continue
        if not is_valid_email(normalized):
            row_errors.append(
                {
                    "row_number": row_number,
                    "email": normalized,
                    "error": "Invalid email format.",
                    "details": "",
                }
            )
            continue

        if not payload.get("name"):
            payload["name"] = "There"

        missing_required = [field for field in custom_required_fields if not payload.get(field)]
        if missing_required:
            row_errors.append(
                {
                    "row_number": row_number,
                    "email": normalized,
                    "error": "Missing required template fields.",
                    "details": ", ".join(missing_required),
                }
            )
            continue

        provisional_rows.append(
            {
                "row_number": row_number,
                "email": normalized,
                "payload": payload,
            }
        )

    email_occurrences: Dict[str, List[Dict[str, Any]]] = {}
    for row in provisional_rows:
        email_occurrences.setdefault(row["email"], []).append(row)

    valid_rows: List[Dict[str, Any]] = []
    duplicate_count = 0
    for email, rows in email_occurrences.items():
        if len(rows) > 1:
            duplicate_count += len(rows)
            for row in rows:
                row_errors.append(
                    {
                        "row_number": row["row_number"],
                        "email": email,
                        "error": "Duplicate email within import file.",
                        "details": "",
                    }
                )
            continue
        valid_rows.extend(rows)

    existing_contacts = _existing_contacts_map(
        session,
        user.id or 0,
        [row["email"] for row in valid_rows],
    )

    created_count = sum(1 for row in valid_rows if row["email"] not in existing_contacts)
    updated_count = len(valid_rows) - created_count

    sample_rows = [row["payload"] for row in valid_rows[:3]]
    sample_previews = []
    for payload in sample_rows:
        sample_previews.append(
            {
                "email": payload.get("email"),
                "html": render_template_version(
                    template_version, payload, user_id=user.id
                ),
            }
        )

    summary_counts = {
        "total_rows": int(len(frame.index)),
        "valid_rows": len(valid_rows),
        "invalid_rows": len(row_errors),
        "duplicate_rows": duplicate_count,
        "created": created_count,
        "updated": updated_count,
    }

    return {
        "valid_rows": valid_rows,
        "row_errors": sorted(row_errors, key=lambda item: item["row_number"]),
        "summary_counts": summary_counts,
        "sample_rows": sample_rows,
        "sample_previews": sample_previews,
        "warnings": [],
    }


def validate_import_session(
    session: Session,
    user: User,
    import_session: ImportSession,
    template_version: EmailTemplateVersion,
) -> Dict[str, Any]:
    result = evaluate_import_session(session, user, import_session, template_version)
    error_report_path = _write_error_report(import_session, result["row_errors"])
    import_session.validation_json = {
        "warnings": result["warnings"],
        "summary_counts": result["summary_counts"],
        "sample_previews": result["sample_previews"],
    }
    import_session.sample_rows_json = result["sample_rows"]
    import_session.error_report_path = error_report_path
    import_session.status = "validated"
    import_session.updated_at = datetime.utcnow()
    session.add(import_session)
    session.commit()
    session.refresh(import_session)

    data = serialize_import_session(import_session, template_version.merge_fields_schema)
    data["row_errors_preview"] = result["row_errors"][:20]
    return data


def stage_batch(
    session: Session,
    user: User,
    import_session: ImportSession,
    template_version: EmailTemplateVersion,
) -> CampaignBatch:
    result = evaluate_import_session(session, user, import_session, template_version)
    valid_rows = result["valid_rows"]
    if not valid_rows:
        raise ValueError("No valid rows are available to stage.")

    existing_contacts = _existing_contacts_map(
        session,
        user.id or 0,
        [row["email"] for row in valid_rows],
    )

    settings = user.settings
    batch = CampaignBatch(
        user_id=user.id or 0,
        template_version_id=template_version.id or 0,
        name=f"{template_version.subject} • {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}",
        source_filename=import_session.original_filename,
        status="staged",
        sender_email_snapshot=settings.sender_email if settings else None,
        sender_name_snapshot=settings.sender_name if settings else None,
        hourly_limit_snapshot=settings.hourly_limit if settings else 20,
        daily_limit_snapshot=settings.daily_limit if settings else 300,
        total_recipients=len(valid_rows),
        created_count=result["summary_counts"]["created"],
        updated_count=result["summary_counts"]["updated"],
        invalid_count=result["summary_counts"]["invalid_rows"],
        launch_summary_json=result["summary_counts"],
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(batch)
    session.commit()
    session.refresh(batch)

    created_contacts = 0
    updated_contacts = 0
    unsubscribed_count = 0

    for row in valid_rows:
        payload = row["payload"]
        normalized = row["email"]
        contact = existing_contacts.get(normalized)

        if contact:
            contact.email = payload["email"]
            contact.normalized_email = normalized
            contact.name = payload.get("name") or contact.name or "There"
            contact.custom_fields_json = {
                key: value
                for key, value in payload.items()
                if key not in {"email", "name"}
            }
            contact.updated_at = datetime.utcnow()
            updated_contacts += 1
        else:
            contact = Contact(
                user_id=user.id or 0,
                email=payload["email"],
                normalized_email=normalized,
                name=payload.get("name") or "There",
                custom_fields_json={
                    key: value
                    for key, value in payload.items()
                    if key not in {"email", "name"}
                },
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(contact)
            session.commit()
            session.refresh(contact)
            existing_contacts[normalized] = contact
            created_contacts += 1

        session.add(contact)
        session.commit()

        status = "unsubscribed" if contact.unsubscribed_at else "staged"
        if status == "unsubscribed":
            unsubscribed_count += 1

        recipient = CampaignRecipient(
            batch_id=batch.id or 0,
            user_id=user.id or 0,
            contact_id=contact.id,
            template_version_id=template_version.id or 0,
            email=payload["email"],
            normalized_email=normalized,
            name=payload.get("name") or "There",
            status=status,
            payload_json=payload,
            render_snapshot_json={"subject": template_version.subject},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        session.add(recipient)

    batch.created_count = created_contacts
    batch.updated_count = updated_contacts
    batch.unsubscribed_count = unsubscribed_count
    batch.updated_at = datetime.utcnow()
    session.add(batch)

    import_session.batch_id = batch.id
    import_session.status = "staged"
    import_session.updated_at = datetime.utcnow()
    session.add(import_session)
    session.commit()
    session.refresh(batch)
    return batch


def launch_batch(session: Session, batch: CampaignBatch) -> CampaignBatch:
    recipients = session.exec(
        select(CampaignRecipient).where(CampaignRecipient.batch_id == batch.id)
    ).all()
    queued_count = 0
    for recipient in recipients:
        if recipient.status == "staged":
            recipient.status = "queued"
            recipient.updated_at = datetime.utcnow()
            queued_count += 1
            session.add(recipient)

    batch.queued_count = queued_count
    batch.status = "queued" if queued_count else "completed"
    batch.launched_at = datetime.utcnow()
    batch.updated_at = datetime.utcnow()
    session.add(batch)
    session.commit()
    session.refresh(batch)
    return batch


def batch_status_counts(session: Session, batch_id: int) -> Dict[str, int]:
    recipients = session.exec(
        select(CampaignRecipient).where(CampaignRecipient.batch_id == batch_id)
    ).all()
    counts: Dict[str, int] = {}
    for recipient in recipients:
        counts[recipient.status] = counts.get(recipient.status, 0) + 1
    return counts


def sync_batch_status(session: Session, batch: CampaignBatch):
    counts = batch_status_counts(session, batch.id or 0)
    batch.queued_count = counts.get("queued", 0)
    batch.sent_count = counts.get("sent", 0)
    batch.failed_count = counts.get("failed", 0)
    batch.unsubscribed_count = counts.get("unsubscribed", 0)
    batch.updated_at = datetime.utcnow()

    active = counts.get("queued", 0) + counts.get("processing", 0) + counts.get("staged", 0)
    if active == 0 and batch.status in {"queued", "processing"}:
        batch.status = "completed_with_errors" if batch.failed_count else "completed"
        batch.completed_at = datetime.utcnow()

    session.add(batch)
    session.commit()


def serialize_batch(
    session: Session,
    batch: CampaignBatch,
    template_version: Optional[EmailTemplateVersion] = None,
) -> Dict[str, Any]:
    template_version = template_version or session.get(
        EmailTemplateVersion, batch.template_version_id
    )
    counts = batch_status_counts(session, batch.id or 0)
    return {
        "id": batch.id,
        "name": batch.name,
        "status": batch.status,
        "template_version_id": batch.template_version_id,
        "template_name": template_version.template.name if template_version and template_version.template else "",
        "subject": template_version.subject if template_version else "",
        "source_filename": batch.source_filename,
        "created": batch.created_count,
        "updated": batch.updated_count,
        "invalid": batch.invalid_count,
        "queued": counts.get("queued", 0),
        "processing": counts.get("processing", 0),
        "sent": counts.get("sent", 0),
        "failed": counts.get("failed", 0),
        "unsubscribed": counts.get("unsubscribed", 0),
        "launched_at": batch.launched_at.isoformat() if batch.launched_at else None,
        "created_at": batch.created_at.isoformat(),
        "updated_at": batch.updated_at.isoformat(),
    }
