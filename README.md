# ECORSE AFRIC BTP Manager 360 — Pointage & Déboursés secs

Application SaaS de gestion de chantier BTP / génie civil (Sénégal, F CFA, fuseau Africa/Dakar).
Cette première version couvre le **socle** (authentification, rôles, entreprise, chantiers) et deux modules métier :

- **Pointage du personnel** : saisie journalière sur smartphone par le chef de chantier, validation par un responsable (principe des quatre yeux), coût de main-d'œuvre par chantier, métier, ouvrier, jour ou mois, export Excel.
- **Déboursés secs** : ressources et prix élémentaires, bibliothèque d'ouvrages avec sous-détails de prix, études de prix (DS → coefficient K → prix de vente HT/TTC), validation, variantes, export Excel, impression PDF.

Les deux modules sont reliés : la **main-d'œuvre réelle** (pointages validés) est comparée à la **main-d'œuvre prévue** au déboursé sec de l'étude acceptée du chantier.

## Démarrage

Prérequis : Node.js ≥ 22.5 (la base SQLite utilise le module intégré `node:sqlite`, sans dépendance native).

```bash
npm install
npm start            # http://localhost:3000
npm test             # tests automatisés (formules, droits, isolation)
```

À la première visite, cliquez « Créer un espace entreprise » : vous devenez administrateur.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | Port HTTP |
| `DB_FILE` | `data/btp.db` | Fichier de base de données |
| `COOKIE_SECURE` | 0 | Mettre `1` derrière HTTPS (obligatoire en production) |
| `INSCRIPTION_OUVERTE` | 1 | Mettre `0` pour interdire la création de nouveaux espaces |

**Sauvegarde** : copier le fichier `data/btp.db` (par ex. `sqlite3 data/btp.db ".backup sauvegarde.db"` via une tâche planifiée).

**Logo** : remplacer `public/logo.svg` par le logo officiel.

Détails techniques, modèle de données, matrice des permissions et formules : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
