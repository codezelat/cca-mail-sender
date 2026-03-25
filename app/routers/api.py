import os
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlmodel import Session, func, select

from app.auth import get_current_user
from app.database import get_session
from app.models import (
    CampaignBatch,
    CampaignRecipient,
    Contact,
    EmailTemplate,
    EmailTemplateVersion,
    ImportSession,
    User,
    UserSettings,
)
from app.services.brevo_service import BrevoService
from app.services.import_service import (
    create_import_session,
    launch_batch,
    save_mapping,
    serialize_batch,
    serialize_import_session,
    stage_batch,
    sync_batch_status,
    validate_import_session,
)
from app.services.template_service import (
    asset_public_url,
    asset_support_enabled,
    create_html_import_template,
    create_template,
    delete_template,
    duplicate_template,
    ensure_default_template_for_user,
    ensure_schema,
    get_draft_version,
    get_latest_published_version,
    get_or_create_draft_version,
    list_template_assets,
    publish_template,
    render_template_html,
    render_template_version,
    serialize_template,
    set_default_template,
    unsubscribe_contact,
    validate_template_version_data,
)

router = APIRouter()


class SettingsPayload(BaseModel):
    brevo_api_key: Optional[str] = ""
    sender_email: Optional[str] = ""
    sender_name: Optional[str] = ""
    hourly_limit: int = Field(default=20, ge=1, le=100000)
    daily_limit: int = Field(default=300, ge=1, le=100000)
    default_template_id: Optional[int] = None


class TemplateCreatePayload(BaseModel):
    name: str
    editor_mode: str = "builder"
    make_default: bool = False


class TemplateDraftPayload(BaseModel):
    name: Optional[str] = None
    editor_mode: str = "builder"
    subject: str = "Campaign Update"
    preheader: str = ""
    design_json: Dict[str, Any] = Field(default_factory=dict)
    html_source: str = ""
    schema_json: list[dict[str, Any]] = Field(default_factory=list)


class TemplateTogglePayload(BaseModel):
    is_archived: bool = True


class PreviewPayload(BaseModel):
    sample_data: Dict[str, Any] = Field(default_factory=dict)


class TestSendPayload(BaseModel):
    test_email: str
    sample_data: Dict[str, Any] = Field(default_factory=dict)


class ImportMappingPayload(BaseModel):
    mapping: Dict[str, str]
    selected_sheet: Optional[str] = None


