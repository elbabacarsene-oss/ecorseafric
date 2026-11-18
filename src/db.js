'use strict';
// Accès à PostgreSQL. Toutes les tables métier portent un org_id : chaque
// entreprise cliente du SaaS est isolée, et le filtre est appliqué dans chaque requête serveur.
const { Pool, types } = require('pg');

// Conversions : entiers 64 bits et numeric en nombres JS, dates SQL en chaînes AAAA-MM-JJ
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organisations (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  devise TEXT NOT NULL DEFAULT 'XOF',
  fuseau TEXT NOT NULL DEFAULT 'Africa/Dakar',
  majoration_hs_pct DOUBLE PRECISION NOT NULL DEFAULT 15,
  heures_jour_standard DOUBLE PRECISION NOT NULL DEFAULT 8,
  tva_pct DOUBLE PRECISION NOT NULL DEFAULT 18,
  logo BYTEA,
  logo_type TEXT,
  logo_version INTEGER NOT NULL DEFAULT 0,
  essai_fin TIMESTAMPTZ,          -- fixée à la confirmation de l'e-mail de l'administrateur
  abonnement_fin TIMESTAMPTZ,     -- prolongée à chaque paiement confirmé
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nom TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','direction','conducteur','chef_chantier','metreur','comptable')),
  actif INTEGER NOT NULL DEFAULT 1,
  email_verifie BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);

-- Jetons envoyés par e-mail (confirmation d'adresse, réinitialisation). Stockés hachés, à usage unique.
CREATE TABLE IF NOT EXISTS jetons (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('verification','reinitialisation')),
  expires_at BIGINT NOT NULL,
  utilise BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS chantiers (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  nom TEXT NOT NULL,
  type_projet TEXT,
  client TEXT,
  adresse TEXT,
  ville TEXT,
  region TEXT,
  date_debut DATE,
  date_fin_prevue DATE,
  montant_marche DOUBLE PRECISION NOT NULL DEFAULT 0,
  budget_initial DOUBLE PRECISION NOT NULL DEFAULT 0,
  statut TEXT NOT NULL DEFAULT 'preparation' CHECK (statut IN ('preparation','en_cours','suspendu','termine','receptionne')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS user_chantiers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chantier_id INTEGER NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, chantier_id)
);

CREATE TABLE IF NOT EXISTS ouvriers (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  matricule TEXT NOT NULL,
  nom TEXT NOT NULL,
  prenom TEXT,
  metier TEXT NOT NULL,
  categorie TEXT,
  telephone TEXT,
  taux_horaire DOUBLE PRECISION NOT NULL CHECK (taux_horaire >= 0),
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, matricule)
);

CREATE TABLE IF NOT EXISTS affectations (
  ouvrier_id INTEGER NOT NULL REFERENCES ouvriers(id) ON DELETE CASCADE,
  chantier_id INTEGER NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  PRIMARY KEY (ouvrier_id, chantier_id)
);

-- Pointage journalier. Le taux horaire est figé au moment de la saisie.
CREATE TABLE IF NOT EXISTS pointages (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id INTEGER NOT NULL REFERENCES chantiers(id),
  ouvrier_id INTEGER NOT NULL REFERENCES ouvriers(id),
  date DATE NOT NULL,
  presence TEXT NOT NULL CHECK (presence IN ('present','absent','demi_journee','conge','maladie','absence_autorisee')),
  heures_normales DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (heures_normales >= 0 AND heures_normales <= 24),
  heures_sup DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (heures_sup >= 0 AND heures_sup <= 24),
  taux_horaire DOUBLE PRECISION NOT NULL,
  majoration_hs_pct DOUBLE PRECISION NOT NULL,
  observation TEXT,
  statut TEXT NOT NULL DEFAULT 'saisi' CHECK (statut IN ('saisi','valide','rejete')),
  saisi_par INTEGER NOT NULL REFERENCES users(id),
  saisi_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  valide_par INTEGER REFERENCES users(id),
  valide_le TIMESTAMPTZ,
  motif_rejet TEXT,
  UNIQUE (ouvrier_id, chantier_id, date)
);
CREATE INDEX IF NOT EXISTS idx_pointages_chantier_date ON pointages(chantier_id, date);
CREATE INDEX IF NOT EXISTS idx_pointages_org_date ON pointages(org_id, date);

