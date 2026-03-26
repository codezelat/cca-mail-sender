from app.config import settings

try:
    import dramatiq
    from dramatiq.brokers.redis import RedisBroker
except ImportError:  # pragma: no cover - optional until dependency install.
    dramatiq = None
    RedisBroker = None

_broker_configured = False


def configure_broker() -> None:
    global _broker_configured
    if _broker_configured or dramatiq is None or RedisBroker is None:
        return
    broker = RedisBroker(url=settings.redis_url)
    dramatiq.set_broker(broker)
    _broker_configured = True


def enqueue_recipient_delivery(recipient_id: int, delay_ms: int = 0) -> None:
    if settings.queue_backend == "dramatiq" and dramatiq is not None:
        configure_broker()
        from app.tasks import send_campaign_recipient_task

        if delay_ms:
            send_campaign_recipient_task.send_with_options(args=(recipient_id,), delay=delay_ms)
        else:
            send_campaign_recipient_task.send(recipient_id)
        return

    from app.services.delivery_service import process_recipient_delivery

    process_recipient_delivery(recipient_id)
