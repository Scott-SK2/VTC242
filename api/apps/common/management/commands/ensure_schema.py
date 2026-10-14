"""Crée le schéma Postgres désigné par DATABASE_SCHEMA s'il n'existe pas (avant migrate)."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection

POSTGIS_SCHEMA_SQL = (
    "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON e.extnamespace = n.oid "
    "WHERE e.extname = 'postgis'"
)
FOREIGN_MIGRATIONS_SQL = (
    "SELECT count(*) FROM pg_catalog.pg_class c "
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
    "WHERE c.relkind IN ('r', 'v') AND c.relname = 'django_migrations' "
    "AND pg_catalog.pg_table_is_visible(c.oid) AND n.nspname <> %s"
)


class Command(BaseCommand):
    help = "Crée le schéma DATABASE_SCHEMA et y installe PostGIS (base partagée)."

    def handle(self, *args, **options):
        schema = getattr(settings, "DATABASE_SCHEMA", "")
        if not schema:
            self.stdout.write("DATABASE_SCHEMA non défini : schéma public utilisé.")
            return
        search_path = [schema, *getattr(settings, "DATABASE_EXTRA_SEARCH_PATH", [])]
        shown_path = ", ".join(search_path)
        with connection.cursor() as cur:
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
            cur.execute(POSTGIS_SCHEMA_SQL)
            row = cur.fetchone()
            if row is None:
                cur.execute(f'CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA "{schema}"')
                where = schema
            else:
                where = row[0]
                if where not in search_path:
                    raise CommandError(
                        f"PostGIS est déjà installé dans le schéma « {where} » de cette base, "
                        f"hors du search_path ({shown_path}). "
                        f"Définissez DATABASE_EXTRA_SEARCH_PATH={where} puis relancez."
                    )
            # Isolation stricte : aucune table django_migrations étrangère ne doit être visible.
            cur.execute(FOREIGN_MIGRATIONS_SQL, [schema])
            foreign = cur.fetchone()[0]
        if foreign:
            raise CommandError(
                "Une table django_migrations d'une autre application est visible dans le "
                "search_path : retirez les schémas étrangers de DATABASE_EXTRA_SEARCH_PATH."
            )
        self.stdout.write(
            self.style.SUCCESS(
                f"Schéma « {schema} » prêt (PostGIS dans « {where} », search_path = {shown_path})."
            )
        )
