# VTC 242 — API Django (ASGI Uvicorn), worker et beat Celery partagent cette image.
FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DJANGO_SETTINGS_MODULE=config.settings.production

# GeoDjango : GDAL, GEOS, PROJ (section 5)
RUN apt-get update && apt-get install -y --no-install-recommends \
        gdal-bin libgdal32 libgeos-c1v5 libproj25 binutils curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .
RUN SECRET_KEY=build DATABASE_URL=postgis://x:x@localhost/x python manage.py collectstatic --noinput

RUN useradd -m app && chown -R app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:${PORT:-8000}/health/ || exit 1
CMD ["sh", "./entrypoint.sh"]
