'use strict';
const express = require('express');
const { requirePerm, can } = require('../auth');
const { tx } = require('../db');
const { HttpError, chargerChantier, filtreChantiers, audit, texte, nombre, date, choix } = require('../util');
const { calculerEtude } = require('../calc');

const STATUTS = ['preparation', 'en_cours', 'suspendu', 'termine', 'receptionne'];
const TYPES = ['Bâtiment', 'Immeuble', 'Maison', 'Route', 'Terrassement', 'Assainissement', 'VRD',
  'Clôture', 'Réhabilitation', 'Démolition', 'Génie civil', 'Aménagements extérieurs'];

function lireChantier(body, existant = {}) {
  const v = (k) => (body[k] !== undefined ? body[k] : existant[k]);
  const c = {
    code: texte(v('code'), 'Code chantier', { requis: true, max: 30 }),
    nom: texte(v('nom'), 'Nom', { requis: true, max: 160 }),
    type_projet: v('type_projet') ? choix(v('type_projet'), 'Type de projet', TYPES) : null,
    client: texte(v('client'), 'Client', { max: 160 }),
    adresse: texte(v('adresse'), 'Adresse', { max: 250 }),
    ville: texte(v('ville'), 'Ville', { max: 80 }),
    region: texte(v('region'), 'Région', { max: 80 }),
    date_debut: date(v('date_debut'), 'Date de démarrage'),
    date_fin_prevue: date(v('date_fin_prevue'), 'Date contractuelle de fin'),
    montant_marche: nombre(v('montant_marche'), 'Montant du marché', { min: 0, defaut: 0 }),
    budget_initial: nombre(v('budget_initial'), 'Budget initial', { min: 0, defaut: 0 }),
    statut: choix(v('statut'), 'Statut', STATUTS, { defaut: 'preparation' }),
  };
  if (c.date_debut && c.date_fin_prevue && c.date_fin_prevue < c.date_debut) {
    throw new HttpError(400, 'La date de fin ne peut pas précéder la date de démarrage.');
  }
  return c;
}

