"""Crée le schéma Postgres désigné par DATABASE_SCHEMA s'il n'existe pas (avant migrate)."""

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import connection


class Command(BaseCommand):
    help = (
        "Crée le schéma DATABASE_SCHEMA s'il est défini (base partagée avec une autre application)."
    )

    def handle(self, *args, **options):
        schema = getattr(settings, "DATABASE_SCHEMA", "")
        if not schema:
            self.stdout.write("DATABASE_SCHEMA non défini : schéma public utilisé.")
            return
        with connection.cursor() as cur:
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis")
        self.stdout.write(self.style.SUCCESS(f"Schéma « {schema} » prêt (PostGIS activé)."))
