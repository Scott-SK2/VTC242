"""Jeu de données de démo (section 11.3) : zone Brazzaville, tarifs, POI, comptes de test."""

from __future__ import annotations

from decimal import Decimal

from django.contrib.gis.geos import MultiPolygon, Polygon
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.accounts.models import User, UserRole
from apps.common.geo import point
from apps.drivers.models import (
    DocumentStatus,
    DocumentType,
    Driver,
    DriverDocument,
    DriverStatus,
    Vehicle,
)
from apps.geo.models import PointOfInterest, PricingRule, VehicleCategory, Zone
from apps.payments import services as payments

# Enveloppe approximative de Brazzaville (lng, lat)
BRAZZAVILLE = [
    (15.10, -4.10),
    (15.40, -4.10),
    (15.42, -4.20),
    (15.38, -4.36),
    (15.22, -4.40),
    (15.10, -4.32),
    (15.08, -4.20),
    (15.10, -4.10),
]

POIS = [
    ("Marché Total", ["Total", "Marché Total Bacongo"], -4.2833, 15.2583, "Bacongo"),
    ("Aéroport Maya-Maya", ["Maya Maya", "aéroport"], -4.2517, 15.2531, "Brazzaville"),
    ("Gare centrale", ["gare CFCO", "gare"], -4.2694, 15.2842, "Centre-ville"),
    ("Tour Nabemba", ["Nabemba"], -4.2733, 15.2914, "Centre-ville"),
    ("Basilique Sainte-Anne", ["Sainte Anne", "basilique"], -4.2611, 15.2764, "Poto-Poto"),
    ("Marché de Poto-Poto", ["Poto-Poto"], -4.2600, 15.2800, "Poto-Poto"),
    ("Université Marien Ngouabi", ["UMNG", "université"], -4.2778, 15.2681, "Centre-ville"),
    ("Stade Alphonse Massamba-Débat", ["stade", "Massamba Debat"], -4.2867, 15.2650, "Makélékélé"),
    ("Hôpital général de Loandjili", [], -4.2600, 15.2900, "Ouenzé"),
    ("Marché de Moungali", ["Moungali"], -4.2500, 15.2750, "Moungali"),
    ("Talangaï", ["Talangai"], -4.2300, 15.2900, "Talangaï"),
    ("Mfilou", [], -4.2700, 15.2200, "Mfilou"),
    ("Kinsoundi", [], -4.3000, 15.2400, "Makélékélé"),
    ("Pont du Djoué", ["Djoué"], -4.3100, 15.2200, "Djoué"),
    ("Centre commercial Casino", ["Casino", "supermarché"], -4.2650, 15.2870, "Centre-ville"),
]

PRICING = {
    # category: (base, per_km, per_min, minimum, free_wait_s, wait/min,
    #            cancel_fee, commission, cash)
    VehicleCategory.TAXI: (500, 250, 25, 1000, 180, 50, 500, "0.10", True),
    VehicleCategory.STANDARD: (700, 300, 30, 1500, 180, 50, 500, "0.15", True),
    VehicleCategory.VIP: (1500, 500, 50, 3000, 300, 100, 1000, "0.15", False),
    VehicleCategory.WEDDING: (20000, 500, 0, 50000, 600, 0, 5000, "0.15", False),
    VehicleCategory.MOVING: (3000, 500, 40, 5000, 600, 100, 1000, "0.15", True),
}

DRIVERS = [
    (
        "+242061000001",
        "Jean",
        "Mabiala",
        "taxi",
        "Toyota",
        "Corolla",
        "Vert",
        "BZV 1234 A",
        "T-0412",
        -4.2650,
        15.2800,
    ),
    (
        "+242061000002",
        "Patrick",
        "Nkouka",
        "standard",
        "Hyundai",
        "Accent",
        "Blanc",
        "BZV 5678 B",
        None,
        -4.2700,
        15.2700,
    ),
    (
        "+242061000003",
        "Aline",
        "Okemba",
        "vip",
        "Mercedes",
        "Classe E",
        "Noir",
        "BZV 9012 C",
        None,
        -4.2600,
        15.2900,
    ),
    (
        "+242061000004",
        "Rodrigue",
        "Bouanga",
        "taxi",
        "Toyota",
        "Yaris",
        "Vert",
        "BZV 3456 D",
        "T-0777",
        -4.2800,
        15.2600,
    ),
    (
        "+242061000005",
        "Serge",
        "Malonga",
        "moving",
        "Kia",
        "K2700",
        "Blanc",
        "BZV 7890 E",
        None,
        -4.2550,
        15.2650,
    ),
]


