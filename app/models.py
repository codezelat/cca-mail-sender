from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Column, JSON, Text
from sqlmodel import Field, Relationship, SQLModel


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

    contacts: List["Contact"] = Relationship(back_populates="user")
    settings: Optional["UserSettings"] = Relationship(back_populates="user")
    jobs: List["Job"] = Relationship(back_populates="user")
    templates: List["EmailTemplate"] = Relationship(back_populates="user")
    batches: List["CampaignBatch"] = Relationship(back_populates="user")
    import_sessions: List["ImportSession"] = Relationship(back_populates="user")


class UserSettings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")

    brevo_api_key: Optional[str] = None
    sender_email: Optional[str] = None
    sender_name: Optional[str] = None
    subject: Optional[str] = None
    hourly_limit: int = Field(default=20)
    daily_limit: int = Field(default=300)
    selected_template: Optional[str] = None
    default_template_id: Optional[int] = Field(
        default=None, foreign_key="emailtemplate.id"
    )

    last_run: Optional[datetime] = None
    current_hour_window_start: Optional[datetime] = None
    emails_sent_this_hour: int = Field(default=0)
    current_day_window_start: Optional[datetime] = None
    emails_sent_today: int = Field(default=0)

    user: Optional["User"] = Relationship(back_populates="settings")


class Contact(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")

    email: str = Field(index=True)
    normalized_email: str = Field(default="", index=True)
    name: str = Field(default="")
    custom_fields_json: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    unsubscribed_at: Optional[datetime] = None
    last_delivery_status: Optional[str] = None
    last_delivery_error: Optional[str] = None

    # Legacy queue state retained for in-place migrations.
    status: str = Field(default="pending")
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="contacts")
    recipients: List["CampaignRecipient"] = Relationship(back_populates="contact")


class EmailTemplate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    name: str
    slug: str = Field(index=True)
    editor_mode: str = Field(default="builder")
    is_default: bool = Field(default=False)
    is_archived: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="templates")
    versions: List["EmailTemplateVersion"] = Relationship(back_populates="template")


class EmailTemplateVersion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    template_id: int = Field(foreign_key="emailtemplate.id", index=True)
    version_number: int = Field(default=1)
    status: str = Field(default="draft")
    editor_mode: str = Field(default="builder")
    subject: str = Field(default="Campaign Update")
    preheader: str = Field(default="")
    design_json: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    html_source: Optional[str] = Field(default=None, sa_column=Column(Text))
    compiled_html: Optional[str] = Field(default=None, sa_column=Column(Text))
    merge_fields_schema: List[Dict[str, Any]] = Field(
        default_factory=list, sa_column=Column("schema_json", JSON)
    )
    thumbnail: Optional[str] = None
    published_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    template: Optional["EmailTemplate"] = Relationship(back_populates="versions")
    batches: List["CampaignBatch"] = Relationship(back_populates="template_version")
    recipients: List["CampaignRecipient"] = Relationship(back_populates="template_version")


class CampaignBatch(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    template_version_id: int = Field(foreign_key="emailtemplateversion.id", index=True)
    name: str = Field(default="Campaign Batch")
    source_filename: Optional[str] = None
    status: str = Field(default="staged")
    sender_email_snapshot: Optional[str] = None
    sender_name_snapshot: Optional[str] = None
    hourly_limit_snapshot: int = Field(default=20)
    daily_limit_snapshot: int = Field(default=300)
    total_recipients: int = Field(default=0)
    created_count: int = Field(default=0)
    updated_count: int = Field(default=0)
    invalid_count: int = Field(default=0)
    queued_count: int = Field(default=0)
    sent_count: int = Field(default=0)
    failed_count: int = Field(default=0)
    unsubscribed_count: int = Field(default=0)
    launch_summary_json: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    launched_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="batches")
    template_version: Optional["EmailTemplateVersion"] = Relationship(
        back_populates="batches"
    )
    recipients: List["CampaignRecipient"] = Relationship(back_populates="batch")


class CampaignRecipient(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    batch_id: int = Field(foreign_key="campaignbatch.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    contact_id: Optional[int] = Field(default=None, foreign_key="contact.id")
    template_version_id: int = Field(foreign_key="emailtemplateversion.id", index=True)
    email: str = Field(index=True)
    normalized_email: str = Field(default="", index=True)
    name: str = Field(default="")
    status: str = Field(default="staged")
    payload_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    render_snapshot_json: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    error_message: Optional[str] = None
    message_id: Optional[str] = None
    delivered_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    batch: Optional["CampaignBatch"] = Relationship(back_populates="recipients")
    contact: Optional["Contact"] = Relationship(back_populates="recipients")
    template_version: Optional["EmailTemplateVersion"] = Relationship(
        back_populates="recipients"
    )


class ImportSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    template_version_id: int = Field(foreign_key="emailtemplateversion.id", index=True)
    original_filename: str
    stored_path: str
    selected_sheet: Optional[str] = None
    status: str = Field(default="analyzed")
    sheet_names_json: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    detected_columns_json: List[str] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    mapping_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    validation_json: Dict[str, Any] = Field(
        default_factory=dict, sa_column=Column(JSON)
    )
    sample_rows_json: List[Dict[str, Any]] = Field(
        default_factory=list, sa_column=Column(JSON)
    )
    error_report_path: Optional[str] = None
    batch_id: Optional[int] = Field(default=None, foreign_key="campaignbatch.id")
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="import_sessions")


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    total_contacts: int = Field(default=0)
    status: str = Field(default="running")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="jobs")
