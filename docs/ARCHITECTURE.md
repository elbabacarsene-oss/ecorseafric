# Architecture

- **Serveur** : Node.js + Express 5 (`src/`). API JSON sous `/api`.
- **Base** : PostgreSQL (`src/db.js`, pilote `pg`), clés étrangères et contraintes CHECK. Le schéma est créé/complété au démarrage (sous verrou consultatif, sûr avec plusieurs instances). Chaque table métier porte `org_id` : chaque entreprise cliente du SaaS est isolée, le filtre est appliqué dans toutes les requêtes serveur. Les écritures multiples passent par des transactions ; les saisies concurrentes de pointage sont sérialisées par verrou de ligne.
- **E-mails** : API Brevo (`src/email.js`). **Paiement** : Wave Checkout (`src/wave.js`, `src/routes/abonnement.js`).
- **Interface** : SPA en JavaScript sans framework (`public/`), responsive (bureau, tablette, smartphone).
- **Calculs** : fonctions pures dans `src/calc.js`, testées unitairement.

## Sécurité
- Mots de passe hachés avec scrypt + sel ; 10 caractères minimum, lettres et chiffres.
- Session : jeton aléatoire 256 bits stocké haché en base, cookie `HttpOnly; SameSite=Strict` (+ `Secure` en production), expiration 12 h. Changer son mot de passe ou désactiver un compte ferme ses sessions.
- Limitation des tentatives de connexion (10 / 15 min).
- CSRF : cookie SameSite=Strict + toute écriture doit être en `application/json`.
- En-têtes : CSP stricte (aucun script en ligne), `X-Frame-Options: DENY`, `nosniff`.
- Contrôle d'accès **côté serveur** pour chaque route (rôle + chantier). Un chantier non autorisé renvoie 404, ce qui empêche de deviner les identifiants.
- Confirmation de l'adresse e-mail obligatoire ; jetons d'e-mail aléatoires 256 bits, stockés hachés, à usage unique (48 h pour la confirmation, 1 h pour la réinitialisation). « Mot de passe oublié » répond de la même façon que l'adresse existe ou non.
- Limites : 5 créations d'espace par heure et par IP ; 3 demandes de réinitialisation par heure et par adresse.
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

## Pointage hors connexion
- **Application installable** (PWA : `public/manifest.webmanifest`, `public/sw.js`). Le service worker garde l'application et, en lecture seule, le profil, la liste des chantiers, les feuilles déjà ouvertes et les ouvriers affectés aux chantiers actifs (« réseau d'abord » : avec du réseau, on a toujours la version à jour).
- **Boîte d'envoi** (`public/hors-ligne.js`, IndexedDB) : chaque enregistrement de feuille est d'abord écrit sur l'appareil, puis envoyé. Sans réseau, il reste en file et part automatiquement au retour de la connexion (événement « online », retour sur l'application, toutes les 30 s), application ouverte.
- **Pas de doublon** : chaque opération porte un identifiant unique (`operation_id`, UUID). Le serveur l'enregistre dans `operations_sync` dans la même transaction que les lignes ; un renvoi renvoie le résultat déjà calculé sans rien réappliquer, même si deux envois identiques arrivent en même temps.
- **Conflits** : chaque ligne de pointage a une `version`, incrémentée à chaque saisie, validation, rejet ou déverrouillage. L'appareil envoie la version qu'il a lue ; si elle ne correspond plus, la ligne n'est pas écrasée et figure dans `conflits` (affichée dans « Synchronisation → À revoir »).
- Plusieurs modifications hors ligne d'une même feuille sont fusionnées dans une seule opération tant qu'elle n'a pas pu atteindre le serveur. Si une opération est « incertaine » (connexion coupée pendant l'envoi), la suivante est chaînée : elle attend la version que le serveur renvoie pour la première.
- Une saisie refusée définitivement (ouvrier désaffecté, abonnement expiré…) reste sur l'appareil jusqu'à ce que l'utilisateur la renvoie ou la supprime. À la déconnexion, les données consultées sont effacées de l'appareil ; les saisies non envoyées sont conservées (avec avertissement) et partent à la prochaine connexion du même utilisateur.
- Limites : l'envoi se fait application ouverte (pas de synchronisation en arrière-plan sur iPhone) ; les données gardées sur l'appareil ne sont pas chiffrées (aucun salaire n'y figure pour un chef de chantier) ; la validation, les études et l'administration nécessitent une connexion.

## Essai et abonnement
- L'essai (24 h, `ESSAI_HEURES`) démarre à la confirmation de l'e-mail de l'administrateur fondateur.
- État d'accès : `essai`, `abonne`, `expire`, `non_demarre`. Hors `essai`/`abonne`, toute écriture renvoie **402** (sauf authentification et abonnement) ; la lecture reste possible.
- Paiement : l'administrateur choisit 1, 3, 6 ou 12 mois → session Wave Checkout (montant = tarif mensuel × mois, en XOF) → redirection vers Wave → retour sur `/paiement/retour`.
- **Un paiement n'est crédité qu'après lecture de la session directement auprès de l'API Wave** (statut `complete` + `succeeded`, devise XOF, montant identique). La redirection de retour et le webhook ne font que déclencher cette vérification. Le webhook est en plus authentifié par signature HMAC (`Wave-Signature`, tolérance 5 min).
- Le crédit est idempotent (verrou sur la ligne de paiement) : une notification rejouée ne prolonge pas deux fois. La prolongation part de la plus tardive des dates : maintenant, fin d'abonnement en cours, fin d'essai.

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
`organisations` (essai, abonnement, logo) → `users` (+ `user_chantiers`, `sessions`, `jetons`), `paiements`, `chantiers`, `ouvriers` (+ `affectations`), `pointages`, `ressources`, `ouvrages` (+ `ouvrage_composants`), `etudes` (+ `etude_lignes`), `audit_log`. Voir `src/db.js`.

## Limites de cette version
- PDF via l'impression du navigateur ; export Excel en CSV (séparateur « ; »).
- La majoration des heures sup. est un taux unique paramétrable : les paliers légaux (heures de nuit, jours fériés…) et la paie réglementaire ne sont pas calculés.
- Les limites anti-abus (tentatives de connexion, inscriptions) sont gardées en mémoire : elles valent par instance. Avec plusieurs instances, les stocker dans PostgreSQL ou Redis.
- Pas de facture PDF pour l'abonnement (le reçu Wave fait foi).
- Une adresse e-mail ne peut appartenir qu'à un seul espace.
