# Déployer VTC 242 en ligne pour tester (Render + Vercel)

Objectif : une URL publique fonctionnelle en une vingtaine de minutes, sans carte bancaire ni identifiants opérateurs. Ce profil est prévu pour la recette, pas pour la production (voir `docs/exploitation.md` et `api/render.production.yaml`).

## 1. Backend sur Render (API + WebSocket + workers + base + Redis)

1. Créez un compte sur https://render.com et connectez votre compte GitHub (autorisez le dépôt `VTC242`).
2. Dashboard → **New +** → **Blueprint** → choisissez le dépôt `VTC242` et la branche à déployer (`claude/modest-babbage-05i0x4` ou `main` après fusion).
3. Render lit `render.yaml` à la racine et propose de créer : `vtc242-api` (web, Docker, plan free) et `vtc242-redis` (Key Value, free). Il demande la valeur de `DATABASE_URL` : collez l'**Internal Database URL** de la base Postgres existante du workspace (Dashboard → votre base, par ex. celle de *somboko* → *Connect* → *Internal Database URL*). Cliquez **Apply**.
   - Les tables de VTC 242 sont isolées dans le schéma Postgres `vtc242` (variable `DATABASE_SCHEMA`), créé automatiquement au démarrage. Le `search_path` de la connexion ne contient que ce schéma : les tables de l'autre application (y compris sa table `django_migrations` si elle est aussi en Django) ne sont jamais vues ni modifiées. Pour les voir : `psql "$DATABASE_URL" -c "\dt vtc242.*"`.
   - Si l'autre application utilise déjà PostGIS, `ensure_schema` s'arrête avec un message indiquant le schéma à ajouter via `DATABASE_EXTRA_SEARCH_PATH` (ex. `public`) ; ce schéma ne doit alors pas contenir de table `django_migrations` étrangère.
   - Pour une base dédiée à la place, remplacez dans `render.yaml` la ligne `sync: false` de `DATABASE_URL` par `fromDatabase: { name: vtc242-db, property: connectionString }` et rétablissez une section `databases:` (modèle dans `api/render.production.yaml`). Un workspace Render n'a droit qu'à une seule base gratuite.
   - Le jour de la mise en production, la migration vers une base propre se fait par `pg_dump --schema=vtc242` puis `pg_restore`.
4. Attendez la fin du build Docker (5 à 10 min la première fois). Au démarrage, le conteneur exécute `ensure_schema`, `migrate`, `seed_demo`, puis Uvicorn et Celery.
5. Ouvrez `https://<votre-service>.onrender.com/health/` → `{"status":"ok"}` et `https://<votre-service>.onrender.com/api/docs/` pour la documentation.
6. Notez l'URL exacte du service (par ex. `https://vtc242-api-abcd.onrender.com`) : elle sert au frontend.

Réglages à faire dans Render → `vtc242-api` → **Environment** une fois l'URL Vercel connue :
- `FRONTEND_URL` = URL Vercel (liens de partage de trajet) ;
- `API_BASE_URL` = URL Render exacte (uploads de documents en local, sans R2).

## 2. Frontend sur Vercel

1. Créez un compte sur https://vercel.com et connectez GitHub.
2. **Add New… → Project** → importez `VTC242`.
3. Configuration :
   - **Root Directory** : `web` (cliquez *Edit* et choisissez le dossier) ;
   - **Framework Preset** : Vite (détecté automatiquement) ; build `npm run build`, output `dist` ;
   - **Environment Variables** :
     - `VITE_API_URL` = `https://<votre-service>.onrender.com`
     - `VITE_WS_URL` = `wss://<votre-service>.onrender.com`
     - `VITE_MAPTILER_KEY` = clé gratuite MapTiler (facultatif : sans clé, tuiles OSM raster)
4. **Deploy**. L'URL est du type `https://vtc242-xxxx.vercel.app`.
5. Retournez dans Render et renseignez `FRONTEND_URL` avec cette URL (redéploiement automatique).

## 3. Tester

Comptes de démo (créés par `seed_demo`) :

| Rôle | Numéro |
|---|---|
| Passager (wallet 25 000 F) | +242069000001 |
| Passager | +242069000002 |
| Chauffeurs validés (taxi, standard, VIP, taxi, utilitaire) | +242061000001 à +242061000005 |
| Chauffeur en attente de validation | +242061000009 |
| Admin (TOTP à activer au premier login) | +242060000001 |
| Finance (TOTP) | +242060000002 |
| Support (sans TOTP) | +242060000003 |

Le code OTP s'affiche directement dans l'écran de connexion (`DEBUG_OTP_IN_RESPONSE=1`, `SMS_BACKEND=console`) : aucun SMS n'est envoyé en test.

Parcours conseillé avec deux téléphones (ou deux navigateurs) :
1. Téléphone A : connexion chauffeur `+242061000001`, autoriser la géolocalisation, **Passer en ligne** (laisser l'écran allumé).
2. Téléphone B : connexion passager `+242069000001`, saisir une destination (par ex. « Aéroport »), choisir *Taxi*, commander.
3. A reçoit l'offre (15 s) → accepter → « Je suis arrivé » (actif à moins de 200 m du point de départ : en test, choisissez un point de départ proche de votre position réelle ou simulez la position avec les outils de développement du navigateur).
4. B lit son code de départ en jaune → A le saisit → course en cours → « Terminer » à destination ou B valide l'arrivée.
5. Recharge wallet : montant 5000 → succès en 3 s ; 5001 → refusé ; 5002 → expire après 15 min.
6. Back-office : `https://<vercel>/admin` avec `+242060000003` (support) ou `+242060000001` (admin, scannez le QR TOTP avec Google Authenticator).

Limites du plan gratuit Render : le service s'endort après 15 min d'inactivité (première requête lente, 30 à 60 s), une base gratuite expire après 30 jours, 512 Mo de RAM partagés entre l'API et Celery. Une base partagée avec une autre application partage aussi ses connexions, son stockage et ses sauvegardes. Pour la production, utilisez `api/render.production.yaml` (services séparés, plans Standard / Starter) et retirez `CORS_ALLOW_ALL_ORIGINS`, `DEBUG_OTP_IN_RESPONSE`, `SEED_DEMO` et `RUN_WORKER_IN_WEB`.

## 4. Options utiles

- **Position GPS simulée** (Chrome desktop) : DevTools → ⋮ → *More tools* → *Sensors* → *Location* → coordonnées Brazzaville `-4.2650, 15.2800`.
- **Simulateur de trajet chauffeur** : `python api/scripts/gps_simulator.py --api https://<render> --token <access JWT chauffeur> --from -4.2650,15.2800 --to -4.2517,15.2531 --deviate 400` (le JWT s'obtient via `POST /auth/otp/verify`, visible dans l'onglet réseau du navigateur).
- **SMS réels** : créez un compte Infobip, puis dans Render `SMS_BACKEND=infobip`, `INFOBIP_API_KEY`, `INFOBIP_BASE_URL` (ex. `https://xxxxx.api.infobip.com`), et passez `DEBUG_OTP_IN_RESPONSE=0`.
- **Fichiers sur R2** : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET` dans Render ; sans R2, les uploads sont stockés sur le disque éphémère du conteneur (perdus à chaque redéploiement, suffisant pour tester).
