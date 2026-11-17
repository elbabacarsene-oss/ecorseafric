# Architecture

- **Serveur** : Node.js + Express 5 (`src/`). API JSON sous `/api`.
- **Base** : SQLite relationnelle (`src/db.js`), clés étrangères et contraintes CHECK actives. Chaque table métier porte `org_id` : chaque entreprise cliente du SaaS est isolée, le filtre est appliqué dans toutes les requêtes serveur.
- **Interface** : SPA en JavaScript sans framework (`public/`), responsive (bureau, tablette, smartphone).
- **Calculs** : fonctions pures dans `src/calc.js`, testées unitairement.

## Sécurité
- Mots de passe hachés avec scrypt + sel ; 10 caractères minimum, lettres et chiffres.
- Session : jeton aléatoire 256 bits stocké haché en base, cookie `HttpOnly; SameSite=Strict` (+ `Secure` en production), expiration 12 h. Changer son mot de passe ou désactiver un compte ferme ses sessions.
- Limitation des tentatives de connexion (10 / 15 min).
- CSRF : cookie SameSite=Strict + toute écriture doit être en `application/json`.
- En-têtes : CSP stricte (aucun script en ligne), `X-Frame-Options: DENY`, `nosniff`.
- Contrôle d'accès **côté serveur** pour chaque route (rôle + chantier). Un chantier non autorisé renvoie 404, ce qui empêche de deviner les identifiants.
- Journal des opérations sensibles (`audit_log`) : connexions, créations, modifications de taux, validations, rejets, déverrouillages.

## Matrice des permissions

| Permission | admin | direction | conducteur | chef_chantier | metreur | comptable |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Lire les chantiers | ✔ | ✔ | ses chantiers | ses chantiers | ✔ | ✔ |
| Créer/modifier un chantier | ✔ | ✔ | ✔ | | | |
| Lire le personnel | ✔ | ✔ | ✔ | ✔ (sans les taux) | | ✔ |
| Gérer le personnel/affectations | ✔ | ✔ | ✔ | | | |
| Saisir le pointage | ✔ | | ✔ | ✔ | | |
| Valider/rejeter le pointage | ✔ | ✔ | ✔ | | | |
| Déverrouiller un pointage validé | ✔ | ✔ | | | | |
| Voir les coûts / taux | ✔ | ✔ | ✔ | | ✔ | ✔ |
| Lire les déboursés secs | ✔ | ✔ | ✔ | | ✔ | ✔ |
| Gérer ressources/ouvrages/études | ✔ | ✔ | | | ✔ | |
| Valider/accepter une étude | ✔ | ✔ | | | | |
| Utilisateurs & paramètres | ✔ | | | | | |
| Journal d'activité | ✔ | ✔ | | | | |

**Séparation des tâches** : on ne valide ni son propre pointage ni sa propre étude (sauf l'administrateur). Un pointage validé est verrouillé ; une étude validée n'est plus modifiable sans repasser en brouillon.

## Formules

**Coût d'une ligne de pointage**
`coût = taux horaire × (heures normales + heures sup × (1 + majoration HS %))`.
Seules les présences « présent » et « ½ journée » génèrent des heures. Le taux horaire et la majoration sont **figés** sur la ligne au moment de la saisie. Un ouvrier ne peut pas dépasser 24 h pointées par jour, tous chantiers confondus. Les dates futures sont refusées.

**Déboursé sec unitaire d'un ouvrage**
`DS = Σ (quantité × (1 + pertes %) × prix unitaire) ÷ quantité de base`, décomposé en main-d'œuvre, matériaux, matériel, sous-traitance.

**Étude de prix**
`K = (1 + frais de chantier) × (1 + frais généraux) × (1 + aléas) × (1 + bénéfice)`
`PU vente HT = arrondi(DS unitaire × K)` ; `montant = quantité × PU` ; `total HT = Σ montants` ; `TVA = total HT × taux` (18 % par défaut).
Les lignes conservent une copie du DS : modifier un prix de la bibliothèque n'altère pas une étude tant qu'on ne clique pas « Actualiser les prix ».

## Modèle de données
`organisations` → `users` (+ `user_chantiers`), `chantiers`, `ouvriers` (+ `affectations`), `pointages`, `ressources`, `ouvrages` (+ `ouvrage_composants`), `etudes` (+ `etude_lignes`), `audit_log`. Voir `src/db.js`.

## Limites de cette version
- Pas de mode hors ligne (prévu à l'étape 6 du cahier des charges : PWA avec file de synchronisation).
- PDF via l'impression du navigateur ; export Excel en CSV (séparateur « ; »).
- La majoration des heures sup. est un taux unique paramétrable : les paliers légaux (heures de nuit, jours fériés…) et la paie réglementaire ne sont pas calculés.
- SQLite convient pour une instance par entreprise ou un trafic modéré. Pour un SaaS à grande échelle, migrer vers PostgreSQL (le SQL est standard).
- Pas encore d'envoi d'e-mails (réinitialisation de mot de passe : c'est l'administrateur qui en définit un nouveau).
