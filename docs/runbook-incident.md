# Runbook d'incident — VTC 242

Priorités : P1 = service indisponible ou argent en jeu (paiements, soldes) · P2 = fonctionnalité dégradée (dispatch, temps réel) · P3 = confort.

Objectifs : RTO (durée maximale d'interruption) ≤ 15 min · RPO (perte de données maximale) ≤ 1 min (Postgres Render : sauvegardes continues + quotidiennes).

## API indisponible (5xx, /health/ KO) — P1
1. Ouvrir `https://<api>/health/` : la réponse détaille `database`, `redis` (mémoire utilisée / plafond, politique d'éviction, connexions, longueur de la file Celery) et `worker` (dernier battement de cœur). Un composant `error` ou `missing` désigne le coupable.
2. Render → Events : déploiement récent ? → Rollback.
3. Logs : erreurs de connexion Postgres / Redis ? Vérifier l'état des services managés.
4. Si base saturée : augmenter le plan (Basic → Pro) ; vérifier les requêtes lentes (`pg_stat_statements`).
5. Redis plein (`used_memory` ≈ `max_memory`, politique `noeviction`) : vider la file Celery si elle a gonflé (`LLEN celery`, puis `DEL celery` après arrêt du worker) ou augmenter le plan ; Redis injoignable : la connexion et les commandes continuent de fonctionner (limitation de débit tolérante), mais dispatch et temps réel sont à l'arrêt.
6. Communiquer sur la page de statut.

## Aucun chauffeur ne reçoit d'offres — P2
1. `/metrics` : `vtc242_drivers_online` > 0 ? Sinon problème côté chauffeurs (positions non reçues).
2. Redis : `GEOSEARCH drivers:geo:taxi ...` renvoie des chauffeurs ? Sinon vérifier `apps.drivers.geoindex` et la connexion Redis.
3. Worker Celery vivant ? (`render logs vtc242-worker`). Beat en une seule instance ?
4. Le watchdog `rides.dispatch_watchdog` relance automatiquement ; en dernier recours, `python manage.py shell -c "from apps.rides.dispatch import watchdog; watchdog()"`.

## Positions non diffusées / suivi figé — P2
1. WebSocket : le service Render accepte-t-il les connexions WSS ? (`wscat -c wss://api.vtc242.cg/ws/?token=...`).
2. Channel layer Redis : mémoire pleine (`noeviction` refuse les écritures) → augmenter le plan ou purger les clés `asgi:*`.
3. Les clients rejouent via `GET /rides/{id}` : l'impact est limité au temps réel.

## Recharge Mobile Money bloquée en `pending` — P1
1. Webhook reçu ? Chercher la référence dans `wallet_transactions.external_reference` et `provider_payload`.
2. Le polling (`payments.poll_pending_transactions`) tourne-t-il (Beat) ? Il vérifie chaque transaction toutes les 30 s après 90 s.
3. Statut chez l'opérateur (portail MTN / Airtel). Si réussi côté opérateur mais expiré chez nous : `mark_transaction(id, "completed", {"source": "manual"})` depuis le shell, puis ligne d'audit.
4. Si échec côté opérateur : `mark_transaction(id, "failed")` ; pour un retrait, le recrédit est automatique.

## Écart de solde signalé (`balance_mismatch`) — P1
1. Ne pas corriger à la main : lister les transactions du wallet (`/admin/finance/transactions?user_id=`).
2. Identifier la transaction manquante ou doublée (comparer avec `provider_payload`, `ride_events`).
3. Corriger par une transaction `adjustment` motivée (`payments.services.adjust`) — jamais par un `UPDATE` direct.
4. Relancer `recompute_balances()` et vérifier que l'écart disparaît.

## Course verrouillée (3 codes erronés) — P2
1. Alerte `otp_locked` au back-office : contacter passager et chauffeur via le chat (`/admin/rides/{id}/messages`).
2. Si le passager confirme : annuler la course depuis le back-office (`POST /admin/rides/{id}/cancel`) et recommander ; la réservation est libérée.

## Alerte de déviation / urgence — P1
1. Prise en charge dans `/admin/alerts` (bouton *Prendre en charge*), ouverture du chat.
2. Appeler le passager (numéro visible uniquement au back-office) ; si nécessaire, transmettre la position (`admin.fleet`) au 117.
3. Journaliser la décision dans la résolution du litige éventuel.

## Plan de reprise d'activité (PRA)

| Rôle | Qui | Responsabilité |
|---|---|---|
| Pilote d'incident | responsable technique de garde | décide du basculement / rollback, tient le fil de crise |
| Exploitation | développeur backend | rollback Render, restauration Postgres, vidage Redis |
| Communication | support | message aux chauffeurs (push) et aux passagers, page de statut |

Procédure (objectif 15 min) :
1. **0–2 min** : accuser l'alerte, ouvrir le fil de crise, lire `/health/`.
2. **2–5 min** : qualifier — déploiement (rollback), base (restauration, voir ci-dessous), Redis (vidage / plan), fournisseur (Render / Vercel status).
3. **5–10 min** : appliquer le correctif ; si l'infrastructure Render est indisponible, redéployer l'API depuis `render.yaml` dans une autre région et pointer `VITE_API_URL` / `VITE_WS_URL` sur Vercel.
4. **10–15 min** : vérifier (OTP, commande de test, position GPS, code de départ), lever l'alerte, informer.
5. **Sous 48 h** : post-mortem écrit (cause, chronologie, actions).

## Fuite de secret
1. Rotation immédiate (voir guide d'exploitation), `SECRET_KEY` compris si des JWT sont en cause.
2. Déconnexion à distance de tous les comptes concernés (`accounts.services.logout_everywhere`).
3. Post-mortem dans ce dépôt (`docs/postmortems/`).

## Restauration de base
Voir `docs/exploitation.md` (N-08). Avant restauration : mettre l'API en maintenance (scale à 0), vérifier le RPO, restaurer, `migrate`, redémarrer, vérifier `recompute_balances()`.
