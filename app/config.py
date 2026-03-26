import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


@dataclass(frozen=True)
class AppSettings:
    app_name: str
    secret_key: str
    jwt_algorithm: str
    access_token_expire_minutes: int
    refresh_token_expire_days: int
    database_url: str
    redis_url: str
    web_origin: str
    public_base_url: str
    secure_cookies: bool
    queue_backend: str
    brevo_smtp_api_key: str
    sender_email: str
    sender_name: str


def load_settings() -> AppSettings:
    sqlite_default = "sqlite:///data/app.db"
    public_base_url = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
    redis_url = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    queue_backend = os.getenv("QUEUE_BACKEND", "dramatiq").strip().lower()
    return AppSettings(
        app_name=os.getenv("APP_NAME", "CCA Campaign Manager"),
        secret_key=os.getenv("SECRET_KEY", "supersecretkey"),
        jwt_algorithm=os.getenv("JWT_ALGORITHM", "HS256"),
        access_token_expire_minutes=_env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 15),
        refresh_token_expire_days=_env_int("REFRESH_TOKEN_EXPIRE_DAYS", 30),
        database_url=os.getenv("DATABASE_URL", sqlite_default),
        redis_url=redis_url,
        web_origin=os.getenv("WEB_ORIGIN", "http://127.0.0.1:3000").rstrip("/"),
        public_base_url=public_base_url,
        secure_cookies=_env_bool("SECURE_COOKIES", False),
        queue_backend=queue_backend,
        brevo_smtp_api_key=os.getenv("BREVO_SMTP_API_KEY", "").strip(),
        sender_email=os.getenv("SENDER_EMAIL", "").strip(),
        sender_name=os.getenv("SENDER_NAME", "").strip(),
    )


settings = load_settings()
