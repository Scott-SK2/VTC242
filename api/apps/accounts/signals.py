from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import User


@receiver(post_save, sender=User)
def create_wallet(sender, instance: User, created: bool, **kwargs) -> None:
    if created:
        from apps.payments.models import Wallet

        Wallet.objects.get_or_create(user=instance)
