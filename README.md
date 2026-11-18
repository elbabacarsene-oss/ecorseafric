# ECORSE AFRIC BTP Manager 360 — Pointage & Déboursés secs

Application SaaS de gestion de chantier BTP / génie civil (Sénégal, F CFA, fuseau Africa/Dakar).
Cette première version couvre le **socle** (authentification, rôles, entreprise, chantiers) et deux modules métier :

- **Pointage du personnel** : saisie journalière sur smartphone par le chef de chantier, validation par un responsable (principe des quatre yeux), coût de main-d'œuvre par chantier, métier, ouvrier, jour ou mois, export Excel.
- **Déboursés secs** : ressources et prix élémentaires, bibliothèque d'ouvrages avec sous-détails de prix, études de prix (DS → coefficient K → prix de vente HT/TTC), validation, variantes, export Excel, impression PDF.

Les deux modules sont reliés : la **main-d'œuvre réelle** (pointages validés) est comparée à la **main-d'œuvre prévue** au déboursé sec de l'étude acceptée du chantier.

## Pointage sur le chantier, même sans réseau
L'application s'installe sur le téléphone (menu du navigateur → « Ajouter à l'écran d'accueil »). Sans connexion, le chef de chantier pointe normalement : la saisie est gardée sur l'appareil et envoyée automatiquement au retour du réseau, sans doublon. Si quelqu'un a modifié la même ligne entre-temps, elle n'est pas écrasée et apparaît dans « Synchronisation ».

## Fonctionnement du SaaS
- **Inscription libre** : chaque entreprise crée son espace et en devient l'administrateur. Les espaces sont totalement isolés.
- **Confirmation de l'e-mail** obligatoire avant d'accéder à l'espace ; **mot de passe oublié** par lien envoyé par e-mail (Brevo).
- **Essai gratuit de 24 h**, qui démarre à la confirmation de l'e-mail.
- **Abonnement payé par Wave** (1, 3, 6 ou 12 mois). Sans abonnement actif, l'espace passe en **lecture seule** : les données restent consultables, la saisie est bloquée.

## Démarrage en local

Prérequis : Node.js ≥ 20 et PostgreSQL ≥ 14.

```bash
npm install
createdb btp                                   # ou via psql
DATABASE_URL=postgres://utilisateur:mdp@localhost:5432/btp npm start   # http://localhost:3000
```
Sans clé Brevo, les e-mails (lien de confirmation, réinitialisation) s'affichent dans la console du serveur. Sans clé Wave ni tarif, le paiement en ligne est désactivé.

**Tests** (effacent la base de test à chaque lancement) :
```bash
createdb btp_test
DATABASE_URL_TEST=postgres://utilisateur:mdp@localhost:5432/btp_test npm test
```

Toutes les variables de configuration sont décrites dans [.env.example](.env.example).

## Mise en production
Déploiement sur **Render** en quelques clics grâce à `render.yaml` (application + PostgreSQL gérée, région Francfort). Railway, Scalingo et serveur Docker sont aussi pris en charge : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

Tarif configuré : **15 000 F CFA par mois** (1, 3, 6 ou 12 mois), essai gratuit de 24 h.

**Logos** : chaque entreprise importe le sien (PNG, JPEG ou WebP, 300 Ko max.) dans « Utilisateurs & paramètres ». `public/logo.svg` est le logo du produit, affiché sur la page de connexion.

Détails techniques, modèle de données, matrice des permissions et formules : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
