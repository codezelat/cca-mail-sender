from dataclasses import dataclass
from typing import Any, Optional

from app.config import settings
from app.models import UserSettings

DEFAULT_HOURLY_LIMIT = 20
DEFAULT_DAILY_LIMIT = 300
DEFAULT_SENDER_NAME = "Sender"


def _clean(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


@dataclass(frozen=True)
class EffectiveSenderSettings:
    brevo_api_key: Optional[str]
    sender_email: Optional[str]
    sender_name: str
    hourly_limit: int
    daily_limit: int
    use_env_brevo_api_key: bool
    use_env_sender_identity: bool
    env_has_brevo_api_key: bool
    env_has_sender_identity: bool
    has_manual_brevo_api_key: bool
    manual_sender_email: Optional[str]
    manual_sender_name: Optional[str]


def resolve_sender_settings(user_settings: Optional[UserSettings]) -> EffectiveSenderSettings:
    env_brevo_api_key = _clean(settings.brevo_smtp_api_key)
    env_sender_email = _clean(settings.sender_email)
    env_sender_name = _clean(settings.sender_name)

    manual_brevo_api_key = _clean(user_settings.brevo_api_key if user_settings else None)
    manual_sender_email = _clean(user_settings.sender_email if user_settings else None)
    manual_sender_name = _clean(user_settings.sender_name if user_settings else None)

    env_has_brevo_api_key = bool(env_brevo_api_key)
    env_has_sender_identity = bool(env_sender_email)

    requested_env_brevo = bool(user_settings.use_env_brevo_api_key) if user_settings else False
    requested_env_sender = bool(user_settings.use_env_sender_identity) if user_settings else False

    active_env_brevo = env_has_brevo_api_key and (
        requested_env_brevo or manual_brevo_api_key is None
    )
    active_env_sender = env_has_sender_identity and (
        requested_env_sender or manual_sender_email is None
    )

    effective_brevo_api_key = env_brevo_api_key if active_env_brevo else manual_brevo_api_key
    effective_sender_email = env_sender_email if active_env_sender else manual_sender_email
    effective_sender_name = (
        env_sender_name
        if active_env_sender and env_sender_name
        else manual_sender_name or env_sender_name or DEFAULT_SENDER_NAME
    )

    return EffectiveSenderSettings(
        brevo_api_key=effective_brevo_api_key,
        sender_email=effective_sender_email,
        sender_name=effective_sender_name,
        hourly_limit=user_settings.hourly_limit if user_settings else DEFAULT_HOURLY_LIMIT,
        daily_limit=user_settings.daily_limit if user_settings else DEFAULT_DAILY_LIMIT,
        use_env_brevo_api_key=active_env_brevo,
        use_env_sender_identity=active_env_sender,
        env_has_brevo_api_key=env_has_brevo_api_key,
        env_has_sender_identity=env_has_sender_identity,
        has_manual_brevo_api_key=bool(manual_brevo_api_key),
        manual_sender_email=manual_sender_email,
        manual_sender_name=manual_sender_name,
    )


def serialize_user_settings(user_settings: Optional[UserSettings]) -> dict[str, Any]:
    resolved = resolve_sender_settings(user_settings)
    return {
        "brevo_api_key": "",
        "sender_email": resolved.manual_sender_email or "",
        "sender_name": resolved.manual_sender_name or "",
        "hourly_limit": resolved.hourly_limit,
        "daily_limit": resolved.daily_limit,
        "default_template_id": user_settings.default_template_id if user_settings else None,
        "use_env_brevo_api_key": resolved.use_env_brevo_api_key,
        "use_env_sender_identity": resolved.use_env_sender_identity,
        "clear_manual_brevo_api_key": False,
        "has_manual_brevo_api_key": resolved.has_manual_brevo_api_key,
        "env_has_brevo_api_key": resolved.env_has_brevo_api_key,
        "env_has_sender_identity": resolved.env_has_sender_identity,
        "effective_brevo_api_key_configured": bool(resolved.brevo_api_key),
        "effective_sender_email": resolved.sender_email or "",
        "effective_sender_name": resolved.sender_name,
    }
