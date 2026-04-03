from app.queue_runtime import configure_broker

try:
    import dramatiq
except ImportError:  # pragma: no cover - optional until dependency install.
    dramatiq = None

configure_broker()


if dramatiq is not None:

    @dramatiq.actor(max_retries=5, min_backoff=30_000)
    def send_campaign_recipient_task(recipient_id: int) -> None:
        from app.services.delivery_service import process_recipient_delivery

        process_recipient_delivery(recipient_id)

    @dramatiq.actor(max_retries=3, min_backoff=60_000)
    def send_campaign_batch_task(batch_id: int) -> None:
        from app.services.delivery_service import process_batch_delivery

        process_batch_delivery(batch_id)

else:

    def send_campaign_recipient_task(recipient_id: int) -> None:
        from app.services.delivery_service import process_recipient_delivery

        process_recipient_delivery(recipient_id)

    def send_campaign_batch_task(batch_id: int) -> None:
        from app.services.delivery_service import process_batch_delivery

        process_batch_delivery(batch_id)
