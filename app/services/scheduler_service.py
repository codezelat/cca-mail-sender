import logging
import threading
import time
from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.database import engine
from app.models import CampaignBatch, CampaignRecipient, Contact, EmailTemplateVersion, User
from app.services.brevo_service import BrevoService
from app.services.import_service import sync_batch_status
from app.services.template_service import render_template_html, render_template_version

logger = logging.getLogger(__name__)


class SchedulerService:
    def __init__(self):
        self._stop_event = threading.Event()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)

    def start(self):
        logger.info("Starting Scheduler Service...")
        if not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()

    def stop(self):
        logger.info("Stopping Scheduler Service...")
        self._stop_event.set()
        if self._thread.is_alive():
            self._thread.join()

    def _run_loop(self):
        logger.info("Scheduler loop started.")
        while not self._stop_event.is_set():
            try:
                with Session(engine) as session:
                    processed_any = False
                    users = session.exec(select(User)).all()
                    for user in users:
                        if not user.settings or not user.settings.brevo_api_key:
                            continue

                        self._refresh_windows(session, user)
                        if self._limits_exhausted(user):
                            continue

                        recipient = session.exec(
                            select(CampaignRecipient)
                            .where(CampaignRecipient.user_id == user.id)
                            .where(CampaignRecipient.status == "queued")
                            .order_by(CampaignRecipient.created_at.asc())
                            .limit(1)
                        ).first()

                        if not recipient:
                            continue

                        batch = session.get(CampaignBatch, recipient.batch_id)
                        if not batch:
                            recipient.status = "failed"
                            recipient.error_message = "Batch not found."
                            recipient.updated_at = datetime.utcnow()
                            session.add(recipient)
                            session.commit()
                            continue

                        batch.status = "processing"
                        batch.updated_at = datetime.utcnow()
                        recipient.status = "processing"
                        recipient.updated_at = datetime.utcnow()
                        session.add(batch)
                        session.add(recipient)
                        session.commit()
                        session.refresh(recipient)

                        processed_any = True
                        self._process_recipient(session, user, batch, recipient)

                    if not processed_any:
                        time.sleep(2)
            except Exception as exc:
                logger.exception("Scheduler global loop error: %s", exc)
                time.sleep(5)

    def _refresh_windows(self, session: Session, user: User):
        settings = user.settings
        if not settings:
            return

        now = datetime.utcnow()
        if not settings.current_day_window_start:
            settings.current_day_window_start = now
            settings.emails_sent_today = 0
        if not settings.current_hour_window_start:
            settings.current_hour_window_start = now
            settings.emails_sent_this_hour = 0

        if now.date() > settings.current_day_window_start.date():
            settings.emails_sent_today = 0
            settings.current_day_window_start = now

        if (now - settings.current_hour_window_start).total_seconds() >= 3600:
            settings.emails_sent_this_hour = 0
            settings.current_hour_window_start = now

        session.add(settings)
        session.commit()

    def _limits_exhausted(self, user: User) -> bool:
        settings = user.settings
        if not settings:
            return True
        if settings.emails_sent_today >= settings.daily_limit:
            return True
        if settings.emails_sent_this_hour >= settings.hourly_limit:
            return True
        return False

    def _mark_failed(
        self,
        session: Session,
        recipient: CampaignRecipient,
        batch: CampaignBatch,
        contact: Optional[Contact],
        message: str,
    ):
        recipient.status = "failed"
        recipient.error_message = message
        recipient.updated_at = datetime.utcnow()
        session.add(recipient)

        if contact:
            contact.last_delivery_status = "failed"
            contact.last_delivery_error = message
            contact.updated_at = datetime.utcnow()
            session.add(contact)

        batch.updated_at = datetime.utcnow()
        session.add(batch)
        session.commit()
        sync_batch_status(session, batch)

    def _process_recipient(
        self,
        session: Session,
        user: User,
        batch: CampaignBatch,
        recipient: CampaignRecipient,
    ):
        settings = user.settings
        version = session.get(EmailTemplateVersion, recipient.template_version_id)
        contact = session.get(Contact, recipient.contact_id) if recipient.contact_id else None

        if not settings or not settings.sender_email:
            self._mark_failed(
                session,
                recipient,
                batch,
                contact,
                "Sender configuration is incomplete.",
            )
            return

        if contact and contact.unsubscribed_at:
            recipient.status = "unsubscribed"
            recipient.error_message = "Recipient unsubscribed."
            recipient.updated_at = datetime.utcnow()
            session.add(recipient)
            session.commit()
            sync_batch_status(session, batch)
            return

        if not version:
            self._mark_failed(session, recipient, batch, contact, "Template version not found.")
            return

        brevo = BrevoService(
            settings.brevo_api_key,
            batch.sender_email_snapshot or settings.sender_email,
            batch.sender_name_snapshot or settings.sender_name or "Sender",
        )

        payload = recipient.payload_json or {}
        rendered_html = render_template_version(version, payload, user_id=user.id)
        rendered_subject = render_template_html(
            version.subject, payload, user_id=user.id
        ).strip()

        success, error = brevo.create_contact(recipient.email, recipient.name or "There")
        if not success:
            self._mark_failed(
                session,
                recipient,
                batch,
                contact,
                f"Create Contact Failed: {error}",
            )
            return

        success, message_id = brevo.send_email(
            recipient.email,
            recipient.name or "There",
            rendered_subject or version.subject,
            rendered_html,
        )
        if not success:
            brevo.delete_contact(recipient.email)
            self._mark_failed(
                session,
                recipient,
                batch,
                contact,
                f"Send Email Failed: {message_id}",
            )
            return

        recipient.status = "sent"
        recipient.message_id = message_id
        recipient.error_message = None
        recipient.delivered_at = datetime.utcnow()
        recipient.updated_at = datetime.utcnow()
        session.add(recipient)

        if contact:
            contact.last_delivery_status = "sent"
            contact.last_delivery_error = f"Message ID: {message_id}"
            contact.updated_at = datetime.utcnow()
            session.add(contact)

        settings.emails_sent_today += 1
        settings.emails_sent_this_hour += 1
        settings.last_run = datetime.utcnow()
        session.add(settings)

        batch.updated_at = datetime.utcnow()
        session.add(batch)
        session.commit()

        sync_batch_status(session, batch)
        brevo.delete_contact(recipient.email)
