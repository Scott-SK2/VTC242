from django.contrib.gis import admin

from .models import PointOfInterest, PricingRule, Zone

admin.site.register(Zone, admin.GISModelAdmin)
admin.site.register(PointOfInterest, admin.GISModelAdmin)
admin.site.register(PricingRule)
