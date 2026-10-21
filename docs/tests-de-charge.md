# Tests de charge (k6)

Objectif : vérifier la tenue de l'API aux heures de pointe (sorties de bureau, pluie) avant
une montée en charge, et détecter les régressions de performance.

## Script

`tests/load/k6-peak-traffic.js` simule des passagers qui demandent une estimation, commandent
puis annulent (annulation gratuite avant acceptation : les fonds réservés sont libérés).

```bash
# k6 : https://grafana.com/docs/k6/latest/set-up/install-k6/
k6 run \
  -e BASE_URL=https://staging.vtc242.cg \
  -e PASSENGER_TOKEN=<jeton JWT d'un passager de test> \
  tests/load/k6-peak-traffic.js
```

Jeton : se connecter avec un compte passager de test (`POST /api/v1/auth/otp/request` puis
`/verify`) et copier `access`. Le compte doit avoir un solde suffisant pour la réservation.

## Seuils

| Métrique | Objectif V1 (Render) | Cible production |
|---|---|---|
| `http_req_duration` p95 | < 500 ms | < 200 ms |
| estimation p99 | < 800 ms | < 300 ms |
| erreurs HTTP | < 1 % | < 0,1 % |

Les seuils sont dans `options.thresholds` du script : k6 renvoie un code de sortie non nul
s'ils sont dépassés, ce qui permet de bloquer un déploiement dans un pipeline.

## Matrice

| Type | Configuration | Quand |
|---|---|---|
| Charge nominale | 50 utilisateurs virtuels, 8 min (script par défaut) | avant chaque mise en production majeure |
| Stress | monter `target` jusqu'à dégradation | dimensionnement du plan Render / Postgres |
| Endurance | 20 VU pendant 2 h | fuites de mémoire, croissance de Redis (`/health/` → `redis.used_memory`) |

## Règles

- Jamais contre la production ni contre la base partagée avec une autre application.
- Lancer uniquement avec `SMS_BACKEND=console` (aucun SMS réel) et `PAYMENT_PROVIDER_MODE=sandbox`.
- Surveiller pendant le test : `/health/` (file Celery, mémoire Redis), `/metrics`, les logs Render.
