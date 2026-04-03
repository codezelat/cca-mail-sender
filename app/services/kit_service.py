import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests

from app.config import settings

logger = logging.getLogger(__name__)

KIT_API_URL = "https://api.kit.com/v4"
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class KitApiError(RuntimeError):
    pass


class KitSubscriberStateError(KitApiError):
    pass


@dataclass(frozen=True)
class KitSubscriberInfo:
    id: int
    email_address: str
    state: str


@dataclass(frozen=True)
class KitBroadcastStatus:
    broadcast_id: int
    recipients: int
    progress: int
    status: str


class KitService:
    def __init__(
        self,
        api_key: str,
        sender_email: Optional[str],
        sender_name: str,
        email_template_id: int = 0,
    ):
        self.api_key = api_key
        self.sender_email = sender_email
        self.sender_name = sender_name
        self.email_template_id = email_template_id
        self.headers = {
            "accept": "application/json",
            "content-type": "application/json",
            "X-Kit-Api-Key": api_key,
        }

    def _extract_error_message(self, response: requests.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            errors = payload.get("errors")
            if isinstance(errors, list) and errors:
                return "; ".join(str(item) for item in errors)
        return response.text or f"HTTP {response.status_code}"

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
        expected_statuses: tuple[int, ...] = (200,),
        allow_404: bool = False,
    ) -> requests.Response:
        url = f"{KIT_API_URL}{path}"
        delay_seconds = 1.0
        last_error: Optional[str] = None

        for attempt in range(5):
            try:
                response = requests.request(
                    method,
                    url,
                    headers=self.headers,
                    json=json,
                    params=params,
                    timeout=30,
                )
            except requests.RequestException as exc:
                last_error = str(exc)
                if attempt == 4:
                    raise KitApiError(last_error) from exc
                time.sleep(delay_seconds)
                delay_seconds = min(delay_seconds * 2, 10)
                continue

            if allow_404 and response.status_code == 404:
                return response

            if response.status_code in expected_statuses:
                return response

            if response.status_code in RETRYABLE_STATUS_CODES and attempt < 4:
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        delay_seconds = max(float(retry_after), delay_seconds)
                    except ValueError:
                        pass
                time.sleep(delay_seconds)
                delay_seconds = min(delay_seconds * 2, 10)
                continue

            raise KitApiError(self._extract_error_message(response))

        raise KitApiError(last_error or f"Unexpected request failure for {url}")

    def _json(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
        expected_statuses: tuple[int, ...] = (200,),
        allow_404: bool = False,
    ) -> dict[str, Any]:
        response = self._request(
            method,
            path,
            json=json,
            params=params,
            expected_statuses=expected_statuses,
            allow_404=allow_404,
        )
        if response.status_code == 404 and allow_404:
            return {}
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise KitApiError("Kit returned an invalid JSON response.") from exc

    def lookup_subscriber_by_email(self, email: str) -> Optional[KitSubscriberInfo]:
        payload = self._json(
            "GET",
            "/subscribers",
            params={"email_address": email, "status": "all", "per_page": 1},
            expected_statuses=(200,),
        )
        subscribers = payload.get("subscribers") or []
        if not subscribers:
            return None
        subscriber = subscribers[0]
        return KitSubscriberInfo(
            id=int(subscriber["id"]),
            email_address=str(subscriber.get("email_address") or email),
            state=str(subscriber.get("state") or "").lower(),
        )

    def create_or_update_subscriber(
        self,
        email: str,
        first_name: str,
        fields_by_label: dict[str, Any],
    ) -> KitSubscriberInfo:
        payload = {
            "email_address": email,
            "first_name": first_name or None,
            "state": "active",
            "fields": fields_by_label,
        }
        created = self._json(
            "POST",
            "/subscribers",
            json=payload,
            expected_statuses=(200, 201, 202),
        )
        subscriber = created.get("subscriber") or {}
        subscriber_id = subscriber.get("id")
        if not subscriber_id:
            resolved = self.lookup_subscriber_by_email(email)
            if not resolved:
                raise KitApiError(f"Kit subscriber lookup failed for {email}.")
            subscriber_id = resolved.id

        updated = self._json(
            "PUT",
            f"/subscribers/{int(subscriber_id)}",
            json={
                "email_address": email,
                "first_name": first_name or None,
                "fields": fields_by_label,
            },
            expected_statuses=(200, 202),
        )
        updated_subscriber = updated.get("subscriber") or subscriber
        state = str(updated_subscriber.get("state") or subscriber.get("state") or "").lower()
        if state and state != "active":
            raise KitSubscriberStateError(
                f"Kit subscriber {email} is in '{state}' state and cannot be reused for delivery."
            )

        return KitSubscriberInfo(
            id=int(updated_subscriber.get("id") or subscriber_id),
            email_address=str(updated_subscriber.get("email_address") or email),
            state=state or "active",
        )

    def list_custom_fields(self) -> list[dict[str, Any]]:
        payload = self._json("GET", "/custom_fields", params={"per_page": 1000})
        return list(payload.get("custom_fields") or [])

    def ensure_custom_fields(self, labels_by_key: dict[str, str]) -> dict[str, str]:
        fields = self.list_custom_fields()
        existing = {str(field.get("key") or ""): str(field.get("label") or "") for field in fields}
        for key, label in labels_by_key.items():
            if key in existing:
                continue
            created = self._json(
                "POST",
                "/custom_fields",
                json={"label": label},
                expected_statuses=(200, 201),
            )
            custom_field = created.get("custom_field") or {}
            existing[str(custom_field.get("key") or key)] = str(custom_field.get("label") or label)
        return {key: existing[key] for key in labels_by_key if key in existing}

    def create_tag(self, name: str) -> int:
        payload = self._json(
            "POST",
            "/tags",
            json={"name": name},
            expected_statuses=(200, 201),
        )
        tag = payload.get("tag") or {}
        tag_id = tag.get("id")
        if not tag_id:
            raise KitApiError("Kit tag creation returned no id.")
        return int(tag_id)

    def tag_subscriber_by_email(self, tag_id: int, email: str) -> KitSubscriberInfo:
        payload = self._json(
            "POST",
            f"/tags/{tag_id}/subscribers",
            json={"email_address": email},
            expected_statuses=(200, 201),
        )
        subscriber = payload.get("subscriber") or {}
        subscriber_id = subscriber.get("id")
        if not subscriber_id:
            resolved = self.lookup_subscriber_by_email(email)
            if not resolved:
                raise KitApiError(f"Kit tag attachment succeeded but subscriber id was unavailable for {email}.")
            return resolved
        return KitSubscriberInfo(
            id=int(subscriber_id),
            email_address=str(subscriber.get("email_address") or email),
            state=str(subscriber.get("state") or "").lower() or "active",
        )

    def remove_tag_from_subscriber(self, tag_id: int, subscriber_id: int) -> None:
        self._request(
            "DELETE",
            f"/tags/{tag_id}/subscribers/{subscriber_id}",
            expected_statuses=(204,),
            allow_404=True,
        )

    def unsubscribe_subscriber(self, subscriber_id: int) -> None:
        self._request(
            "POST",
            f"/subscribers/{subscriber_id}/unsubscribe",
            json={},
            expected_statuses=(204,),
            allow_404=True,
        )

    def list_email_templates(self) -> list[dict[str, Any]]:
        payload = self._json("GET", "/email_templates", params={"per_page": 1000})
        return list(payload.get("email_templates") or [])

    def resolve_email_template_id(self) -> int:
        if self.email_template_id > 0:
            return self.email_template_id

        templates = self.list_email_templates()
        html_templates = [
            template for template in templates if str(template.get("category") or "").lower() == "html"
        ]
        for candidate in html_templates:
            if bool(candidate.get("is_default")):
                return int(candidate["id"])
        if html_templates:
            return int(html_templates[0]["id"])
        for candidate in templates:
            if bool(candidate.get("is_default")):
                return int(candidate["id"])
        if templates:
            return int(templates[0]["id"])
        raise KitApiError("No Kit email templates are available for this account.")

    def create_broadcast(
        self,
        *,
        subject: str,
        preview_text: str,
        html_content: str,
        tag_id: int,
        description: str,
    ) -> int:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        send_at = now + timedelta(seconds=5)
        payload = {
            "email_template_id": self.resolve_email_template_id(),
            "email_address": self.sender_email or None,
            "content": html_content,
            "description": description,
            "public": False,
            "published_at": now.isoformat(),
            "send_at": send_at.isoformat(),
            "thumbnail_alt": None,
            "thumbnail_url": None,
            "preview_text": preview_text or " ",
            "subject": subject,
            "subscriber_filter": [
                {
                    "all": [{"type": "tag", "ids": [tag_id]}],
                    "any": None,
                    "none": None,
                }
            ],
        }
        response = self._json(
            "POST",
            "/broadcasts",
            json=payload,
            expected_statuses=(201,),
        )
        broadcast = response.get("broadcast") or {}
        broadcast_id = broadcast.get("id")
        if not broadcast_id:
            raise KitApiError("Kit broadcast creation returned no id.")
        return int(broadcast_id)

    def get_broadcast_status(self, broadcast_id: int) -> KitBroadcastStatus:
        payload = self._json(
            "GET",
            f"/broadcasts/{broadcast_id}/stats",
            expected_statuses=(200,),
        )
        broadcast = payload.get("broadcast") or {}
        stats = broadcast.get("stats") or {}
        return KitBroadcastStatus(
            broadcast_id=broadcast_id,
            recipients=int(stats.get("recipients") or 0),
            progress=int(stats.get("progress") or 0),
            status=str(stats.get("status") or "").lower(),
        )

    def wait_for_broadcast_delivery(
        self,
        broadcast_id: int,
        *,
        timeout_seconds: Optional[int] = None,
        poll_interval_seconds: Optional[int] = None,
    ) -> KitBroadcastStatus:
        timeout_seconds = timeout_seconds or max(settings.kit_broadcast_timeout_seconds, 30)
        poll_interval_seconds = poll_interval_seconds or max(
            settings.kit_broadcast_poll_interval_seconds, 2
        )
        deadline = time.monotonic() + timeout_seconds

        while True:
            status = self.get_broadcast_status(broadcast_id)
            if status.status == "published" or status.progress >= 100:
                return status
            if time.monotonic() >= deadline:
                raise KitApiError(
                    f"Timed out while waiting for Kit broadcast {broadcast_id} to complete. Last status: {status.status or 'unknown'}."
                )
            time.sleep(poll_interval_seconds)

    def delete_broadcast(self, broadcast_id: int) -> None:
        self._request(
            "DELETE",
            f"/broadcasts/{broadcast_id}",
            expected_statuses=(204,),
            allow_404=True,
        )
