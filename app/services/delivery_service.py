from datetime import datetime
from typing import Optional

from sqlmodel import Session, select

from app.config import settings
from app.database import engine
from app.models import CampaignBatch, CampaignRecipient, Contact, EmailTemplateVersion, User
from app.queue_runtime import enqueue_batch_delivery, enqueue_recipient_delivery
from app.redis_runtime import consume_send_capacity, distributed_lock
from app.services.brevo_service import BrevoService
from app.services.import_service import sync_batch_status
from app.services.kit_service import KitApiError, KitService, KitSubscriberStateError
from app.services.settings_service import resolve_sender_settings
from app.services.template_service import (
    build_provider_payload,
    compile_template_content,
    convert_template_source_to_kit_liquid,
    ensure_schema,
    render_template_html,
    render_template_version,
)


def _refresh_usage_windows(user: User) -> None:
    settings_obj = user.settings
    if not settings_obj:
        return

    now = datetime.utcnow()
    if not settings_obj.current_day_window_start:
        settings_obj.current_day_window_start = now
        settings_obj.emails_sent_today = 0
    if not settings_obj.current_hour_window_start:
        settings_obj.current_hour_window_start = now
        settings_obj.emails_sent_this_hour = 0

    if now.date() > settings_obj.current_day_window_start.date():
        settings_obj.current_day_window_start = now
        settings_obj.emails_sent_today = 0
    if (now - settings_obj.current_hour_window_start).total_seconds() >= 3600:
        settings_obj.current_hour_window_start = now
        settings_obj.emails_sent_this_hour = 0


def _batch_provider(batch: Optional[CampaignBatch], user: Optional[User]) -> str:
    batch_payload = batch.launch_summary_json or {} if batch else {}
    provider = str(batch_payload.get("delivery_provider") or "").strip().lower()
    if provider in {"brevo", "kit"}:
        return provider
    if user and user.settings:
        resolved = resolve_sender_settings(user.settings)
        return resolved.provider
    return settings.email_provider if settings.email_provider in {"brevo", "kit"} else "brevo"


def _update_batch_metadata(batch: CampaignBatch, **changes: object) -> None:
    metadata = dict(batch.launch_summary_json or {})
    metadata.update(changes)
    batch.launch_summary_json = metadata
    batch.updated_at = datetime.utcnow()


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

            if _batch_provider(batch, user) == "kit":
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
            if not effective_settings.provider_api_key or not sender_email:
                _mark_failed(session, recipient, batch, contact, "Sender configuration is incomplete.")
                return

            brevo = BrevoService(effective_settings.provider_api_key, sender_email, sender_name)
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


def _cleanup_kit_delivery(
    kit: KitService,
    *,
    subscriber_ids: list[int],
    tag_id: Optional[int],
    broadcast_id: Optional[int],
) -> None:
    if tag_id:
        for subscriber_id in subscriber_ids:
            try:
                kit.remove_tag_from_subscriber(tag_id, subscriber_id)
            except KitApiError:
                continue
    for subscriber_id in subscriber_ids:
        try:
            kit.unsubscribe_subscriber(subscriber_id)
        except KitApiError:
            continue
    if broadcast_id:
        try:
            kit.delete_broadcast(broadcast_id)
        except KitApiError:
            pass


