#!/bin/sh
# Point d'entrée du conteneur API.
#   RUN_MIGRATIONS_ON_START=1  → migrate au démarrage (utile sans preDeployCommand, plan gratuit)
#   SEED_DEMO=1                → charge le jeu de données de démo (idempotent)
#   RUN_WORKER_IN_WEB=1        → lance Celery worker + beat dans le même conteneur (test / plan gratuit)
set -e
PORT="${PORT:-8000}"
WEB_WORKERS="${WEB_WORKERS:-2}"

if [ "${RUN_MIGRATIONS_ON_START:-0}" = "1" ]; then
  python manage.py ensure_schema
  python manage.py migrate --noinput
fi
if [ "${SEED_DEMO:-0}" = "1" ]; then
  python manage.py seed_demo
fi
if [ "${RUN_WORKER_IN_WEB:-0}" = "1" ]; then
  echo "Démarrage de Celery worker + beat dans le conteneur web (mode test)"
  celery -A config worker -B -l info --concurrency "${CELERY_CONCURRENCY:-1}" &
fi
exec uvicorn config.asgi:application --host 0.0.0.0 --port "$PORT" --workers "$WEB_WORKERS"
