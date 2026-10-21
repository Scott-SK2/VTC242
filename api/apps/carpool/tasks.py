from celery import shared_task


@shared_task(name="carpool.expire_trips")
def expire_trips() -> int:
    from . import services

    return services.expire_trips()
