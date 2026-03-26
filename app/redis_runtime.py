import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from app.config import settings

try:
    import redis
except ImportError:  # pragma: no cover - optional until dependency install.
    redis = None

_redis_client = None


def get_redis_client():
    global _redis_client
    if redis is None:
        return None
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
        )
    return _redis_client


@contextmanager
def distributed_lock(key: str, ttl_seconds: int = 60) -> Iterator[bool]:
    client = get_redis_client()
    if client is None:
        yield True
        return

    token = uuid.uuid4().hex
    acquired = bool(client.set(key, token, ex=ttl_seconds, nx=True))
    if not acquired:
        yield False
        return
    try:
        yield True
    finally:
        if client.get(key) == token:
            client.delete(key)


def _window_keys(user_id: int) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    hour_key = f"send-limit:{user_id}:hour:{now.strftime('%Y%m%d%H')}"
    day_key = f"send-limit:{user_id}:day:{now.strftime('%Y%m%d')}"
    return hour_key, day_key


def consume_send_capacity(user_id: int, hourly_limit: int, daily_limit: int) -> bool:
    client = get_redis_client()
    if client is None:
        return True

    hour_key, day_key = _window_keys(user_id)
    pipe = client.pipeline()
    pipe.incr(hour_key)
    pipe.expire(hour_key, 60 * 60 + 60)
    pipe.incr(day_key)
    pipe.expire(day_key, 60 * 60 * 24 + 60)
    hour_count, _hour_expiry, day_count, _day_expiry = pipe.execute()

    if hour_count > hourly_limit or day_count > daily_limit:
        rollback = client.pipeline()
        rollback.decr(hour_key)
        rollback.decr(day_key)
        rollback.execute()
        return False
    return True


def cache_json(key: str, value: Any, ttl_seconds: int = 60) -> None:
    client = get_redis_client()
    if client is None:
        return
    client.setex(key, ttl_seconds, json.dumps(value))


def get_cached_json(key: str) -> Optional[Any]:
    client = get_redis_client()
    if client is None:
        return None
    payload = client.get(key)
    if not payload:
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def increment_counter(key: str, ttl_seconds: int) -> int:
    client = get_redis_client()
    if client is None:
        return 0
    pipe = client.pipeline()
    pipe.incr(key)
    pipe.expire(key, ttl_seconds)
    count, _ = pipe.execute()
    return int(count)


def delete_key(key: str) -> None:
    client = get_redis_client()
    if client is None:
        return
    client.delete(key)
