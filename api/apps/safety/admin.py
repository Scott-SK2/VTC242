from django.contrib import admin

from .models import Alert, EmergencyCall, RouteDeviation

admin.site.register(Alert)
admin.site.register(EmergencyCall)
admin.site.register(RouteDeviation)
