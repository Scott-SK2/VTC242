from django.contrib import admin

from .models import Driver, DriverDocument, Vehicle

admin.site.register(Driver)
admin.site.register(Vehicle)
admin.site.register(DriverDocument)
