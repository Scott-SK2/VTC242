from celery import shared_task


@shared_task(name="rentals.expire_requests")
def expire_requests() -> int:
    from . import services

    return services.expire_requests()