def process_batch_delivery(batch_id: int) -> None:
    with distributed_lock(f"delivery:batch:{batch_id}", ttl_seconds=1800) as acquired:
        if not acquired:
            return

        with Session(engine) as session:
            batch = session.get(CampaignBatch, batch_id)
            if not batch:
                return

            recipients = session.exec(
                select(CampaignRecipient)
                .where(CampaignRecipient.batch_id == batch.id)
                .order_by(CampaignRecipient.created_at.asc())
            ).all()
            if not recipients:
                return

            user = session.get(User, batch.user_id)
            version = session.get(EmailTemplateVersion, batch.template_version_id)
            if not user or not user.settings or not version:
                for recipient in recipients:
                    if recipient.status in {"queued", "processing"}:
                        contact = session.get(Contact, recipient.contact_id) if recipient.contact_id else None
                        _mark_failed(session, recipient, batch, contact, "Delivery prerequisites are missing.")
                return

            if _batch_provider(batch, user) != "kit":
                return

            _refresh_usage_windows(user)

            effective_settings = resolve_sender_settings(user.settings)
            sender_email = batch.sender_email_snapshot or effective_settings.sender_email
            sender_name = batch.sender_name_snapshot or effective_settings.sender_name
            if not effective_settings.provider_api_key or not sender_email:
                for recipient in recipients:
                    if recipient.status in {"queued", "processing"}:
                        contact = session.get(Contact, recipient.contact_id) if recipient.contact_id else None
                        _mark_failed(session, recipient, batch, contact, "Sender configuration is incomplete.")
                return

            contacts_by_id = {
                contact.id: contact
                for contact in session.exec(
                    select(Contact).where(Contact.id.in_([r.contact_id for r in recipients if r.contact_id]))
                ).all()
                if contact.id is not None
            }

            eligible_recipients: list[CampaignRecipient] = []
            for recipient in recipients:
                if recipient.status not in {"queued", "processing"}:
                    continue
                contact = contacts_by_id.get(recipient.contact_id) if recipient.contact_id else None
                if contact and contact.unsubscribed_at:
                    recipient.status = "unsubscribed"
                    recipient.error_message = "Recipient unsubscribed."
                    recipient.updated_at = datetime.utcnow()
                    session.add(recipient)
                    continue
                recipient.status = "processing"
                recipient.attempt_count += 1
                recipient.updated_at = datetime.utcnow()
                session.add(recipient)
                eligible_recipients.append(recipient)

            if not eligible_recipients:
                batch.updated_at = datetime.utcnow()
                session.add(batch)
                session.commit()
                sync_batch_status(session, batch)
                return

            batch.status = "processing"
            batch.updated_at = datetime.utcnow()
            session.add(batch)
            session.commit()

            hour_remaining = max(user.settings.hourly_limit - user.settings.emails_sent_this_hour, 0)
            day_remaining = max(user.settings.daily_limit - user.settings.emails_sent_today, 0)
            allowed_count = min(hour_remaining, day_remaining, len(eligible_recipients))
            if allowed_count <= 0:
                for recipient in eligible_recipients:
                    recipient.status = "queued"
                    recipient.updated_at = datetime.utcnow()
                    session.add(recipient)
                batch.status = "queued"
                batch.updated_at = datetime.utcnow()
                session.add(batch)
                session.commit()
                enqueue_batch_delivery(batch.id or 0, delay_ms=60_000)
                return

            queued_for_later = eligible_recipients[allowed_count:]
            eligible_recipients = eligible_recipients[:allowed_count]
            for recipient in queued_for_later:
                recipient.status = "queued"
                recipient.updated_at = datetime.utcnow()
                session.add(recipient)
            session.commit()

            kit = KitService(
                effective_settings.provider_api_key,
                sender_email,
                sender_name,
                email_template_id=settings.kit_email_template_id,
            )

            schema = ensure_schema(version.merge_fields_schema)
            labels_by_key = {
                field["key"]: field["label"]
                for field in schema
                if field["key"] not in {"email", "first_name"}
            }
            field_labels = kit.ensure_custom_fields(labels_by_key)

            compiled_html = version.compiled_html or compile_template_content(
                version.editor_mode,
                version.design_json,
                version.html_source,
                version.preheader,
            )
            html_template = convert_template_source_to_kit_liquid(compiled_html, html_mode=True)
            subject_template = convert_template_source_to_kit_liquid(version.subject, html_mode=False)
            preview_template = convert_template_source_to_kit_liquid(version.preheader or " ", html_mode=False)

            tag_name = f"CCA Temp Delivery Batch {batch.id}"
            tag_id = int((batch.launch_summary_json or {}).get("kit_tag_id") or 0) or kit.create_tag(tag_name)
            _update_batch_metadata(batch, delivery_provider="kit", kit_tag_id=tag_id)
            session.add(batch)
            session.commit()

            staged_subscribers: list[tuple[CampaignRecipient, Optional[Contact], int]] = []

            for recipient in eligible_recipients:
                contact = contacts_by_id.get(recipient.contact_id) if recipient.contact_id else None
                payload = build_provider_payload(
                    recipient.payload_json or {},
                    user_id=user.id,
                    email=recipient.email,
                )
                fields_by_label = {
                    label: str(payload.get(key) or "")
                    for key, label in field_labels.items()
                }
                try:
                    subscriber = kit.create_or_update_subscriber(
                        recipient.email,
                        str(payload.get("first_name") or payload.get("name") or "There"),
                        fields_by_label,
                    )
                    tagged = kit.tag_subscriber_by_email(tag_id, recipient.email)
                except KitSubscriberStateError as exc:
                    recipient.status = "failed"
                    recipient.error_message = str(exc)
                    recipient.updated_at = datetime.utcnow()
                    session.add(recipient)
                    if contact:
                        contact.last_delivery_status = "failed"
                        contact.last_delivery_error = str(exc)
                        contact.updated_at = datetime.utcnow()
                        session.add(contact)
                    continue
                except KitApiError as exc:
                    recipient.status = "failed"
                    recipient.error_message = f"Kit setup failed: {exc}"
                    recipient.updated_at = datetime.utcnow()
                    session.add(recipient)
                    if contact:
                        contact.last_delivery_status = "failed"
                        contact.last_delivery_error = str(exc)
                        contact.updated_at = datetime.utcnow()
                        session.add(contact)
                    continue

                staged_subscribers.append((recipient, contact, tagged.id or subscriber.id))

            session.commit()

            if not staged_subscribers:
                sync_batch_status(session, batch)
                return

            broadcast_id: Optional[int] = None
            try:
                broadcast_id = kit.create_broadcast(
                    subject=subject_template or version.subject,
                    preview_text=preview_template or " ",
                    html_content=html_template,
                    tag_id=tag_id,
                    description=f"CCA batch {batch.id}: {batch.name}",
                )
                _update_batch_metadata(batch, kit_broadcast_id=broadcast_id)
                session.add(batch)
                session.commit()

                broadcast_status = kit.wait_for_broadcast_delivery(broadcast_id)
            except KitApiError as exc:
                _update_batch_metadata(batch, kit_last_error=str(exc))
                session.add(batch)
                for recipient, contact, _subscriber_id in staged_subscribers:
                    if recipient.status == "processing":
                        recipient.status = "failed"
                        recipient.error_message = f"Kit delivery failed: {exc}"
                        recipient.updated_at = datetime.utcnow()
                        session.add(recipient)
                        if contact:
                            contact.last_delivery_status = "failed"
                            contact.last_delivery_error = str(exc)
                            contact.updated_at = datetime.utcnow()
                            session.add(contact)
                session.commit()
                sync_batch_status(session, batch)
                if broadcast_id is None:
                    _cleanup_kit_delivery(
                        kit,
                        subscriber_ids=[subscriber_id for _r, _c, subscriber_id in staged_subscribers],
                        tag_id=tag_id,
                        broadcast_id=None,
                    )
                return

            delivered_count = broadcast_status.recipients or len(staged_subscribers)
            delivered_count = min(delivered_count, len(staged_subscribers))
            now = datetime.utcnow()
            sent_subscriber_ids: list[int] = []

            for recipient, contact, subscriber_id in staged_subscribers[:delivered_count]:
                if recipient.status != "processing":
                    continue
                sent_subscriber_ids.append(subscriber_id)
                recipient.status = "sent"
                recipient.message_id = f"kit:broadcast:{broadcast_id}"
                recipient.error_message = None
                recipient.delivered_at = now
                recipient.updated_at = now
                session.add(recipient)
                if contact:
                    contact.last_delivery_status = "sent"
                    contact.last_delivery_error = f"Kit broadcast {broadcast_id}"
                    contact.updated_at = now
                    session.add(contact)

            for recipient, contact, _subscriber_id in staged_subscribers[delivered_count:]:
                if recipient.status != "processing":
                    continue
                recipient.status = "failed"
                recipient.error_message = "Kit did not report this recipient as delivered."
                recipient.updated_at = now
                session.add(recipient)
                if contact:
                    contact.last_delivery_status = "failed"
                    contact.last_delivery_error = "Kit did not report this recipient as delivered."
                    contact.updated_at = now
                    session.add(contact)

            user.settings.emails_sent_today += delivered_count
            user.settings.emails_sent_this_hour += delivered_count
            user.settings.last_run = now
            session.add(user.settings)

            _update_batch_metadata(
                batch,
                kit_broadcast_id=broadcast_id,
                kit_broadcast_status=broadcast_status.status,
                kit_broadcast_progress=broadcast_status.progress,
                kit_broadcast_recipients=broadcast_status.recipients,
            )
            session.add(batch)
            session.commit()
            sync_batch_status(session, batch)

            _cleanup_kit_delivery(
                kit,
                subscriber_ids=[subscriber_id for _r, _c, subscriber_id in staged_subscribers],
                tag_id=tag_id,
                broadcast_id=broadcast_id,
            )
            if queued_for_later:
                enqueue_batch_delivery(batch.id or 0, delay_ms=60_000)