class Command(BaseCommand):
    help = "Crée la zone Brazzaville, la grille tarifaire, des POI et des comptes de démonstration."

    def handle(self, *args, **options):
        zone, _ = Zone.objects.update_or_create(
            name="Brazzaville",
            defaults={
                "city": "Brazzaville",
                "polygon": MultiPolygon(Polygon(BRAZZAVILLE), srid=4326),
                "emergency_police": "117",
                "emergency_fire": "118",
                "cash_enabled": True,
                "deviation_threshold_m": 300,
                "deviation_hits": 3,
                "is_active": True,
            },
        )
        for category, (base, km, mn, minimum, fw, wpm, cancel, comm, cash) in PRICING.items():
            if not PricingRule.objects.filter(zone=zone, category=category).exists():
                PricingRule.objects.create(
                    zone=zone,
                    category=category,
                    base_fare=base,
                    per_km=km,
                    per_minute=mn,
                    minimum_fare=minimum,
                    free_waiting_seconds=fw,
                    waiting_per_minute=wpm,
                    cancellation_fee=cancel,
                    commission_rate=Decimal(comm),
                    cash_enabled=cash,
                    effective_from=timezone.now() - timezone.timedelta(days=1),
                )
        for name, aliases, lat, lng, secondary in POIS:
            PointOfInterest.objects.update_or_create(
                name=name,
                defaults={
                    "aliases": aliases,
                    "location": point(lat, lng),
                    "zone": zone,
                    "secondary": secondary,
                },
            )

        admin, _ = User.objects.update_or_create(
            phone_number="+242060000001",
            defaults={
                "first_name": "Admin",
                "last_name": "VTC",
                "role": UserRole.ADMIN,
                "is_superuser": True,
            },
        )
        User.objects.update_or_create(
            phone_number="+242060000002",
            defaults={"first_name": "Fatou", "last_name": "Finance", "role": UserRole.FINANCE},
        )
        User.objects.update_or_create(
            phone_number="+242060000003",
            defaults={"first_name": "Sam", "last_name": "Support", "role": UserRole.SUPPORT},
        )

        passenger, _ = User.objects.update_or_create(
            phone_number="+242069000001",
            defaults={"first_name": "Scott", "last_name": "Kula", "role": UserRole.PASSENGER},
        )
        User.objects.update_or_create(
            phone_number="+242069000002",
            defaults={"first_name": "Grace", "last_name": "Mouanda", "role": UserRole.PASSENGER},
        )
        for p in (passenger,):
            wallet = payments.get_wallet(p)
            if wallet.balance == 0:
                payments.adjust(p, Decimal("25000"), "Crédit de démonstration")

        for phone, first, last, cat, brand, model, color, plate, taxi_no, lat, lng in DRIVERS:
            user, _ = User.objects.update_or_create(
                phone_number=phone,
                defaults={"first_name": first, "last_name": last, "role": UserRole.DRIVER},
            )
            driver, _ = Driver.objects.update_or_create(
                user=user,
                defaults={
                    "status": DriverStatus.APPROVED,
                    "license_number": f"CG-{phone[-4:]}",
                    "zone": zone,
                    "current_location": point(lat, lng),
                    "last_location_at": timezone.now(),
                },
            )
            vehicle, _ = Vehicle.objects.update_or_create(
                license_plate=plate,
                defaults={
                    "driver": driver,
                    "brand": brand,
                    "model": model,
                    "color": color,
                    "category": cat,
                    "taxi_number": taxi_no,
                    "seats": 4,
                    "is_verified": True,
                },
            )
            driver.active_vehicle = vehicle
            driver.save(update_fields=["active_vehicle"])
            for doc_type in (
                DocumentType.LICENSE,
                DocumentType.REGISTRATION,
                DocumentType.INSURANCE,
                DocumentType.ID_CARD,
                DocumentType.PROFILE_PHOTO,
                DocumentType.VEHICLE_PHOTO,
            ):
                if not driver.documents.filter(type=doc_type).exists():
                    DriverDocument.objects.create(
                        driver=driver,
                        type=doc_type,
                        file_url=f"https://placehold.co/600x400?text={doc_type}",
                        status=DocumentStatus.APPROVED,
                        reviewed_by=admin,
                    )
            if cat == "taxi" and not driver.documents.filter(type=DocumentType.TAXI_CARD).exists():
                DriverDocument.objects.create(
                    driver=driver,
                    type=DocumentType.TAXI_CARD,
                    file_url="https://placehold.co/600x400?text=taxi_card",
                    status=DocumentStatus.APPROVED,
                    reviewed_by=admin,
                )
            wallet = payments.get_wallet(user)
            if wallet.balance == 0:
                payments.adjust(user, Decimal("5000"), "Crédit de démonstration")

        # chauffeur en attente de validation (file du back-office)
        pending_user, _ = User.objects.update_or_create(
            phone_number="+242061000009",
            defaults={"first_name": "Nadège", "last_name": "Ibara", "role": UserRole.DRIVER},
        )
        pending, _ = Driver.objects.update_or_create(
            user=pending_user, defaults={"status": DriverStatus.PENDING, "zone": zone}
        )
        if not pending.vehicles.exists():
            v = Vehicle.objects.create(
                driver=pending,
                brand="Suzuki",
                model="Swift",
                color="Rouge",
                license_plate="BZV 0001 Z",
                category="standard",
            )
            pending.active_vehicle = v
            pending.save(update_fields=["active_vehicle"])
        for doc_type in (
            DocumentType.LICENSE,
            DocumentType.REGISTRATION,
            DocumentType.INSURANCE,
            DocumentType.ID_CARD,
            DocumentType.PROFILE_PHOTO,
            DocumentType.VEHICLE_PHOTO,
        ):
            if not pending.documents.filter(type=doc_type).exists():
                DriverDocument.objects.create(
                    driver=pending,
                    type=doc_type,
                    file_url=f"https://placehold.co/600x400?text={doc_type}",
                    status=DocumentStatus.PENDING,
                )

        self.stdout.write(self.style.SUCCESS("Données de démo créées."))
        self.stdout.write(
            "Admin : +242060000001 · Finance : +242060000002 · Support : +242060000003"
        )
        self.stdout.write(
            "Passager : +242069000001 (wallet 25 000 F) · "
            "Chauffeurs : +242061000001 à +242061000005"
        )
        self.stdout.write(
            "OTP : affiché dans les logs de l'API (SMS_BACKEND=console) "
            "ou renvoyé par l'API si DEBUG_OTP_IN_RESPONSE=1"
        )