CREATE TABLE IF NOT EXISTS ressources (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('main_oeuvre','materiau','materiel','sous_traitance')),
  code TEXT NOT NULL,
  designation TEXT NOT NULL,
  unite TEXT NOT NULL,
  prix_unitaire DOUBLE PRECISION NOT NULL CHECK (prix_unitaire >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS ouvrages (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  designation TEXT NOT NULL,
  lot TEXT NOT NULL,
  unite TEXT NOT NULL,
  quantite_base DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (quantite_base > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE IF NOT EXISTS ouvrage_composants (
  id SERIAL PRIMARY KEY,
  ouvrage_id INTEGER NOT NULL REFERENCES ouvrages(id) ON DELETE CASCADE,
  ressource_id INTEGER NOT NULL REFERENCES ressources(id),
  quantite DOUBLE PRECISION NOT NULL CHECK (quantite >= 0),
  pertes_pct DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (pertes_pct >= 0)
);

CREATE TABLE IF NOT EXISTS etudes (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  chantier_id INTEGER REFERENCES chantiers(id),
  reference TEXT NOT NULL,
  objet TEXT NOT NULL,
  client TEXT,
  frais_chantier_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  frais_generaux_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  aleas_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  benefice_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  tva_pct DOUBLE PRECISION NOT NULL DEFAULT 18,
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon','valide','accepte','refuse')),
  cree_par INTEGER REFERENCES users(id),
  valide_par INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, reference)
);

CREATE TABLE IF NOT EXISTS etude_lignes (
  id SERIAL PRIMARY KEY,
  etude_id INTEGER NOT NULL REFERENCES etudes(id) ON DELETE CASCADE,
  ouvrage_id INTEGER REFERENCES ouvrages(id) ON DELETE SET NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  lot TEXT,
  designation TEXT NOT NULL,
  unite TEXT NOT NULL,
  quantite DOUBLE PRECISION NOT NULL CHECK (quantite >= 0),
  ds_main_oeuvre DOUBLE PRECISION NOT NULL DEFAULT 0,
  ds_materiau DOUBLE PRECISION NOT NULL DEFAULT 0,
  ds_materiel DOUBLE PRECISION NOT NULL DEFAULT 0,
  ds_sous_traitance DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- Paiements d'abonnement via Wave Checkout
CREATE TABLE IF NOT EXISTS paiements (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mois INTEGER NOT NULL CHECK (mois > 0),
  montant INTEGER NOT NULL CHECK (montant > 0),
  devise TEXT NOT NULL DEFAULT 'XOF',
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','paye','echoue')),
  wave_session_id TEXT UNIQUE,
  wave_launch_url TEXT,
  wave_transaction_id TEXT,
  periode_debut TIMESTAMPTZ,
  periode_fin TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paye_le TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  entite TEXT NOT NULL,
  entite_id INTEGER,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id, id DESC);

-- Mode hors ligne : version de chaque ligne de pointage (détection des conflits)
ALTER TABLE pointages ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Opérations envoyées par les appareils : un même identifiant n'est appliqué qu'une fois
CREATE TABLE IF NOT EXISTS operations_sync (
  id TEXT PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resultat JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Remplace les « ? » par $1, $2… (aucune requête de l'application n'utilise « ? » dans une chaîne littérale)
const placeholders = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };

class Db {
  constructor(executor) { this.x = executor; }
  async query(sql, params = []) { return this.x.query(placeholders(sql), params); }
  async get(sql, ...params) { return (await this.query(sql, params)).rows[0]; }
  async all(sql, ...params) { return (await this.query(sql, params)).rows; }
  async run(sql, ...params) { return (await this.query(sql, params)).rowCount; }
  // INSERT … RETURNING id
  async insert(sql, ...params) { return (await this.query(sql + ' RETURNING id', params)).rows[0].id; }
}

class Base extends Db {
  constructor(pool) { super(pool); this.pool = pool; }
  // Exécute fn dans une transaction (annulée en cas d'erreur). fn reçoit un Db lié à la transaction.
  async tx(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(new Db(client));
      await client.query('COMMIT');
      return r;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  async close() { await this.pool.end(); }
}

const optionSsl = (mode) => {
  if (!mode) return undefined;
  if (mode === 'require') return { rejectUnauthorized: true };
  if (mode === 'no-verify') return { rejectUnauthorized: false };
  throw new Error(`DATABASE_SSL invalide : « ${mode} » (valeurs : require, no-verify)`);
};

async function openDb(connectionString, { reinitialiser = false, ssl = '' } = {}) {
  const pool = new Pool({ connectionString, ssl: optionSsl(ssl), max: Number(process.env.PG_POOL_MAX) || 10, connectionTimeoutMillis: 10000 });
  const db = new Base(pool);
  if (reinitialiser) await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  // Verrou consultatif : plusieurs instances qui démarrent ensemble n'appliquent pas le schéma en même temps
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query(SCHEMA);
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
  return db;
}

module.exports = { openDb };
