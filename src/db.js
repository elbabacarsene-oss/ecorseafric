'use strict';
// Base de données relationnelle SQLite (module natif node:sqlite).
// Toutes les tables métier portent un org_id : chaque entreprise cliente du
// SaaS est isolée des autres, et le filtre est appliqué dans chaque requête serveur.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organisations (
  id INTEGER PRIMARY KEY,
  nom TEXT NOT NULL,
  devise TEXT NOT NULL DEFAULT 'XOF',
  fuseau TEXT NOT NULL DEFAULT 'Africa/Dakar',
  majoration_hs_pct REAL NOT NULL DEFAULT 15,   -- majoration des heures supplémentaires
  heures_jour_standard REAL NOT NULL DEFAULT 8,
  tva_pct REAL NOT NULL DEFAULT 18,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nom TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','direction','conducteur','chef_chantier','metreur','comptable')),
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chantiers (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  code TEXT NOT NULL,
  nom TEXT NOT NULL,
  type_projet TEXT,
  client TEXT,
  adresse TEXT,
  ville TEXT,
  region TEXT,
  date_debut TEXT,
  date_fin_prevue TEXT,
  montant_marche REAL NOT NULL DEFAULT 0,
  budget_initial REAL NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'preparation' CHECK (statut IN ('preparation','en_cours','suspendu','termine','receptionne')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, code)
);

-- Accès d'un utilisateur à un chantier (conducteurs et chefs de chantier)
CREATE TABLE IF NOT EXISTS user_chantiers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chantier_id INTEGER NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, chantier_id)
);

CREATE TABLE IF NOT EXISTS ouvriers (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  matricule TEXT NOT NULL,
  nom TEXT NOT NULL,
  prenom TEXT,
  metier TEXT NOT NULL,
  categorie TEXT,
  telephone TEXT,
  taux_horaire REAL NOT NULL CHECK (taux_horaire >= 0),
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, matricule)
);

CREATE TABLE IF NOT EXISTS affectations (
  ouvrier_id INTEGER NOT NULL REFERENCES ouvriers(id) ON DELETE CASCADE,
  chantier_id INTEGER NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  PRIMARY KEY (ouvrier_id, chantier_id)
);

-- Pointage journalier. Le taux horaire est figé au moment de la saisie
-- pour que les coûts historiques ne changent pas si le taux évolue.
CREATE TABLE IF NOT EXISTS pointages (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  chantier_id INTEGER NOT NULL REFERENCES chantiers(id),
  ouvrier_id INTEGER NOT NULL REFERENCES ouvriers(id),
  date TEXT NOT NULL,
  presence TEXT NOT NULL CHECK (presence IN ('present','absent','demi_journee','conge','maladie','absence_autorisee')),
  heures_normales REAL NOT NULL DEFAULT 0 CHECK (heures_normales >= 0 AND heures_normales <= 24),
  heures_sup REAL NOT NULL DEFAULT 0 CHECK (heures_sup >= 0 AND heures_sup <= 24),
  taux_horaire REAL NOT NULL,
  majoration_hs_pct REAL NOT NULL,
  observation TEXT,
  statut TEXT NOT NULL DEFAULT 'saisi' CHECK (statut IN ('saisi','valide','rejete')),
  saisi_par INTEGER NOT NULL REFERENCES users(id),
  saisi_le TEXT NOT NULL DEFAULT (datetime('now')),
  valide_par INTEGER REFERENCES users(id),
  valide_le TEXT,
  motif_rejet TEXT,
  UNIQUE (ouvrier_id, chantier_id, date)
);
CREATE INDEX IF NOT EXISTS idx_pointages_chantier_date ON pointages(chantier_id, date);

-- Bibliothèque de ressources (prix élémentaires)
CREATE TABLE IF NOT EXISTS ressources (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  type TEXT NOT NULL CHECK (type IN ('main_oeuvre','materiau','materiel','sous_traitance')),
  code TEXT NOT NULL,
  designation TEXT NOT NULL,
  unite TEXT NOT NULL,
  prix_unitaire REAL NOT NULL CHECK (prix_unitaire >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, code)
);

-- Bibliothèque d'ouvrages : chaque ouvrage a un sous-détail de prix
CREATE TABLE IF NOT EXISTS ouvrages (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  code TEXT NOT NULL,
  designation TEXT NOT NULL,
  lot TEXT NOT NULL,
  unite TEXT NOT NULL,
  quantite_base REAL NOT NULL DEFAULT 1 CHECK (quantite_base > 0), -- le sous-détail est établi pour cette quantité
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS ouvrage_composants (
  id INTEGER PRIMARY KEY,
  ouvrage_id INTEGER NOT NULL REFERENCES ouvrages(id) ON DELETE CASCADE,
  ressource_id INTEGER NOT NULL REFERENCES ressources(id),
  quantite REAL NOT NULL CHECK (quantite >= 0),
  pertes_pct REAL NOT NULL DEFAULT 0 CHECK (pertes_pct >= 0)
);

-- Étude de prix (devis) fondée sur les déboursés secs
CREATE TABLE IF NOT EXISTS etudes (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id),
  chantier_id INTEGER REFERENCES chantiers(id),
  reference TEXT NOT NULL,
  objet TEXT NOT NULL,
  client TEXT,
  frais_chantier_pct REAL NOT NULL DEFAULT 0,
  frais_generaux_pct REAL NOT NULL DEFAULT 0,
  aleas_pct REAL NOT NULL DEFAULT 0,
  benefice_pct REAL NOT NULL DEFAULT 0,
  tva_pct REAL NOT NULL DEFAULT 18,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','valide','accepte','refuse')),
  cree_par INTEGER REFERENCES users(id),
  valide_par INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (org_id, reference)
);

-- Ligne d'étude : le déboursé sec unitaire est copié depuis l'ouvrage
-- (décomposé par nature) afin que l'étude reste stable si la bibliothèque change.
CREATE TABLE IF NOT EXISTS etude_lignes (
  id INTEGER PRIMARY KEY,
  etude_id INTEGER NOT NULL REFERENCES etudes(id) ON DELETE CASCADE,
  ouvrage_id INTEGER REFERENCES ouvrages(id) ON DELETE SET NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  lot TEXT,
  designation TEXT NOT NULL,
  unite TEXT NOT NULL,
  quantite REAL NOT NULL CHECK (quantite >= 0),
  ds_main_oeuvre REAL NOT NULL DEFAULT 0,
  ds_materiau REAL NOT NULL DEFAULT 0,
  ds_materiel REAL NOT NULL DEFAULT 0,
  ds_sous_traitance REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  entite TEXT NOT NULL,
  entite_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  migrer(db);
  return db;
}

// Migrations incrémentales pour les bases déjà créées
function migrer(db) {
  const cols = db.prepare('PRAGMA table_info(organisations)').all().map((c) => c.name);
  if (!cols.includes('logo')) db.exec('ALTER TABLE organisations ADD COLUMN logo BLOB');
  if (!cols.includes('logo_type')) db.exec('ALTER TABLE organisations ADD COLUMN logo_type TEXT');
  if (!cols.includes('logo_version')) db.exec('ALTER TABLE organisations ADD COLUMN logo_version INTEGER NOT NULL DEFAULT 0');
}

// Exécute fn dans une transaction (annulée en cas d'erreur).
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, tx };
