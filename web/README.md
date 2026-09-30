# VTC 242 — frontend web (`vtc242-web`)

Application web responsive (PWA) de VTC 242 : passager (`/p/*`), chauffeur (`/d/*`) et back-office (`/admin/*`) dans une seule SPA React, codée contre le contrat d'API `docs/api-contract.md`.

## Stack

React 18 · Vite 5 · TypeScript strict · React Router 6 · TanStack Query 5 · Zustand · Tailwind CSS 3 · MapLibre GL JS (tuiles MapTiler, repli OSM raster) · vite-plugin-pwa (Workbox) · Dexie (file hors ligne chauffeur) · react-i18next (français seul, textes dans `src/shared/i18n/fr.json`) · vitest + Testing Library · Playwright · eslint + prettier.

## Installation

```bash
cd web
cp .env.example .env        # renseigner VITE_API_URL / VITE_WS_URL au minimum
npm install
npm run dev                 # http://localhost:5173
```

Prérequis : Node 22+, npm 10+. Le backend Django doit tourner (par défaut `http://localhost:8000`). En local avec `DEBUG_OTP_IN_RESPONSE=1` côté API, le code OTP s'affiche directement sur l'écran de connexion.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `VITE_API_URL` | URL de l'API sans `/api/v1` (ex. `http://localhost:8000`) |
| `VITE_WS_URL` | URL du WebSocket sans `/ws/` (ex. `ws://localhost:8000`) |
| `VITE_MAPTILER_KEY` | Clé MapTiler (style vectoriel `streets-v2`). Absente : tuiles raster `tile.openstreetmap.org` |
| `VITE_VAPID_PUBLIC_KEY` | Clé publique VAPID pour Web Push (facultatif) |
| `VITE_SENTRY_DSN` | DSN Sentry ; le SDK n'est chargé que si la variable est définie |

Aucun secret ne doit être placé dans ces variables : elles sont embarquées dans le bundle.

## Scripts

| Script | Action |
|---|---|
| `npm run dev` | Serveur de développement Vite |
| `npm run build` | `tsc --noEmit` strict puis `vite build` (sortie `dist/`, service worker généré) |
| `npm run preview` | Sert `dist/` sur http://localhost:4173 |
| `npm run lint` | eslint (TypeScript + hooks React) |
| `npm run typecheck` | `tsc --noEmit` sur l'application et les fichiers de configuration |
| `npm run test` | vitest (ajouter `-- --run` pour une exécution unique) |
| `npm run test:e2e` | Playwright : test responsive 360 / 768 / 1024 / 1440 px sans défilement horizontal (nécessite `npx playwright install chromium` une fois) |
| `npm run format` / `format:check` | prettier |

## Organisation

```
src/app            routes (lazy), gardes par rôle, layouts mobile et back-office, pages communes (login OTP, hors ligne, 404, installation PWA)
src/features/passenger   accueil carte + recherche + estimation + commande, suivi de course, wallet, historique, profil, page publique /share/:token
src/features/driver      écran principal (en ligne / hors ligne, offre 15 s, course active), onboarding, wallet + retrait, historique, profil, file Dexie
src/features/admin       layout à barre latérale, login + TOTP, tableau de bord, flotte, alertes, courses, chauffeurs, passagers, tarifs, zones, POI, litiges, finances, audit, utilisateurs
src/shared/api     client fetch (refresh automatique sur 401, Idempotency-Key), endpoints typés, types du contrat, hooks temps réel
src/shared/ws      client WebSocket (ping 20 s, backoff 1/2/4/8 s, bus d'événements typé)
src/shared/map     MapLibre chargé à la demande (import dynamique)
src/shared/ui      composants (boutons ≥ 48 px, champs, modales, panneau glissant, chat, urgence…)
src/shared/i18n    fr.json
src/shared/store   auth (access en mémoire, refresh en localStorage), UI (toasts, réseau, invite d'installation)
src/shared/utils   monnaie « 12 500 F », géo (haversine, Google Maps), dates, téléphone, appareil (vibration, son)
src/pwa            enregistrement du service worker, invite d'installation, Web Push, Sentry
tests/unit         vitest · tests/e2e  Playwright
vercel.json        rewrites SPA vers /index.html, cache long sur /assets/*
```

## Sessions et sécurité

- Access JWT conservé uniquement en mémoire (store Zustand) ; refresh token en `localStorage` en V1 (le cookie HttpOnly viendra ensuite), rotation à chaque refresh, refresh automatique sur `401`.
- En-tête `Idempotency-Key` (UUID) sur `POST /rides`, `/wallet/deposit`, `/wallet/payout`.
- Back-office : après l'OTP, étape TOTP obligatoire pour `admin` et `finance` ; un `403 { code: "totp_required" }` renvoie automatiquement vers l'étape TOTP.
- Aucun numéro de téléphone de l'autre partie n'est affiché côté passager / chauffeur.

## Déploiement (Vercel)

Build `npm run build`, sortie `dist/`. `vercel.json` réécrit toutes les routes vers `/index.html` et pose `Cache-Control: public, max-age=31536000, immutable` sur `/assets/*`. Variables à définir dans le projet Vercel : `VITE_API_URL`, `VITE_WS_URL`, `VITE_MAPTILER_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_SENTRY_DSN`.
