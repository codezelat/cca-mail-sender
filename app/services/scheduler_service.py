import time
import logging
import threading
import os
from datetime import datetime, timedelta
from sqlmodel import Session, select
from app.database import engine
from app.models import User, UserSettings, Contact, Job
from app.services.brevo_service import BrevoService
from jinja2 import Template

logger = logging.getLogger(__name__)


class SchedulerService:
    def __init__(self):
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)

    def start(self):
        logger.info("Starting Scheduler Service...")
        self._thread.start()

    def stop(self):
        logger.info("Stopping Scheduler Service...")
        self._stop_event.set()
        self._thread.join()

    def _get_email_template(self, template_name: str = "mail.html"):
        # Read from data/templates
        path = os.path.join("data/templates", template_name)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return f.read()

        # Fallback to root mail.html if data/templates one missing
        if os.path.exists("mail.html"):
            with open("mail.html", "r", encoding="utf-8") as f:
                return f.read()

        return "<html><body><p>Hello {{ name }}, check this out!</p></body></html>"

    def _run_loop(self):
        logger.info("Scheduler loop started.")
        while not self._stop_event.is_set():
            try:
                with Session(engine) as session:
                    # Fetch all users who have settings configured
                    # We might want to filter active users only, but for now take all.
                    # This approach might be slow if 1000s of users, but okay for MVP.
                    # Ideally we query for "Pending Contacts" and join User/Settings.

                    # Alternative approach: Get all pending contacts, group by user?
                    # Or round-robin users?

                    # For simplicity:
                    # 1. Get List of Users with Settings
                    users_with_settings = session.exec(select(User)).all()

                    processed_any = False

                    for user in users_with_settings:
                        if not user.settings or not user.settings.brevo_api_key:
                            continue

                        settings = user.settings

                        # Refresh limits logic (per user)
                        now = datetime.utcnow()

                        # Initialize windows
                        if not settings.current_day_window_start:
                            settings.current_day_window_start = now
                            settings.emails_sent_today = 0
                        if not settings.current_hour_window_start:
                            settings.current_hour_window_start = now
                            settings.emails_sent_this_hour = 0

                        # Reset Day
                        if now.date() > settings.current_day_window_start.date():
                            settings.emails_sent_today = 0
                            settings.current_day_window_start = now
                            session.add(settings)

                        # Reset Hour
                        if (now - settings.current_hour_window_start).total_seconds() > 3600:
                            settings.emails_sent_this_hour = 0
                            settings.current_hour_window_start = now
                            session.add(settings)

                        session.commit()
                        session.refresh(settings)

                        # Check Limits
                        if settings.emails_sent_today >= settings.daily_limit:
                            continue
                        if settings.emails_sent_this_hour >= settings.hourly_limit:
                            continue

                        # Fetch 1 Pending Contact for this User
                        contact = session.exec(
                            select(Contact)
                            .where(Contact.user_id == user.id)
                            .where(Contact.status == "pending")
                            .limit(1)
                        ).first()

                        if not contact:
                            continue

                        processed_any = True

                        # Process Contact
                        contact.status = "processing"
                        contact.updated_at = datetime.utcnow()
                        session.add(contact)
                        session.commit()
                        session.refresh(contact)

                        logger.info(
                            f"Processing contact {contact.email} for user {user.email}")

                        # Initialize Service with User's Key
                        brevo = BrevoService(
                            settings.brevo_api_key, settings.sender_email, settings.sender_name or "Sender")

                        # EXECUTE SENDING LOGIC (Same as before)
                        # ...
                        # To avoid huge indentation drift, I will call a helper or inline it cleanly.
                        self._process_single_contact(
                            session, brevo, contact, settings)

                    if not processed_any:
                        time.sleep(2)

            except Exception as e:
                logger.error(f"Scheduler global loop error: {e}")
                time.sleep(5)

    def _process_single_contact(self, session, brevo, contact, settings):
        try:
            # 1. Add Contact
            success, error = brevo.create_contact(contact.email, contact.name)
            if not success:
                logger.error(
                    f"Failed to create contact {contact.email}: {error}")
                contact.status = "failed"
                contact.error_message = f"Create Contact Failed: {error}"
                contact.updated_at = datetime.utcnow()
                session.add(contact)
                session.commit()
                return

            time.sleep(1)

            # 3. Send Email
            template_str = self._get_email_template(
                settings.selected_template or "mail.html")
            try:
                template = Template(template_str)
                # Prepare display name
                display_name = contact.name
                if display_name and display_name.lower() != "there":
                    display_name = display_name.title()
                else:
                    display_name = "There"

                html_content = template.render(
                    name=display_name, email=contact.email)
            except Exception:
                html_content = template_str

            success, msg_id = brevo.send_email(
                contact.email, contact.name, settings.subject or "Hello", html_content)
            if not success:
                logger.error(
                    f"Failed to send email to {contact.email}: {msg_id}")
                contact.status = "failed"
                contact.error_message = f"Send Email Failed: {msg_id}"
                contact.updated_at = datetime.utcnow()
                brevo.delete_contact(contact.email)
                session.add(contact)
                session.commit()
                return

            logger.info(f"Email sent to {contact.email}. Message ID: {msg_id}")

            # 4. Wait for delivery confirmation (Polling)
            max_retries = 10
            ready_to_delete = False

            for i in range(max_retries):
                time.sleep(3)
                status_data = brevo.get_email_status(msg_id)

                if status_data:
                    events = status_data.get("events", [])
                    event_names = [e.get("name") for e in events]

                    if "delivered" in event_names:
                        ready_to_delete = True
                        break
                    if "bounced" in event_names or "error" in event_names or "soft_bounce" in event_names:
                        logger.error(
                            f"Email bounced/failed for {contact.email}")
                        contact.error_message = f"Bounced/Failed: {event_names}"
                        ready_to_delete = True
                        break
                    if "request" in event_names:
                        if i == max_retries - 1:
                            ready_to_delete = True

            # 5. Delete Contact
            del_success, del_err = brevo.delete_contact(contact.email)

            # Update DB
            contact.status = "sent"
            contact.error_message = f"Message ID: {msg_id}"
            contact.updated_at = datetime.utcnow()
            if not ready_to_delete:
                contact.error_message += " (Timeout waiting for delivery)"

            settings.emails_sent_today += 1
            settings.emails_sent_this_hour += 1
            settings.last_run = datetime.utcnow()

            session.add(contact)
            session.add(settings)
            session.commit()

        except Exception as e:
            logger.error(f"Error processing contact {contact.email}: {e}")
            contact.status = "failed"
            contact.error_message = f"Internal Error: {str(e)}"
            contact.updated_at = datetime.utcnow()
            session.add(contact)
            session.commit()
