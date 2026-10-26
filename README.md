# ECORSE AFRIC BTP MANAGER 360

ERP BTP d'ECORSE AFRIC (Sénégal) : chantiers, parties prenantes, études, finances, QHSE.
Langue : français · Devise : franc CFA (XOF) · Fuseau : Africa/Dakar.

**État : étape 2** — en plus du socle (authentification, rôles, entreprise, parties prenantes, chantiers, avenants,
tableau de bord) : bibliothèque d'ouvrages, devis (DQE/BPU, sous-détails, import de quantités, validation, PDF/Excel,
transformation en chantier), budgets détaillés, planning Gantt avec chemin critique, rapports journaliers mobiles,
gestion documentaire avec versions.
Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/BILAN_ETAPE_1.md](docs/BILAN_ETAPE_1.md) et [docs/BILAN_ETAPE_2.md](docs/BILAN_ETAPE_2.md).

## Démarrage local

Prérequis : Node.js 20+, PostgreSQL 14+ (ou `docker compose up -d db`).

```bash
npm install
cp .env.example .env          # renseigner DATABASE_URL
npx prisma migrate deploy     # crée les tables
npm run creer-admin -- admin@ecorse-afric.sn "Prénom" "Nom"   # affiche un mot de passe provisoire
npm run dev                   # http://localhost:3000
```

Aucune donnée fictive n'est insérée : la base démarre vide, l'administrateur crée ensuite les comptes
(Administration › Utilisateurs) et les données métier.

## Tests

```bash
npm test             # tests unitaires (calculs, devis, planning, imports, formats, matrice des permissions)
npm run build && npm run test:e2e   # tests de bout en bout sur la base ecorse_btp_test (vidée à chaque exécution)
```

`DATABASE_URL_TEST` permet de changer la base de test. Ne jamais la faire pointer vers la production.

## Production

```bash
npm ci && npm run build
DATABASE_URL=... npx prisma migrate deploy
DATABASE_URL=... npm start
```

Servir obligatoirement en HTTPS (cookies de session `Secure`). Aucun secret n'est exposé au navigateur :
seule `DATABASE_URL` est utilisée, côté serveur. Sauvegardes : voir `scripts/sauvegarde.sh` et la section
« Sauvegardes » de l'architecture.