class ContactUpdatePayload(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    custom_fields_json: Optional[Dict[str, Any]] = None
    unsubscribed: Optional[bool] = None


def require_template(
    session: Session, user: User, template_id: int, include_archived: bool = True
) -> EmailTemplate:
    template = session.get(EmailTemplate, template_id)
    if not template or template.user_id != user.id:
        raise HTTPException(status_code=404, detail="Template not found")
    if template.is_archived and not include_archived:
        raise HTTPException(status_code=400, detail="Template is archived")
    return template


def require_import_session(session: Session, user: User, import_session_id: int) -> ImportSession:
    import_session = session.get(ImportSession, import_session_id)
    if not import_session or import_session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Import session not found")
    return import_session


def require_batch(session: Session, user: User, batch_id: int) -> CampaignBatch:
    batch = session.get(CampaignBatch, batch_id)
    if not batch or batch.user_id != user.id:
        raise HTTPException(status_code=404, detail="Campaign batch not found")
    return batch


def require_recipient(
    session: Session, user: User, recipient_id: int
) -> CampaignRecipient:
    recipient = session.get(CampaignRecipient, recipient_id)
    if not recipient or recipient.user_id != user.id:
        raise HTTPException(status_code=404, detail="Campaign recipient not found")
    return recipient


def get_published_version_or_400(
    session: Session, template: EmailTemplate
) -> EmailTemplateVersion:
    version = get_latest_published_version(session, template.id or 0)
    if not version:
        raise HTTPException(
            status_code=400, detail="Template must be published before it can be used."
        )
    return version


@router.get("/api/settings")
async def get_settings(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    ensure_default_template_for_user(session, user)
    session.refresh(user)

    settings = user.settings
    if not settings:
        return {}

    return {
        "brevo_api_key": settings.brevo_api_key or "",
        "sender_email": settings.sender_email or "",
        "sender_name": settings.sender_name or "",
        "hourly_limit": settings.hourly_limit,
        "daily_limit": settings.daily_limit,
        "default_template_id": settings.default_template_id,
    }


@router.post("/api/settings")
async def update_settings(
    payload: SettingsPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    settings = user.settings
    if not settings:
        settings = UserSettings(user_id=user.id or 0)
        session.add(settings)
        session.commit()
        session.refresh(settings)

    settings.brevo_api_key = payload.brevo_api_key or None
    settings.sender_email = payload.sender_email or None
    settings.sender_name = payload.sender_name or None
    settings.hourly_limit = payload.hourly_limit
    settings.daily_limit = payload.daily_limit

    if payload.default_template_id:
        template = require_template(session, user, payload.default_template_id)
        set_default_template(session, user, template)
        session.refresh(settings)

    session.add(settings)
    session.commit()
    return {"status": "success", "message": "Configuration saved"}


@router.get("/api/stats")
async def get_stats(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    ensure_default_template_for_user(session, user)
    total_contacts = session.exec(
        select(func.count()).select_from(Contact).where(Contact.user_id == user.id)
    ).one()
    total_templates = session.exec(
        select(func.count()).select_from(EmailTemplate).where(EmailTemplate.user_id == user.id)
    ).one()
    total_batches = session.exec(
        select(func.count()).select_from(CampaignBatch).where(CampaignBatch.user_id == user.id)
    ).one()
    queued = session.exec(
        select(func.count())
        .select_from(CampaignRecipient)
        .where(CampaignRecipient.user_id == user.id)
        .where(CampaignRecipient.status == "queued")
    ).one()
    processing = session.exec(
        select(func.count())
        .select_from(CampaignRecipient)
        .where(CampaignRecipient.user_id == user.id)
        .where(CampaignRecipient.status == "processing")
    ).one()
    sent = session.exec(
        select(func.count())
        .select_from(CampaignRecipient)
        .where(CampaignRecipient.user_id == user.id)
        .where(CampaignRecipient.status == "sent")
    ).one()
    failed = session.exec(
        select(func.count())
        .select_from(CampaignRecipient)
        .where(CampaignRecipient.user_id == user.id)
        .where(CampaignRecipient.status == "failed")
    ).one()

    settings = user.settings
    return {
        "total_contacts": total_contacts,
        "templates": total_templates,
        "batches": total_batches,
        "queued": queued,
        "processing": processing,
        "sent": sent,
        "failed": failed,
        "emails_sent_today": settings.emails_sent_today if settings else 0,
        "emails_sent_this_hour": settings.emails_sent_this_hour if settings else 0,
        "daily_limit": settings.daily_limit if settings else 300,
        "hourly_limit": settings.hourly_limit if settings else 20,
        "default_template_id": settings.default_template_id if settings else None,
    }


@router.get("/api/activity")
async def get_activity(
    page: int = 1,
    limit: int = 20,
    status: str = "",
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    query = select(CampaignRecipient).where(CampaignRecipient.user_id == user.id)
    if status:
        query = query.where(CampaignRecipient.status == status)

    total = session.exec(
        select(func.count()).select_from(query.subquery())
    ).one()
    recipients = session.exec(
        query.order_by(CampaignRecipient.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()

    rows = []
    for recipient in recipients:
        batch = session.get(CampaignBatch, recipient.batch_id)
        version = session.get(EmailTemplateVersion, recipient.template_version_id)
        rows.append(
            {
                "id": recipient.id,
                "email": recipient.email,
                "name": recipient.name,
                "status": recipient.status,
                "error_message": recipient.error_message,
                "message_id": recipient.message_id,
                "updated_at": recipient.updated_at.isoformat(),
                "created_at": recipient.created_at.isoformat(),
                "batch_name": batch.name if batch else "",
                "template_subject": version.subject if version else "",
            }
        )

    return {
        "rows": rows,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if total else 1,
    }


@router.get("/api/templates")
async def list_templates(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    ensure_default_template_for_user(session, user)
    templates = session.exec(
        select(EmailTemplate)
        .where(EmailTemplate.user_id == user.id)
        .order_by(EmailTemplate.updated_at.desc())
    ).all()
    return {
        "templates": [serialize_template(session, template) for template in templates],
        "default_template_id": user.settings.default_template_id if user.settings else None,
    }


@router.post("/api/templates")
async def create_template_endpoint(
    payload: TemplateCreatePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = create_template(
        session,
        user,
        payload.name,
        editor_mode=payload.editor_mode,
        make_default=payload.make_default,
    )
    return {"status": "success", "template": serialize_template(session, template, include_versions=True)}


@router.post("/api/templates/import-html")
async def import_template_html(
    file: UploadFile = File(...),
    name: str = Form("Imported HTML Template"),
    make_default: bool = Form(False),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if not file.filename.lower().endswith(".html"):
        raise HTTPException(status_code=400, detail="Only HTML template files are supported.")
    source = (await file.read()).decode("utf-8", errors="ignore")
    template = create_html_import_template(
        session,
        user,
        name=name,
        html_source=source,
        make_default=make_default,
    )
    return {"status": "success", "template": serialize_template(session, template, include_versions=True)}


@router.get("/api/templates/{template_id}")
async def get_template(
    template_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    get_or_create_draft_version(session, template)
    return {"template": serialize_template(session, template, include_versions=True)}


@router.put("/api/templates/{template_id}/draft")
async def update_template_draft(
    template_id: int,
    payload: TemplateDraftPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    draft = get_or_create_draft_version(session, template)

    if payload.name:
        template.name = payload.name.strip() or template.name
    template.editor_mode = payload.editor_mode
    template.updated_at = datetime.utcnow()

    draft.editor_mode = payload.editor_mode
    draft.subject = payload.subject
    draft.preheader = payload.preheader
    draft.design_json = payload.design_json or {}
    draft.html_source = payload.html_source or ""
    draft.schema_json = ensure_schema(payload.schema_json)
    draft.updated_at = datetime.utcnow()

    errors, schema, compiled_html = validate_template_version_data(
        draft.editor_mode,
        draft.subject,
        draft.preheader,
        draft.design_json,
        draft.html_source,
        draft.schema_json,
    )
    draft.schema_json = schema
    draft.compiled_html = compiled_html

    session.add(template)
    session.add(draft)
    session.commit()
    session.refresh(draft)

    return {
        "status": "success",
        "errors": errors,
        "template": serialize_template(session, template, include_versions=True),
    }


@router.post("/api/templates/{template_id}/publish")
async def publish_template_endpoint(
    template_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    draft = get_or_create_draft_version(session, template)
    try:
        published = publish_template(session, template, draft)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "status": "success",
        "message": "Template published",
        "template": serialize_template(session, template, include_versions=True),
        "published_version": published.id,
    }


@router.post("/api/templates/{template_id}/duplicate")
async def duplicate_template_endpoint(
    template_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    duplicate = duplicate_template(session, user, template)
    return {"status": "success", "template": serialize_template(session, duplicate, include_versions=True)}


@router.post("/api/templates/{template_id}/archive")
async def archive_template_endpoint(
    template_id: int,
    payload: TemplateTogglePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    template.is_archived = payload.is_archived
    template.updated_at = datetime.utcnow()
    session.add(template)
    session.commit()
    return {"status": "success", "template": serialize_template(session, template)}


@router.post("/api/templates/{template_id}/default")
async def set_default_template_endpoint(
    template_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    set_default_template(session, user, template)
    return {"status": "success", "default_template_id": template.id}


@router.delete("/api/templates/{template_id}")
async def delete_template_endpoint(
    template_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    try:
        delete_template(session, template)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "success", "message": "Template deleted"}


@router.post("/api/templates/{template_id}/preview")
async def preview_template_endpoint(
    template_id: int,
    payload: PreviewPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    draft = get_or_create_draft_version(session, template)
    html = render_template_version(draft, payload.sample_data, user_id=user.id)
    subject = render_template_html(draft.subject, payload.sample_data, user_id=user.id)
    return {
        "html": html,
        "subject": subject,
        "version": serialize_template(session, template).get("draft_version"),
    }


@router.post("/api/templates/{template_id}/test-send")
async def test_send_template(
    template_id: int,
    payload: TestSendPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id)
    draft = get_or_create_draft_version(session, template)
    settings = user.settings
    if not settings or not settings.brevo_api_key or not settings.sender_email:
        raise HTTPException(
            status_code=400,
            detail="Configure your Brevo API key and sender email before sending test emails.",
        )

    brevo = BrevoService(
        settings.brevo_api_key,
        settings.sender_email,
        settings.sender_name or "Sender",
    )
    html = render_template_version(draft, payload.sample_data, user_id=user.id)
    subject = render_template_html(draft.subject, payload.sample_data, user_id=user.id)
    success, response = brevo.send_email(
        payload.test_email,
        payload.sample_data.get("name", "There"),
        subject,
        html,
    )
    if not success:
        raise HTTPException(status_code=400, detail=response)
    return {"status": "success", "message": f"Test email queued: {response}"}


@router.get("/api/template-assets")
async def get_template_assets(user: User = Depends(get_current_user)):
    return {
        "enabled": asset_support_enabled(),
        "assets": list_template_assets(user.id or 0),
        "base_url": os.getenv("PUBLIC_BASE_URL", ""),
    }


@router.post("/api/template-assets/upload")
async def upload_template_asset(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    if not asset_support_enabled():
        raise HTTPException(
            status_code=400,
            detail="Set PUBLIC_BASE_URL to enable local asset uploads.",
        )

    if not file.filename.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
        raise HTTPException(status_code=400, detail="Unsupported image type.")

    contents = await file.read()
    if len(contents) > 3 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image exceeds the 3MB limit.")

    user_dir = os.path.join("data", "public_assets", str(user.id))
    os.makedirs(user_dir, exist_ok=True)
    filename = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file.filename}"
    path = os.path.join(user_dir, filename)
    with open(path, "wb") as handle:
        handle.write(contents)

    return {
        "status": "success",
        "asset": {
            "filename": filename,
            "url": asset_public_url(f"{user.id}/{filename}"),
            "size": len(contents),
        },
    }


@router.post("/api/imports/analyze")
async def analyze_import(
    template_id: int = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    template = require_template(session, user, template_id, include_archived=False)
    published = get_published_version_or_400(session, template)
    import_session_data = create_import_session(
        session, user, published, file.filename, await file.read()
    )
    return {"status": "success", "import_session": import_session_data}


@router.get("/api/imports/{import_session_id}/sheets")
async def list_import_sheets(
    import_session_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    import_session = require_import_session(session, user, import_session_id)
    version = session.get(EmailTemplateVersion, import_session.template_version_id)
    return {"status": "success", "import_session": serialize_import_session(import_session, version.schema_json if version else [])}


@router.post("/api/imports/{import_session_id}/mapping")
async def save_import_mapping(
    import_session_id: int,
    payload: ImportMappingPayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    import_session = require_import_session(session, user, import_session_id)
    version = session.get(EmailTemplateVersion, import_session.template_version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Template version not found")
    try:
        data = save_mapping(import_session, version, payload.mapping, payload.selected_sheet)
        session.add(import_session)
        session.commit()
        session.refresh(import_session)
        return {"status": "success", "import_session": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/imports/{import_session_id}/validate")
async def validate_import(
    import_session_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    import_session = require_import_session(session, user, import_session_id)
    version = session.get(EmailTemplateVersion, import_session.template_version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Template version not found")
    try:
        data = validate_import_session(session, user, import_session, version)
        return {"status": "success", "validation": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/imports/{import_session_id}/stage")
async def stage_import(
    import_session_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    import_session = require_import_session(session, user, import_session_id)
    version = session.get(EmailTemplateVersion, import_session.template_version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Template version not found")
    try:
        batch = stage_batch(session, user, import_session, version)
        return {"status": "success", "batch": serialize_batch(session, batch, version)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/imports/{import_session_id}/error-report")
async def download_import_error_report(
    import_session_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    import_session = require_import_session(session, user, import_session_id)
    if not import_session.error_report_path or not os.path.exists(import_session.error_report_path):
        raise HTTPException(status_code=404, detail="Error report not available")
    return FileResponse(
        import_session.error_report_path,
        filename=os.path.basename(import_session.error_report_path),
        media_type="text/csv",
    )


@router.get("/api/batches")
async def list_batches(
    limit: int = 20,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    batches = session.exec(
        select(CampaignBatch)
        .where(CampaignBatch.user_id == user.id)
        .order_by(CampaignBatch.updated_at.desc())
        .limit(limit)
    ).all()
    return {"batches": [serialize_batch(session, batch) for batch in batches]}


@router.post("/api/batches/{batch_id}/launch")
async def launch_batch_endpoint(
    batch_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    batch = require_batch(session, user, batch_id)
    try:
        batch = launch_batch(session, batch)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "success", "batch": serialize_batch(session, batch)}


@router.get("/api/batches/{batch_id}/recipients")
async def get_batch_recipients(
    batch_id: int,
    page: int = 1,
    limit: int = 50,
    status: str = "",
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    batch = require_batch(session, user, batch_id)
    query = select(CampaignRecipient).where(CampaignRecipient.batch_id == batch.id)
    if status:
        query = query.where(CampaignRecipient.status == status)

    total = session.exec(
        select(func.count()).select_from(query.subquery())
    ).one()
    recipients = session.exec(
        query.order_by(CampaignRecipient.created_at.asc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    return {
        "batch": serialize_batch(session, batch),
        "recipients": [
            {
                "id": recipient.id,
                "email": recipient.email,
                "name": recipient.name,
                "status": recipient.status,
                "error_message": recipient.error_message,
                "message_id": recipient.message_id,
                "updated_at": recipient.updated_at.isoformat(),
            }
            for recipient in recipients
        ],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if total else 1,
    }


@router.post("/api/recipients/{recipient_id}/resend")
async def resend_recipient(
    recipient_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    recipient = require_recipient(session, user, recipient_id)
    batch = require_batch(session, user, recipient.batch_id)
    contact = session.get(Contact, recipient.contact_id) if recipient.contact_id else None
    if contact and contact.unsubscribed_at:
        raise HTTPException(status_code=400, detail="Recipient is unsubscribed.")

    duplicate = CampaignRecipient(
        batch_id=batch.id or 0,
        user_id=user.id or 0,
        contact_id=recipient.contact_id,
        template_version_id=recipient.template_version_id,
        email=recipient.email,
        normalized_email=recipient.normalized_email,
        name=recipient.name,
        status="queued",
        payload_json=recipient.payload_json,
        render_snapshot_json=recipient.render_snapshot_json,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    batch.status = "queued"
    batch.updated_at = datetime.utcnow()
    session.add(duplicate)
    session.add(batch)
    session.commit()
    session.refresh(duplicate)
    sync_batch_status(session, batch)
    return {"status": "success", "recipient_id": duplicate.id}


@router.get("/api/contacts")
async def list_contacts(
    page: int = 1,
    limit: int = 50,
    search: str = "",
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    query = select(Contact).where(Contact.user_id == user.id)
    if search:
        query = query.where(
            or_(
                Contact.email.contains(search),
                Contact.name.contains(search),
            )
        )
    total = session.exec(
        select(func.count()).select_from(query.subquery())
    ).one()
    contacts = session.exec(
        query.order_by(Contact.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()

    return {
        "contacts": [
            {
                "id": contact.id,
                "name": contact.name,
                "email": contact.email,
                "custom_fields_json": contact.custom_fields_json or {},
                "unsubscribed": bool(contact.unsubscribed_at),
                "last_delivery_status": contact.last_delivery_status,
                "last_delivery_error": contact.last_delivery_error,
                "updated_at": contact.updated_at.isoformat(),
                "created_at": contact.created_at.isoformat(),
            }
            for contact in contacts
        ],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit if total else 1,
    }


@router.put("/api/contacts/{contact_id}")
async def update_contact(
    contact_id: int,
    payload: ContactUpdatePayload,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    contact = session.get(Contact, contact_id)
    if not contact or contact.user_id != user.id:
        raise HTTPException(status_code=404, detail="Contact not found")

    if payload.email is not None:
        normalized_email = payload.email.strip().lower()
        contact.email = payload.email.strip()
        contact.normalized_email = normalized_email
    if payload.name is not None:
        contact.name = payload.name.strip() or "There"
    if payload.custom_fields_json is not None:
        contact.custom_fields_json = payload.custom_fields_json
    if payload.unsubscribed is not None:
        contact.unsubscribed_at = datetime.utcnow() if payload.unsubscribed else None

    contact.updated_at = datetime.utcnow()
    session.add(contact)
    session.commit()
    return {"status": "success", "message": "Contact updated"}


@router.delete("/api/contacts/{contact_id}")
async def delete_contact(
    contact_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    contact = session.get(Contact, contact_id)
    if not contact or contact.user_id != user.id:
        raise HTTPException(status_code=404, detail="Contact not found")

    session.delete(contact)
    session.commit()
    return {"status": "success", "message": "Contact deleted"}


@router.delete("/api/contacts")
async def delete_all_contacts(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    contacts = session.exec(select(Contact).where(Contact.user_id == user.id)).all()
    count = len(contacts)
    for contact in contacts:
        session.delete(contact)
    session.commit()
    return {"status": "success", "message": f"Deleted {count} contacts"}


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str, session: Session = Depends(get_session)):
    try:
        contact = unsubscribe_contact(session, token)
        message = f"{contact.email} has been unsubscribed."
        tone = "text-green-400"
    except ValueError as exc:
        message = str(exc)
        tone = "text-red-400"

    return f"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Unsubscribe</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
        <div class="max-w-md w-full bg-white/5 border border-white/10 rounded-3xl p-8 text-center backdrop-blur-xl">
          <div class="text-sm uppercase tracking-[0.3em] text-gray-500 mb-3">CCA Campaign Manager</div>
          <h1 class="text-3xl font-semibold mb-4">Subscription Update</h1>
          <p class="text-base {tone}">{message}</p>
        </div>
      </body>
    </html>
    """
