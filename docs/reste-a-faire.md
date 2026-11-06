# Reste à faire — VTC 242

État au 6 novembre 2026. La V1 du cahier des charges v3 est développée et testée
(54 tests backend, 24 tests web) ; location et covoiturage (prévus en V3) sont déjà livrés.
Cocher les cases au fur et à mesure.

## 1. Avant le lancement : brancher les vrais services

Le code est prêt ; il manque un compte ou une clé fournis par le client.

- [ ] **Paiements MTN MoMo et Airtel Money** : identifiants de production des deux opérateurs
      (aujourd'hui `PAYMENT_PROVIDER_MODE=sandbox`). Onboarding long : à lancer en premier.
- [ ] **SMS Infobip** : compte et clé, puis `SMS_BACKEND=infobip` et `DEBUG_OTP_IN_RESPONSE=0`
      (aujourd'hui le code de connexion s'affiche à l'écran).
- [ ] **Stockage des documents chauffeurs (Cloudflare R2)** : variables `R2_*`. Sans elles, les
      permis et cartes grises sont stockés sur le disque du serveur et perdus à chaque
      redéploiement. **Prioritaire avant d'inscrire de vrais chauffeurs.**
- [ ] **Sentry** : `SENTRY_DSN` (backend) et `VITE_SENTRY_DSN` (frontend).
- [ ] **Nom de domaine définitif** (ex. `vtc242.cg`) sur Render et Vercel ; mettre à jour
      `ALLOWED_HOSTS`, `API_BASE_URL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`,
      `VITE_API_URL`, `VITE_WS_URL` ; passer `CORS_ALLOW_ALL_ORIGINS=0`.
- [ ] **Hébergement de production** : profil `api/render.production.yaml` (plans payants,
      worker et beat séparés, base sauvegardée), `RUN_WORKER_IN_WEB=0`, `SEED_DEMO=0`.
- [ ] **Clés de notification (VAPID) de production** : en générer de nouvelles.
- [ ] **Durée d'offre chauffeur** : revenir à 15 s (`DISPATCH_OFFER_TTL_S`) si le pilote le confirme.

## 2. Valider la V1

- [ ] **Test de charge k6** sur un serveur de préproduction (A-16 : 300 chauffeurs, 50 commandes
      par minute pendant 15 min) — script `tests/load/k6-peak-traffic.js`, guide `docs/tests-de-charge.md`.
- [ ] **Lighthouse** (performance ≥ 80 en 3G simulée, PWA installable — N-04, A-15).
- [ ] **Essais sur de vrais téléphones Android 8+** (Chrome et Samsung Internet — N-02, A-01).
- [ ] **Pilote** avec 20 à 30 chauffeurs à Brazzaville ; calibrer les seuils GPS et de déviation.

## 3. Décisions à prendre (valeurs de démo en place, réglables au back-office)

- [ ] Taux de commission par catégorie ; commission ou abonnement pour les taxis conventionnés.
- [ ] Politique d'annulation : délai gratuit, frais, part reversée au chauffeur.
- [ ] Minimum et plafond des retraits chauffeurs ; seuil de validation manuelle.
- [ ] Chauffeurs indépendants seulement, ou exploitants gérant plusieurs chauffeurs.
- [ ] Site vitrine public : oui / non.
- [x] Paiement en espèces : retiré (wallet uniquement).

## 4. Versions suivantes

**V2 — applications Android / iOS** (React Native, même API)
- [ ] GPS en arrière-plan côté chauffeur, notifications push natives, publication sur les stores.

**V3 — extensions**
- [x] Location de véhicules avec ou sans chauffeur.
- [x] Covoiturage.
- [ ] **Réservation à l'avance** (course planifiée à une date et une heure) : seul le type
      `scheduled` existe dans le modèle ; tout le parcours reste à faire.
- [ ] **Comptes entreprise et facturation.**
- [ ] **Pointe-Noire** : aucun code, créer la zone, ses numéros d'urgence et sa grille au back-office.
- [ ] **Lingala et kituba** : textes déjà externalisés (`web/src/shared/i18n/fr.json`), traductions à fournir.

## 5. Idées du document OBWEMBI non encore reprises

Voir `docs/comparatif-obwembi.md` pour le détail de ce qui a déjà été repris.

- [ ] **Réservation à l'avance** (même point que la V3 ci-dessus).
- [ ] **Appel masqué passager ↔ chauffeur** : aujourd'hui seul le chat est proposé, sans échange
      de numéros. Un appel nécessite un service de téléphonie avec numéros masqués.
- [ ] **Bouton « Appeler le chauffeur » dans l'alerte de déviation** (dépend du point précédent ;
      l'appel au 117 existe déjà).
- [ ] **Rapports financiers exportables en PDF** : seul l'export CSV existe au back-office.
- [ ] **Carte de chaleur des chauffeurs** au tableau de bord (la carte de la flotte en direct existe).
- [ ] **Mode contraste élevé noir et blanc** (lisibilité au soleil) : à décider avec la charte.

Écartés volontairement : nom complet du passager visible du chauffeur (vie privée), paiement en
espèces, infrastructure multi-régions et cluster Redis (inutile avant plusieurs milliers de chauffeurs).

## 6. Exploitation en cours

- [ ] Redéployer sur le nouveau compte Render via **New → Blueprint** (dossier racine `api`).
- [ ] Ancien compte Render : supprimer `vtc242-api` et `vtc242-redis` ; facultatif :
      `DROP SCHEMA vtc242 CASCADE;` dans la base de somboko.
