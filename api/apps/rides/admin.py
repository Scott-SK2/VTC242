from django.contrib import admin

from .models import ChatMessage, Dispute, Ride, RideEvent, RideOffer, RideRating


@admin.register(Ride)
class RideAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "status",
        "category",
        "passenger",
        "driver",
        "final_price",
        "requested_at",
    )
    list_filter = ("status", "category", "payment_method")


admin.site.register(RideEvent)
admin.site.register(RideOffer)
admin.site.register(RideRating)
admin.site.register(ChatMessage)
admin.site.register(Dispute)
