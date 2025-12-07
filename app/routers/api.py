from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Depends, Form
from fastapi.responses import HTMLResponse, JSONResponse
from sqlmodel import Session, select
import pandas as pd
import io
import os
import shutil
import logging
from typing import List
from datetime import datetime

from app.database import get_session
from app.models import Contact, User, UserSettings
from app.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/api/settings")
async def update_settings(
    brevo_api_key: str = Form(...),
    sender_email: str = Form(...),
    sender_name: str = Form(None),
    subject: str = Form("Campaign Update"),
    hourly_limit: int = Form(20),
    daily_limit: int = Form(300),
    selected_template: str = Form("mail.html"),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    settings = user.settings
    if not settings:
        # Should exist from signup, but fail safe
        settings = UserSettings(user_id=user.id)
        session.add(settings)
    
    settings.brevo_api_key = brevo_api_key
    settings.sender_email = sender_email
    settings.sender_name = sender_name
    settings.subject = subject
    settings.hourly_limit = hourly_limit
    settings.daily_limit = daily_limit
    settings.selected_template = selected_template
    
    session.add(settings)
    session.commit()
    
    return {"status": "success", "message": "Configuration saved to your account"}

@router.get("/api/settings")
async def get_settings(user: User = Depends(get_current_user)):
    if not user.settings:
        return {}
    return user.settings

@router.post("/api/upload")
async def upload_contacts(
    file: UploadFile = File(...), 
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    if not file.filename.endswith(('.xlsx', '.xls', '.csv')):
        raise HTTPException(status_code=400, detail="Invalid file format")

    contents = await file.read()
    try:
        if file.filename.endswith('.csv'):
             df = pd.read_csv(io.BytesIO(contents))
        else:
             df = pd.read_excel(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")

    # Validate columns
    required = ['Email', 'Name']
    if not all(col in df.columns for col in required):
        raise HTTPException(status_code=400, detail=f"Missing columns. Required: {required}")

    count = 0
    for _, row in df.iterrows():
        email = str(row['Email']).strip()
        name = str(row['Name']).strip()
        
        # Check if exists for this user
        exists = session.exec(select(Contact).where(Contact.email == email).where(Contact.user_id == user.id)).first()
        if not exists:
            contact = Contact(email=email, name=name, user_id=user.id)
            session.add(contact)
            count += 1
            
    session.commit()
    return {"status": "success", "added": count, "message": f"Successfully imported {count} contacts"}

@router.get("/api/stats")
async def get_stats(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    total = session.query(Contact).filter(Contact.user_id == user.id).count()
    pending = session.query(Contact).filter(Contact.user_id == user.id, Contact.status == "pending").count()
    processing = session.query(Contact).filter(Contact.user_id == user.id, Contact.status == "processing").count()
    sent = session.query(Contact).filter(Contact.user_id == user.id, Contact.status == "sent").count()
    failed = session.query(Contact).filter(Contact.user_id == user.id, Contact.status == "failed").count()
    
    settings = user.settings
    used_today = settings.emails_sent_today if settings else 0
    used_hour = settings.emails_sent_this_hour if settings else 0
    
    return {
        "total_contacts": total,
        "pending": pending,
        "processing": processing,
        "sent": sent,
        "failed": failed,
        "emails_sent_today": used_today,
        "emails_sent_this_hour": used_hour,
        "daily_limit": settings.daily_limit if settings else 300,
        "hourly_limit": settings.hourly_limit if settings else 20
    }
    
@router.get("/api/activity")
async def get_activity(user: User = Depends(get_current_user), session: Session = Depends(get_session)):
    contacts = session.exec(
        select(Contact)
        .where(Contact.user_id == user.id)
        .order_by(Contact.updated_at.desc())
        .limit(10)
    ).all()
    
    return [
        {
            "email": c.email, 
            "name": c.name, 
            "status": c.status, 
            "updated_at": c.updated_at.isoformat()
        } 
        for c in contacts
    ]

@router.get("/api/templates")
async def list_templates():
    template_dir = "data/templates"
    if not os.path.exists(template_dir):
        os.makedirs(template_dir)
        
    files = [f for f in os.listdir(template_dir) if f.endswith(".html")]
    # Ensure mail.html is there if not
    if "mail.html" not in files and os.path.exists("mail.html"):
        # We might want to list root mail.html too or copy it?
        # Let's just list what's in data/templates
        pass
        
    return {"templates": sorted(files)}

@router.post("/api/templates/upload")
async def upload_template(file: UploadFile = File(...)):
    template_dir = "data/templates"
    if not os.path.exists(template_dir):
        os.makedirs(template_dir)
        
    if not file.filename.endswith(".html"):
         raise HTTPException(status_code=400, detail="Only HTML files allowed")
         
    file_path = os.path.join(template_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"status": "success", "filename": file.filename}

@router.post("/api/resend/{email}")
async def resend_email(email: str, session: Session = Depends(get_session)):
    contact = session.exec(select(Contact).where(Contact.email == email)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
        
    # Reset to pending to let scheduler pick it up
    contact.status = "pending"
    contact.error_message = None
    contact.updated_at = datetime.utcnow()
    
    session.add(contact)
    session.commit()
    
    return {"status": "success", "message": f"Queued resend for {email}"}

@router.post("/api/clear-completed")
async def clear_completed(session: Session = Depends(get_session)):
    # Delete sent contacts to keep DB clean? Or just keep them?
    # User said "delete from contacts" in Brevo, but local DB log "recorded in some panel you can use to see analytics". 
    # So we KEEP them in local DB.
    # But maybe we want to clear them to restart?
    # I'll providing an endpoint just in case, or maybe just "Clear all".
    pass
