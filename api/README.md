# vtc242-api — API Django de VTC 242

Monolithe Django modulaire (REST + WebSocket + workers Celery). Voir le cahier des charges dans `../docs/`.

## Apps

| App | Rôle |
|---|---|
| `accounts` | OTP SMS, JWT (access 15 min / refresh 30 j rotatif), profil, suppression (anonymisation), Web Push, uploads |
| `geo` | Zones (PostGIS), points d'intérêt, grille tarifaire versionnée, formule de prix, OSRM, Photon |
| `drivers` | Profil chauffeur, véhicules, documents, statut en ligne, positions, géo-index Redis |
| `rides` | Estimation, création, machine à états, dispatch (offres 15 s), code de départ, clôture, annulation, notation, litiges, chat, partage, reçu PDF |
| `payments` | Wallet et grand livre, `PaymentProvider` (MTN MoMo, Airtel Money, Sandbox), recharge, retrait, webhooks, réconciliation |
| `safety` | Déviation d'itinéraire, détours, urgences, journal des alertes |
| `realtime` | Consumer WebSocket Channels, émission d'événements |
| `backoffice` | Endpoints `/admin/*` par rôle, TOTP, audit |

## Lancer en local

```bash
cp .env.example .env
uv venv .venv && uv pip install --python .venv/bin/python -e ".[dev]"   # ou python -m venv + pip
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo
.venv/bin/uvicorn config.asgi:application --reload --port 8000
# dans deux autres terminaux :
.venv/bin/celery -A config worker -l info
.venv/bin/celery -A config beat -l info
```

Prérequis : PostgreSQL 16 + PostGIS, Redis 7, GDAL/GEOS/PROJ (`apt install gdal-bin libgdal-dev libgeos-dev libproj-dev`).
Ou tout simplement `docker compose up` depuis la racine du dépôt.

- Documentation OpenAPI : http://localhost:8000/api/docs/
- Santé : http://localhost:8000/health/ · Métriques Prometheus : http://localhost:8000/metrics
- OTP en local : affiché dans les logs (`SMS_BACKEND=console`) et renvoyé dans la réponse (`DEBUG_OTP_IN_RESPONSE=1`).
- Paiements : `PAYMENT_PROVIDER_MODE=sandbox` → un montant se terminant par `1` est refusé, par `2` expire, sinon succès en ~3 s.

## Qualité

```bash
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/mypy apps/payments apps/rides
.venv/bin/pytest --cov=apps.rides --cov=apps.payments
.venv/bin/pip-audit
```

Les tests exigent une base PostGIS locale (`DATABASE_URL`, par défaut `postgis://vtc242:vtc242@localhost:5432/vtc242`).
