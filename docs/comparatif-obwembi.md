# Comparatif avec le cahier des charges OBWEMBI

Analyse du cahier des charges « OBWEMBI » (application de mobilité, Congo-Brazzaville, octobre
2026) pour en reprendre les bonnes idées sans remettre en cause l'architecture de VTC 242.

## Ce que VTC 242 couvrait déjà

| Idée OBWEMBI | VTC 242 |
|---|---|
| Connexion par téléphone + OTP SMS, JWT avec refresh | identique (sessions de 30 jours) |
| Catégories taxi / standard / VIP / mariage / déménagement | identiques, avec grille tarifaire par zone |
| Wallet rechargeable MTN MoMo / Airtel Money, USSD push, webhooks HMAC, polling de secours après 90 s, expiration après 15 min | identique (`payments`) |
| Code OTP de course à 4 chiffres, course et paiement verrouillés sans ce code | identique (F-36) |
| Fiche chauffeur : marque, couleur, immatriculation, numéro de taxi, photo | identique |
| Suivi GPS temps réel, ETA | identique (WebSocket, Redis geo-index par catégorie) |
| Détection de déviation : Redis GEOSEARCH, confirmation PostGIS, 3 positions consécutives, seuil 300 m | identique (`safety`), seuil réglable par zone |
| Chat in-app sans partage de numéro | identique |
| Bouton d'urgence Police 117 / Pompiers 118 (appel direct) | identique, numéros réglables par zone |
| Mode déconnecté : positions GPS mises en file et resynchronisées | identique (Dexie) |
| Back-office : KPI, flotte en temps réel, dossiers chauffeurs, tarifs, journal des alertes, exports CSV | identique |
| Métriques Prometheus, `/health/`, logs JSON | identiques |
| Dispatch : offre de 15 s au plus proche, rayon extensible, un chauffeur à la fois | identique, durée paramétrable |

## Ce qui a été repris (cette livraison)

1. **Purge des chauffeurs injoignables** (OBWEMBI « heartbeat 30 s ») : un chauffeur sans position
   depuis 30 s est retiré de l'index géographique et ne reçoit plus d'offres jusqu'à sa prochaine
   position. Avant, seul le bandeau « position perdue » était affiché.
2. **Chronomètre de course** (OBWEMBI « Chrono & Durée ») : temps d'attente au point de prise en
   charge avec le temps gratuit restant (passager et chauffeur), puis durée écoulée et temps
   restant estimé pendant le trajet.
3. **Alertes métier au back-office** (OBWEMBI règles Prometheus) : « aucun chauffeur en ligne »
   sur une zone où des passagers commandent, et « taux d'annulation > 25 % sur 30 min ». Tâche
   `backoffice.business_watch` toutes les 5 min, sans doublon pendant 60 min.
4. **Liste blanche IP des webhooks Mobile Money** (OBWEMBI sécurité) : `PAYMENT_WEBHOOK_ALLOWED_IPS`
   (adresses ou réseaux CIDR), en plus de la signature HMAC. Vide = désactivée.
5. **Compression des réponses JSON** (OBWEMBI « consommation optimisée ») : gzip côté API.
6. **Résilience à une panne de Redis** (OBWEMBI haute disponibilité) : la limitation de débit laisse
   passer les requêtes si Redis est injoignable (au lieu d'une erreur 500 sur la connexion), le
   worker Celery est relancé automatiquement dans le profil de test, et `/health/` détaille l'état
   de la base, de Redis (mémoire, plafond, connexions, file Celery) et du worker.
7. **Tests de charge k6** : script `tests/load/k6-peak-traffic.js` et guide `docs/tests-de-charge.md`.
8. **Plan de reprise d'activité** : objectifs RTO / RPO, rôles et procédure dans le runbook.

9. **Location de véhicules avec ou sans chauffeur** et **covoiturage** (OBWEMBI « Services
   proposés ») : annonces validées au back-office, réservation avec fonds réservés sur le wallet,
   caution, commission, frais d'annulation tardive, recherche de trajets par texte / date / proximité,
   réservation de places, clôture par le conducteur. Voir `docs/api-contract.md`.

## Non repris (volontairement)

- **Nom et prénom du passager visibles du chauffeur** : VTC 242 ne montre que le prénom (vie privée).
- **Paiement en espèces** : retiré à la demande du client (wallet uniquement).
- **Stack Node/Go, Flutter, Kubernetes multi-régions, cluster Redis Sentinel** : la V1 est une
  application web (PWA) sur Render / Vercel ; ces choix ne se justifient qu'à plusieurs milliers
  de chauffeurs actifs.
- **Thème noir et blanc à haut contraste** : idée intéressante pour le soleil ; à décider avec la
  charte graphique (un mode « contraste élevé » optionnel est possible).
