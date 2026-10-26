# Architecture — ECORSE AFRIC BTP MANAGER 360

## 1. Vue d'ensemble

| Couche | Choix | Raison |
|---|---|---|
| Interface | Next.js 15 (App Router, React 19), Tailwind CSS | Web responsive (ordinateur, tablette, smartphone Android/iPhone) ; composants serveur |
| Logique serveur | Composants serveur + actions serveur Next.js | Pas d'API publique à sécuriser séparément ; tout contrôle d'accès s'exécute sur le serveur |
| Données | PostgreSQL + Prisma (migrations versionnées) | Relationnel, transactions, contraintes d'unicité ; portable (Supabase, Neon, VPS…) |
| Authentification | Maison : bcrypt (coût 12) + sessions opaques en base | Aucune dépendance externe ; révocation immédiate des sessions |
| Graphiques | Recharts | Graphiques interactifs (survol) |
| Tests | Vitest (unitaires), Playwright (bout en bout) | |

```
Navigateur ──HTTPS──> Next.js (serveur)
                        ├─ middleware : sans cookie → /connexion (filtre rapide)
                        ├─ pages (composants serveur) : exigerPermission() + filtreChantiers()
                        ├─ actions serveur : verifierPermission() + chantierAccessible() + journal
                        └─ Prisma ──> PostgreSQL
```

Le navigateur ne reçoit que le HTML/les données rendus pour son rôle. Aucune clé ni chaîne de connexion
n'est exposée côté client (aucune variable `NEXT_PUBLIC_*`).

Les applications mobiles natives (étape 6) pourront s'appuyer sur la même base et des routes API dédiées
qui réutiliseront `lib/permissions.ts` et `lib/acces.ts`.

## 2. Arborescence

```
prisma/schema.prisma          modèle de données + migrations
src/lib/permissions.ts        matrice des permissions (source unique, affichée dans l'application)
src/lib/auth.ts               connexion, sessions, verrouillage, exigerPermission / verifierPermission
src/lib/acces.ts              périmètre « chantiers affectés » (filtre Prisma), 404 si hors périmètre
src/lib/calculs.ts            calculs métier purs (marché actualisé, marge, retard…)
src/lib/audit.ts              journal d'audit + historique des chantiers
src/lib/devis-calculs.ts      prix de vente, totaux de devis, budget issu d'un devis (fonctions pures)
src/lib/budget-calculs.ts     totaux et alertes budgétaires
src/lib/planning-calculs.ts   chemin critique, retards, écarts à la référence (fonctions pures)
src/lib/pdf.ts, documents-generes.ts   PDF (devis, rapports) et Excel ; tampon des plans remplacés
src/lib/stockage.ts, types-fichiers.ts fichiers en base, contrôle du type réel (signature binaire)
src/app/api/fichiers, api/devis, api/rapports   téléchargements contrôlés (droits vérifiés à chaque appel)
src/app/(app)/...             pages authentifiées : tableau de bord, chantiers, intervenants, admin
src/app/connexion             page de connexion
tests/unit, tests/e2e         tests
```

## 3. Modèle de données (étape 1)