module.exports = function chantierRoutes(db) {
  const r = express.Router();

  r.get('/chantiers', requirePerm('chantier.lire'), (req, res) => {
    const f = filtreChantiers(db, req.user);
    const params = [req.user.org_id, ...f.params];
    let sql = `SELECT c.* FROM chantiers c WHERE c.org_id = ?${f.sql}`;
    if (req.query.statut) { sql += ' AND c.statut = ?'; params.push(String(req.query.statut)); }
    if (req.query.q) { sql += ' AND (c.code LIKE ? OR c.nom LIKE ? OR c.client LIKE ? OR c.ville LIKE ?)'; const q = `%${req.query.q}%`; params.push(q, q, q, q); }
    sql += ' ORDER BY c.created_at DESC, c.id DESC';
    res.json({ chantiers: db.prepare(sql).all(...params), types: TYPES, statuts: STATUTS });
  });

  r.post('/chantiers', requirePerm('chantier.ecrire'), (req, res) => {
    const c = lireChantier(req.body);
    if (db.prepare('SELECT 1 FROM chantiers WHERE org_id = ? AND code = ?').get(req.user.org_id, c.code)) {
      throw new HttpError(409, `Le code chantier ${c.code} existe déjà.`);
    }
    const id = tx(db, () => {
      const ins = db.prepare(`INSERT INTO chantiers (org_id, code, nom, type_projet, client, adresse, ville, region,
        date_debut, date_fin_prevue, montant_marche, budget_initial, statut) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.org_id, c.code, c.nom, c.type_projet, c.client, c.adresse, c.ville, c.region,
          c.date_debut, c.date_fin_prevue, c.montant_marche, c.budget_initial, c.statut);
      // Un conducteur qui crée un chantier y a automatiquement accès
      if (req.user.role === 'conducteur') {
        db.prepare('INSERT INTO user_chantiers (user_id, chantier_id) VALUES (?, ?)').run(req.user.id, ins.lastInsertRowid);
      }
      audit(db, req.user, 'creation', 'chantier', ins.lastInsertRowid, { code: c.code });
      return Number(ins.lastInsertRowid);
    });
    res.status(201).json({ id });
  });

  r.get('/chantiers/:id', requirePerm('chantier.lire'), (req, res) => {
    res.json(chargerChantier(db, req.user, req.params.id));
  });

  r.patch('/chantiers/:id', requirePerm('chantier.ecrire'), (req, res) => {
    const ex = chargerChantier(db, req.user, req.params.id);
    const c = lireChantier(req.body, ex);
    if (c.code !== ex.code && db.prepare('SELECT 1 FROM chantiers WHERE org_id = ? AND code = ? AND id <> ?').get(req.user.org_id, c.code, ex.id)) {
      throw new HttpError(409, `Le code chantier ${c.code} existe déjà.`);
    }
    db.prepare(`UPDATE chantiers SET code=?, nom=?, type_projet=?, client=?, adresse=?, ville=?, region=?,
      date_debut=?, date_fin_prevue=?, montant_marche=?, budget_initial=?, statut=? WHERE id=?`)
      .run(c.code, c.nom, c.type_projet, c.client, c.adresse, c.ville, c.region, c.date_debut,
        c.date_fin_prevue, c.montant_marche, c.budget_initial, c.statut, ex.id);
    audit(db, req.user, 'modification', 'chantier', ex.id, c);
    res.json({ ok: true });
  });

  // Synthèse : main-d'œuvre prévue (déboursé sec de l'étude retenue) vs réelle (pointages validés)
  r.get('/chantiers/:id/synthese', requirePerm('chantier.lire'), (req, res) => {
    const ch = chargerChantier(db, req.user, req.params.id);
    const p = db.prepare(`SELECT
        COUNT(DISTINCT ouvrier_id) AS ouvriers, COUNT(DISTINCT date) AS jours,
        COALESCE(SUM(CASE WHEN statut='valide' THEN heures_normales + heures_sup END), 0) AS heures_validees,
        COALESCE(SUM(CASE WHEN statut='valide' THEN taux_horaire * (heures_normales + heures_sup * (1 + majoration_hs_pct/100.0)) END), 0) AS cout_valide,
        COALESCE(SUM(CASE WHEN statut='saisi' THEN 1 END), 0) AS en_attente,
        COALESCE(SUM(CASE WHEN statut='saisi' THEN taux_horaire * (heures_normales + heures_sup * (1 + majoration_hs_pct/100.0)) END), 0) AS cout_en_attente
      FROM pointages WHERE chantier_id = ? AND presence IN ('present','demi_journee')`).get(ch.id);
    const affectes = db.prepare('SELECT COUNT(*) AS n FROM affectations a JOIN ouvriers o ON o.id = a.ouvrier_id WHERE a.chantier_id = ? AND o.actif = 1').get(ch.id).n;

    let prevision = null;
    if (can(req.user, 'cout.lire')) {
      // Étude de référence : acceptée en priorité, sinon la dernière validée
      const etude = db.prepare(`SELECT * FROM etudes WHERE chantier_id = ? AND statut IN ('accepte','valide')
        ORDER BY statut = 'accepte' DESC, id DESC LIMIT 1`).get(ch.id);
      if (etude) {
        const calc = calculerEtude(etude, db.prepare('SELECT * FROM etude_lignes WHERE etude_id = ? ORDER BY ordre, id').all(etude.id));
        prevision = { etude_id: etude.id, reference: etude.reference, statut: etude.statut, debourse_sec: calc.debourse_sec, ds_par_nature: calc.ds_par_nature, total_ht: calc.total_ht };
      }
    }
    const out = {
      chantier: ch, ouvriers_affectes: affectes,
      pointage: { ouvriers_pointes: p.ouvriers, jours_pointes: p.jours, heures_validees: p.heures_validees, lignes_en_attente: p.en_attente },
      prevision,
    };
    if (can(req.user, 'cout.lire')) {
      out.pointage.cout_mo_valide = Math.round(p.cout_valide);
      out.pointage.cout_mo_en_attente = Math.round(p.cout_en_attente);
      if (prevision && prevision.ds_par_nature.main_oeuvre > 0) {
        out.consommation_mo_pct = Math.round((p.cout_valide / prevision.ds_par_nature.main_oeuvre) * 1000) / 10;
      }
    }
    res.json(out);
  });

  return r;
};
