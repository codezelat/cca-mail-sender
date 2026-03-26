from datetime import datetime
from typing import Optional

from sqlmodel import Session

from app.database import engine
from app.models import CampaignBatch, CampaignRecipient, Contact, EmailTemplateVersion, User
from app.queue_runtime import enqueue_recipient_delivery
from app.redis_runtime import consume_send_capacity, distributed_lock
from app.services.brevo_service import BrevoService
from app.services.import_service import sync_batch_status
from app.services.settings_service import resolve_sender_settings
from app.services.template_service import render_template_html, render_template_version


def _refresh_usage_windows(user: User) -> None:
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
        settings.current_day_window_start = now
        settings.emails_sent_today = 0
    if (now - settings.current_hour_window_start).total_seconds() >= 3600:
        settings.current_hour_window_start = now
        settings.emails_sent_this_hour = 0


def _mark_failed(
    session: Session,
    recipient: CampaignRecipient,
    batch: CampaignBatch,
    contact: Optional[Contact],
    message: str,
) -> None:
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


def _mark_unsubscribed(
    session: Session,
    recipient: CampaignRecipient,
    batch: CampaignBatch,
) -> None:
    recipient.status = "unsubscribed"
    recipient.error_message = "Recipient unsubscribed."
    recipient.updated_at = datetime.utcnow()
    session.add(recipient)
    batch.updated_at = datetime.utcnow()
    session.add(batch)
    session.commit()
    sync_batch_status(session, batch)


def process_recipient_delivery(recipient_id: int) -> None:
    with distributed_lock(f"delivery:recipient:{recipient_id}", ttl_seconds=300) as acquired:
        if not acquired:
            return

        with Session(engine) as session:
            recipient = session.get(CampaignRecipient, recipient_id)
            if not recipient:
                return
            if recipient.status not in {"queued", "processing"}:
                return

            batch = session.get(CampaignBatch, recipient.batch_id)
            user = session.get(User, recipient.user_id)
            version = session.get(EmailTemplateVersion, recipient.template_version_id)
            contact = session.get(Contact, recipient.contact_id) if recipient.contact_id else None

            if not batch or not user or not user.settings or not version:
                if batch:
                    _mark_failed(session, recipient, batch, contact, "Delivery prerequisites are missing.")
                return

            _refresh_usage_windows(user)

            if recipient.status == "queued":
                recipient.status = "processing"
                recipient.attempt_count += 1
                recipient.updated_at = datetime.utcnow()
                batch.status = "processing"
                batch.updated_at = datetime.utcnow()
                session.add(recipient)
                session.add(batch)
                session.add(user.settings)
                session.commit()

            if contact and contact.unsubscribed_at:
                _mark_unsubscribed(session, recipient, batch)
                return

            if not consume_send_capacity(
                user.id or 0,
                user.settings.hourly_limit,
                user.settings.daily_limit,
            ):
                recipient.status = "queued"
                recipient.updated_at = datetime.utcnow()
                session.add(recipient)
                session.commit()
                enqueue_recipient_delivery(recipient.id or 0, delay_ms=60_000)
                return

            effective_settings = resolve_sender_settings(user.settings)
            sender_email = batch.sender_email_snapshot or effective_settings.sender_email
            sender_name = batch.sender_name_snapshot or effective_settings.sender_name
            if not effective_settings.brevo_api_key or not sender_email:
                _mark_failed(session, recipient, batch, contact, "Sender configuration is incomplete.")
                return

            brevo = BrevoService(effective_settings.brevo_api_key, sender_email, sender_name)
            payload = recipient.payload_json or {}
            rendered_html = render_template_version(version, payload, user_id=user.id)
            rendered_subject = render_template_html(version.subject, payload, user_id=user.id).strip()

            success, error = brevo.create_contact(recipient.email, recipient.name or "There")
            if not success:
                _mark_failed(session, recipient, batch, contact, f"Create Contact Failed: {error}")
                return

            success, message_id = brevo.send_email(
                recipient.email,
                recipient.name or "There",
                rendered_subject or version.subject,
                rendered_html,
            )
            if not success:
                brevo.delete_contact(recipient.email)
                _mark_failed(session, recipient, batch, contact, f"Send Email Failed: {message_id}")
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

            user.settings.emails_sent_today += 1
            user.settings.emails_sent_this_hour += 1
            user.settings.last_run = datetime.utcnow()
            session.add(user.settings)

            batch.updated_at = datetime.utcnow()
            session.add(batch)
            session.commit()

            sync_batch_status(session, batch)
            brevo.delete_contact(recipient.email)