- **Entreprise** (ligne unique) : raison sociale, NINEA, RCCM, coordonnées, logo (stocké en base, PNG/JPEG/WebP).
- **Utilisateur** : e-mail, nom, rôle, actif, mot de passe haché, verrouillage, lien facultatif vers une fiche **Intervenant**.
- **Session** : empreinte SHA-256 du jeton (le jeton brut n'est jamais stocké), expiration absolue 12 h, inactivité 2 h.
- **JournalAudit** : qui, quoi, quand, IP, détails (avant/après).
- **Intervenant** : toutes les parties prenantes, en 4 catégories (maîtrise d'ouvrage = clients, maîtrise
  d'œuvre, personnel interne, intervenants externes) et 32 types. Code automatique `MOA-0001`, `MOE-…`, `INT-…`, `EXT-…`.
- **Chantier** : code unique (`CH-AAAA-NNN` automatique ou saisi), type de projet (12 catégories), statut,
  8 intervenants clés (client, MOA, architecte, BET, bureau de contrôle, conducteur, chef de chantier, QHSE),
  localisation (14 régions du Sénégal, GPS facultatif), dates, montants en XOF.
- **Avenant** : numéro par chantier, montant (± ), délai, statut Brouillon → Soumis → Approuvé/Rejeté,
  préparateur et approbateur distincts.
- **AffectationChantier** : intervenant × chantier × rôle, période, **accès portail**.
- **EvenementChantier** : historique daté du chantier (création, statut, avenants, affectations, notes).

Montants : `Decimal(18,0)` (le franc CFA s'utilise sans subdivision). Dates de chantier : type `date`.

### Règles de calcul
- Marché actualisé = marché initial + Σ avenants **approuvés**.
- Fin actualisée = fin contractuelle + Σ délais des avenants **approuvés**.
- En retard = statut En cours/Suspendu et fin actualisée < aujourd'hui (Dakar).
- Marge prévisionnelle = marché actualisé − budget de référence (budget actualisé s'il existe, sinon initial).
  Non calculée si aucun budget n'est saisi.
- Marge actualisée, coûts engagés/payés : étape 4 (module financier).

## 3 bis. Modèle de données (étape 2)

- **Ouvrage** + **ComposantOuvrage** : bibliothèque d'ouvrages avec sous-détail (matériaux, main-d'œuvre, matériel,
  sous-traitance, transport, divers). Déboursé sec unitaire = Σ quantité × prix des composants.
- **Devis** (numéro `DV-AAAA-NNN`, variante A, B…, version 1, 2…) + **LigneDevis** (lot, désignation, unité, quantité,
  déboursé sec unitaire ou prix imposé, origine : saisie / bibliothèque / import, **vérifiée par** une personne)
  + **SousDetailLigne**. Statuts : Brouillon → Soumis → Validé → Envoyé → Accepté/Refusé ; une nouvelle version
  rend la précédente « Remplacée ». Un devis accepté peut créer un chantier (ou alimenter un chantier existant).
- **LigneBudget** : budget détaillé par lot et par poste ; montant initial (figé à la validation) et montant actualisé
  (révisions motivées, tracées dans l'historique du chantier). Statut du budget porté par le chantier.
- **TachePlanning** (tâche, sous-tâche, jalon ; dates prévues, de référence, réelles ; avancement ; lot, corps d'état,
  équipe, intervenant) + **DependanceTache** (fin → début avec décalage).
- **RapportJournalier** (un par chantier et par jour) : météo, effectifs, travaux, matériaux reçus/consommés, matériel,
  incidents, sécurité, visiteurs, instructions ; empreinte SHA-256 du contenu à la validation.
- **Document** + **VersionDocument** + **Fichier** : versions numérotées avec indice, statut (en attente, approuvée,
  en vigueur, remplacée, rejetée), validité, partage portail par rôle ; fichiers stockés en base (4 Mo max).

### Règles de calcul (étape 2)
- Coefficient de vente K = (1 + frais de chantier) × (1 + frais généraux) × (1 + marge).
- Prix unitaire = arrondi(déboursé sec unitaire × K), sauf prix imposé. Montant = arrondi(quantité × PU).
- Frais de chantier = DS × taux FC ; frais généraux = (DS + FC) × taux FG ; coût de revient = DS + FC + FG ;
  marge = total HT − coût de revient ; TVA 18 % par défaut (taux modifiable par devis).
- Budget issu d'un devis = coût de revient, ventilé par lot et par poste (écart d'arrondi reporté sur la plus grosse ligne).
- Planning : dates des tâches parentes = enveloppe des sous-tâches ; chemin critique par passes avant/arrière
  (jours calendaires inclus) ; retard = tâche non terminée (avancement < 100 %, pas de fin réelle) dont la fin prévue est dépassée.
- Validation d'un rapport : l'avancement déclaré est reporté sur les tâches du planning.

## 4. Sécurité

- Pas d'inscription libre ; comptes créés par l'administrateur avec mot de passe provisoire à changer.
- Mots de passe : 10 caractères minimum, lettres + chiffres, bcrypt coût 12.
- 5 échecs → compte verrouillé 15 min ; messages d'erreur identiques que le compte existe ou non.
- Cookie de session `HttpOnly`, `Secure` en production, `SameSite=Lax` ; actions serveur protégées par Next.js contre le CSRF (contrôle d'origine).
- Changement de rôle ou désactivation → toutes les sessions de l'utilisateur sont fermées.
- **Contrôle côté serveur** sur chaque page et chaque action : rôle (matrice) + périmètre (chantiers affectés).
  Un identifiant de chantier hors périmètre renvoie « Page introuvable » (on ne révèle pas son existence).
- Comptes externes : n'accèdent qu'aux chantiers où leur fiche a une affectation **avec accès portail ouvert** ;
  pas d'accès aux fiches intervenants, budgets, marges, historique interne, avenants non approuvés.
- Séparation des tâches : un avenant, un devis, un budget, un rapport journalier ou une version de document
  ne peut être approuvé par celui qui l'a préparé.
- Fichiers déposés : type vérifié sur le contenu réel (un fichier HTML renommé en .pdf est refusé), 4 Mo maximum,
  téléchargement uniquement via une route qui revérifie les droits ; un plan remplacé, en attente ou rejeté est
  tamponné à la volée et suffixé dans son nom ; le portail ne reçoit que la version en vigueur des documents partagés.
- Devis : les coûts (déboursés secs, marges) ne figurent ni sur le PDF client ni sur l'export Excel sans droit « coûts ».
- En-têtes : HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy.
- Journal d'audit : connexions, échecs, verrouillages, créations/modifications, approbations, ouvertures de portail.

## 5. Sauvegardes et restauration

- Hébergement géré (ex. Supabase) : activer les sauvegardes quotidiennes / PITR de l'offre.
- Dans tous les cas : `scripts/sauvegarde.sh` (pg_dump quotidien, conservation 30 jours), copie hors site.
- Restauration : `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" fichier.dump`, à tester chaque trimestre.
