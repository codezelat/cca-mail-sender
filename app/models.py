from datetime import datetime
from typing import Optional, List
from sqlmodel import Field, SQLModel, Relationship

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    contacts: List["Contact"] = Relationship(back_populates="user")
    settings: Optional["UserSettings"] = Relationship(back_populates="user")
    jobs: List["Job"] = Relationship(back_populates="user")

class UserSettings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    
    brevo_api_key: Optional[str] = None
    sender_email: Optional[str] = None
    sender_name: Optional[str] = None
    subject: Optional[str] = "Campaign Update"
    hourly_limit: int = Field(default=20)
    daily_limit: int = Field(default=300)
    selected_template: Optional[str] = Field(default="mail.html")
    
    # State tracking
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
    name: str
    status: str = Field(default="pending") # pending, processing, sent, failed
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="contacts")

class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    total_contacts: int
    status: str = "running" # running, completed
    created_at: datetime = Field(default_factory=datetime.utcnow)

    user: Optional["User"] = Relationship(back_populates="jobs")
