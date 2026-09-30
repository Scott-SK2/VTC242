# VTC 242

VTC 242 met en relation passagers et chauffeurs (taxis conventionnés et véhicules particuliers) à Brazzaville, avec trois garanties : chauffeur identifié, course démarrée par un code de départ à 4 chiffres, paiement par wallet alimenté en Mobile Money (MTN MoMo, Airtel Money).

Ce dépôt contient l'application web V1 décrite dans le [cahier des charges v3](docs/cahier-des-charges-v3.pdf) : une API Django et un frontend React servant les trois interfaces (passager `/p/*`, chauffeur `/d/*`, back-office `/admin/*`), installable comme PWA.

## Structure

```
api/    Django 5.1 · DRF · Channels · Celery · PostGIS · Redis   (déployé sur Render, render.yaml)
web/    React 18 · Vite · TypeScript · Tailwind · MapLibre · PWA (déployé sur Vercel, vercel.json)
docs/   Cahier des charges, contrat d'API, guide d'exploitation, runbook, guide back-office
.github/workflows/  CI (PR), déploiements, nocturne (Playwright, sauvegarde)
docker-compose.yml  Environnement local complet
```

## Démarrage rapide

```bash
docker compose up
```
Puis :
- Application : http://localhost:5173 (passager `/p`, chauffeur `/d`, back-office `/admin`)
- API et documentation OpenAPI : http://localhost:8000/api/docs/
- Comptes de démo (`manage.py seed_demo`, exécuté au démarrage) : admin `+242060000001`, finance `+242060000002`, support `+242060000003`, passager `+242069000001` (wallet 25 000 F), chauffeurs `+242061000001` à `+242061000005`, chauffeur en attente `+242061000009`.
- Le code OTP est affiché dans les logs de l'API et renvoyé par `POST /auth/otp/request` (`debug_code`) en local.
- Paiements en `SandboxProvider` : un montant terminant par `1` est refusé, par `2` expire, sinon succès en ~3 s.

Sans Docker : voir [api/README.md](api/README.md) et [web/README.md](web/README.md).

## Fonctionnalités livrées (V1)

- **Compte** : inscription / connexion par OTP SMS (+242), session 30 jours à refresh rotatif, un appareil actif par chauffeur, suppression avec anonymisation, Web Push.
- **Passager** : carte, autocomplétion (POI locaux + Photon), estimation par catégorie (fourchette ± 10 %, distance, durée, temps d'approche), commande wallet ou espèces avec réservation des fonds, recherche de chauffeur, fiche chauffeur + code de départ, suivi temps réel, alerte de déviation, chat prédéfini, urgence 117/118, partage de trajet, annulation avec frais, notation, contestation 24 h, wallet Mobile Money, historique et reçu PDF.
- **Chauffeur** : onboarding documentaire, véhicules, bascule en ligne (Wake Lock, bandeau position perdue), offres 15 s avec pause après 3 refus, arrivée à 200 m, saisie du code (verrouillage après 3 erreurs), détour justifié, clôture à 200 m ou validation passager, récapitulatif, retraits Mobile Money, mode dégradé hors ligne (file IndexedDB rejouée).
- **Back-office** : tableau de bord et flotte en direct, alertes, courses, validation des chauffeurs, passagers, grille tarifaire versionnée avec simulateur, zones et POI, litiges avec remboursement, finances (retraits, réconciliation CSV, exports), rôles admin / finance / support avec TOTP et journal d'audit.
- **Technique** : machine à états journalisée (`ride_events`), dispatch Redis GEOSEARCH, détection de déviation, grand livre wallet à idempotence stricte, `PaymentProvider` MTN / Airtel / Sandbox, WebSocket JWT, OpenAPI 3.1, métriques Prometheus, logs JSON, CI complète.

## Qualité

| | Commande |
|---|---|
| API | `cd api && ruff check . && mypy apps/payments apps/rides && pytest --cov=apps.rides --cov=apps.payments` |
| Web | `cd web && npm run lint && npm run typecheck && npm run test -- --run && npm run build` |
| Charge | `k6 run api/scripts/load_test.js` (A-16) |
| GPS | `python api/scripts/gps_simulator.py --token <jwt chauffeur> --from -4.2650,15.2800 --to -4.2517,15.2531 --deviate 400` (A-06) |

## Documentation

- [Contrat d'API](docs/api-contract.md) · OpenAPI générée sur `/api/docs/`
- [Guide d'exploitation Render / Vercel](docs/exploitation.md)
- [Runbook d'incident](docs/runbook-incident.md)
- [Guide utilisateur du back-office](docs/guide-backoffice.md)
- [Cahier des charges v3](docs/cahier-des-charges-v3.pdf) (extrait texte : `docs/cahier-des-charges-v3.txt`)

## Hors périmètre V1 (cahier des charges, section 2)

Réservation à l'avance, covoiturage, location, comptes entreprise, multilingue, applications natives (V2 : React Native sur la même API). Les identifiants de production MTN / Airtel sont fournis par les opérateurs à l'onboarding marchand ; d'ici là, `SandboxProvider` et le paiement en espèces permettent de recetter et de piloter.
