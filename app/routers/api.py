from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Depends, Form
from fastapi.responses import HTMLResponse, JSONResponse
from sqlmodel import Session, select, func
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

    # Normalize columns to lowercase for matching
    df.columns = df.columns.str.strip().str.lower()
    
    # Check for required columns (email matches, name matches)
    # We want 'email' and 'name'
    if 'email' not in df.columns:
         raise HTTPException(status_code=400, detail="Missing 'Email' column")
    
    # 'name' is optional-ish but we enforce it based on previous logic, but let's be strict as per user request
    if 'name' not in df.columns:
         raise HTTPException(status_code=400, detail="Missing 'Name' column")

    count = 0
    for _, row in df.iterrows():
        email = str(row['email']).strip()
        # Handle various empty types (nan, None, empty string)
        raw_name = row['name']
        if pd.isna(raw_name) or str(raw_name).strip() == "":
             name = "There"
        else:
             name = str(raw_name).strip()
        
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

@router.get("/api/contacts")
async def list_contacts(
    page: int = 1, 
    limit: int = 50, 
    search: str = "", 
    user: User = Depends(get_current_user), 
    session: Session = Depends(get_session)
):
    query = select(Contact).where(Contact.user_id == user.id)
    
    if search:
        search = search.lower()
        query = query.where(
            (Contact.email.contains(search)) | 
            (Contact.name.contains(search))
        )
    
    # Total count for pagination
    total = session.exec(select(func.count()).select_from(query.subquery())).one()
    
    # Pagination
    contacts = session.exec(
        query.order_by(Contact.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    
    return {
        "contacts": [
            {
                "id": c.id,
                "email": c.email,
                "name": c.name,
                "status": c.status,
                "error_message": c.error_message,
                "created_at": c.created_at.isoformat()
            } for c in contacts
        ],
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@router.put("/api/contacts/{contact_id}")
async def update_contact(
    contact_id: int, 
    name: str = Form(None), 
    email: str = Form(None),
    user: User = Depends(get_current_user), 
    session: Session = Depends(get_session)
):
    contact = session.exec(select(Contact).where(Contact.id == contact_id).where(Contact.user_id == user.id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
        
    if name is not None:
        contact.name = name
    if email is not None:
        contact.email = email
        
    session.add(contact)
    session.commit()
    return {"status": "success", "message": "Contact updated"}

@router.delete("/api/contacts/{contact_id}")
async def delete_contact(
    contact_id: int, 
    user: User = Depends(get_current_user), 
    session: Session = Depends(get_session)
):
    contact = session.exec(select(Contact).where(Contact.id == contact_id).where(Contact.user_id == user.id)).first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
        
    session.delete(contact)
    session.commit()
    return {"status": "success", "message": "Contact deleted"}

@router.delete("/api/contacts")
async def delete_all_contacts(
    user: User = Depends(get_current_user), 
    session: Session = Depends(get_session)
):
    # Bulk delete for this user
    statement = select(Contact).where(Contact.user_id == user.id)
    contacts = session.exec(statement).all()
    
    for contact in contacts:
        session.delete(contact)
        
    session.commit()
    return {"status": "success", "message": f"Deleted {len(contacts)} contacts"}

@router.post("/api/clear-completed")
async def clear_completed(session: Session = Depends(get_session)):
    # Legacy or unused currently
    pass
