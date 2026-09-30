# Guide utilisateur du back-office — VTC 242

Accès : `https://app.vtc242.cg/admin` avec un compte `admin`, `finance` ou `support` (connexion par OTP SMS, puis code TOTP pour `admin` et `finance`). Sessions de 8 h.

| Écran | Rôles | Ce que l'on y fait |
|---|---|---|
| Tableau de bord | tous | Courses en cours, chauffeurs en ligne / disponibles, demandes sans chauffeur, CA et commissions du jour, taux d'annulation, alertes ouvertes (rafraîchi toutes les 5 s) |
| Carte de la flotte | tous | Chauffeurs en direct (vert = disponible, orange = en course, gris = position perdue) ; clic = fiche course |
| Alertes | tous | Déviations, urgences, codes erronés, détours, positions perdues, débits plafonnés ; *Prendre en charge* + accès au chat de la course |
| Courses | tous | Recherche, fiche détaillée (trajet prévu / réel, événements, positions, messages, offres), annulation par le support |
| Chauffeurs | admin, support | File de validation, aperçu des pièces (validation / refus avec motif), validation du compte (SMS automatique), suspension / réintégration |
| Passagers | admin, support | Recherche, historique, blocage / déblocage, déconnexion à distance |
| Grille tarifaire | admin, finance | Règles par zone et catégorie, versionnées avec date d'effet ; simulateur de prix |
| Zones | admin | Polygones, numéros d'urgence, seuils de déviation, espèces, plafond de dette, retraits |
| Points d'intérêt | admin, support | Lieux locaux et alias pour l'autocomplétion |
| Litiges | admin, finance (résolution) | Trajets prévu / réel côte à côte, remboursement total ou partiel, rejet motivé |
| Finances | admin, finance | Flux wallets, transactions, retraits à valider (au-dessus du seuil de zone), import CSV des relevés opérateurs, rapport d'écarts, exports CSV |
| Audit | admin | Journal immuable de chaque action |
| Utilisateurs | admin | Création et rôles des comptes staff |

## Procédures

**Valider un chauffeur** : Chauffeurs → filtre *En attente* → ouvrir la fiche → vérifier chaque pièce (permis, carte grise, assurance, pièce d'identité, photo de profil, photo du véhicule, carte de taxi si taxi) → *Valider* (ou *Refuser* avec motif). Le chauffeur reçoit un SMS et peut passer en ligne.

**Modifier un tarif** : Grille tarifaire → *Nouvelle version* → renseigner la date d'effet (future) → enregistrer. L'ancienne règle se ferme automatiquement à cette date ; les courses déjà créées conservent leur règle. Vérifier avec le simulateur.

**Traiter un litige** : Litiges → ouvrir → comparer trajet prévu / réel et événements → *Rembourser* (montant ≤ prix de la course) ou *Rejeter* avec motif. Le passager est notifié ; le remboursement apparaît en transaction `refund`.

**Réconcilier un opérateur** : Finances → *Importer un relevé* (CSV `operator,external_reference,amount,status`) → lire le rapport : correspondances, écarts (montant ou statut différents), manquants (chez nous ou chez l'opérateur). Corriger par ajustement motivé si nécessaire.

**Retrait au-dessus du seuil** : Finances → Retraits → *Approuver* (lance le virement) ou *Rejeter* (recrédit automatique du chauffeur).
