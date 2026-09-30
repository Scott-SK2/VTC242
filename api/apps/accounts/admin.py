from django.contrib import admin

from .models import OtpCode, PushSubscription, User


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("phone_number", "first_name", "last_name", "role", "is_active", "created_at")
    search_fields = ("phone_number", "first_name", "last_name")
    list_filter = ("role", "is_active")


admin.site.register(OtpCode)
admin.site.register(PushSubscription)
