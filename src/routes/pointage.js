'use strict';
const express = require('express');
const { requirePerm, can } = require('../auth');
const { HttpError, id, chargerChantier, filtreChantiers, audit, texte, nombre, date, choix, aujourdhuiDakar, csv } = require('../util');
const { coutPointage, normaliserHeures, round } = require('../calc');

const PRESENCES = ['present', 'absent', 'demi_journee', 'conge', 'maladie', 'absence_autorisee'];
const COUT_SQL = `p.taux_horaire * (p.heures_normales + p.heures_sup * (1 + p.majoration_hs_pct/100.0))`;
const TRAVAILLE = (p) => p.presence === 'present' || p.presence === 'demi_journee';

// Retire les informations salariales pour les rôles qui n'y ont pas droit
const masquer = (user, o) => {
  if (can(user, 'cout.lire')) return o;
  const { taux_horaire, taux_actuel, cout, majoration_hs_pct, ...reste } = o;
  return reste;
};

module.exports = function pointageRoutes(db) {
  const r = express.Router();

  // ================= Personnel =================
  r.get('/ouvriers', requirePerm('personnel.lire'), async (req, res) => {
    let sql = `SELECT o.*, COALESCE((SELECT json_agg(chantier_id) FROM affectations WHERE ouvrier_id = o.id), '[]'::json) AS chantiers
      FROM ouvriers o WHERE o.org_id = ?`;
    const params = [req.user.org_id];
    if (req.query.actif !== undefined && req.query.actif !== '') { sql += ' AND o.actif = ?'; params.push(req.query.actif === '1' ? 1 : 0); }
    if (req.query.q) { sql += ' AND (o.nom ILIKE ? OR o.prenom ILIKE ? OR o.matricule ILIKE ? OR o.metier ILIKE ?)'; const q = `%${req.query.q}%`; params.push(q, q, q, q); }
    sql += ' ORDER BY o.nom, o.prenom';
    res.json((await db.all(sql, ...params)).map((o) => masquer(req.user, o)));
  });

  const lireOuvrier = (b, ex = {}) => {
    const v = (k) => (b[k] !== undefined ? b[k] : ex[k]);
    return {
      matricule: texte(v('matricule'), 'Matricule', { requis: true, max: 30 }),
      nom: texte(v('nom'), 'Nom', { requis: true, max: 80 }),
      prenom: texte(v('prenom'), 'Prénom', { max: 80 }),
      metier: texte(v('metier'), 'Métier', { requis: true, max: 80 }),
      categorie: texte(v('categorie'), 'Catégorie', { max: 40 }),
      telephone: texte(v('telephone'), 'Téléphone', { max: 30 }),
      taux_horaire: nombre(v('taux_horaire'), 'Taux horaire', { requis: true, min: 0, max: 1e6 }),
      actif: v('actif') === undefined ? 1 : (v('actif') ? 1 : 0),
    };
  };

  r.post('/ouvriers', requirePerm('personnel.ecrire'), async (req, res) => {
    const o = lireOuvrier(req.body);
    if (await db.get('SELECT 1 FROM ouvriers WHERE org_id = ? AND matricule = ?', req.user.org_id, o.matricule)) throw new HttpError(409, `Le matricule ${o.matricule} existe déjà.`);
    const nid = await db.insert('INSERT INTO ouvriers (org_id, matricule, nom, prenom, metier, categorie, telephone, taux_horaire, actif) VALUES (?,?,?,?,?,?,?,?,?)',
      req.user.org_id, o.matricule, o.nom, o.prenom, o.metier, o.categorie, o.telephone, o.taux_horaire, o.actif);
    await audit(db, req.user, 'creation', 'ouvrier', nid, { matricule: o.matricule });
    res.status(201).json({ id: nid });
  });

  r.patch('/ouvriers/:id', requirePerm('personnel.ecrire'), async (req, res) => {
    const ex = await db.get('SELECT * FROM ouvriers WHERE id = ? AND org_id = ?', id(req.params.id, 'Ouvrier'), req.user.org_id);
    if (!ex) throw new HttpError(404, 'Ouvrier introuvable.');
    const o = lireOuvrier(req.body, ex);
    if (o.matricule !== ex.matricule && await db.get('SELECT 1 FROM ouvriers WHERE org_id = ? AND matricule = ? AND id <> ?', req.user.org_id, o.matricule, ex.id)) {
      throw new HttpError(409, `Le matricule ${o.matricule} existe déjà.`);
    }
    await db.run('UPDATE ouvriers SET matricule=?, nom=?, prenom=?, metier=?, categorie=?, telephone=?, taux_horaire=?, actif=? WHERE id=?',
      o.matricule, o.nom, o.prenom, o.metier, o.categorie, o.telephone, o.taux_horaire, o.actif, ex.id);
    await audit(db, req.user, 'modification', 'ouvrier', ex.id, { avant: { taux_horaire: ex.taux_horaire }, apres: { taux_horaire: o.taux_horaire } });
    res.json({ ok: true });
  });

  // Affectation des ouvriers à un chantier
  r.get('/chantiers/:id/ouvriers', requirePerm('personnel.lire'), async (req, res) => {
    const ch = await chargerChantier(db, req.user, req.params.id);
    res.json((await db.all(`SELECT o.* FROM affectations a JOIN ouvriers o ON o.id = a.ouvrier_id
      WHERE a.chantier_id = ? ORDER BY o.nom, o.prenom`, ch.id)).map((o) => masquer(req.user, o)));
  });

  r.put('/chantiers/:id/ouvriers', requirePerm('personnel.ecrire'), async (req, res) => {
    const ch = await chargerChantier(db, req.user, req.params.id);
    if (!Array.isArray(req.body.ouvrier_ids)) throw new HttpError(400, 'Liste ouvrier_ids attendue.');
    const ids = [...new Set(req.body.ouvrier_ids.map((x) => id(x, 'Ouvrier')))];
    await db.tx(async (t) => {
      const n = ids.length ? (await t.get('SELECT COUNT(*) AS n FROM ouvriers WHERE org_id = ? AND id = ANY(?::int[])', req.user.org_id, ids)).n : 0;
      if (n !== ids.length) throw new HttpError(400, 'Ouvrier invalide.');
      await t.run('DELETE FROM affectations WHERE chantier_id = ?', ch.id);
      for (const oid of ids) await t.run('INSERT INTO affectations (ouvrier_id, chantier_id) VALUES (?, ?)', oid, ch.id);
      await audit(t, req.user, 'affectation', 'chantier', ch.id, { ouvrier_ids: ids });
    });
    res.json({ ok: true });
  });

  // ================= Pointage journalier =================

  // Feuille de pointage d'un chantier pour une date : ouvriers affectés + lignes déjà saisies
  r.get('/chantiers/:id/pointage', requirePerm('pointage.lire'), async (req, res) => {
    const ch = await chargerChantier(db, req.user, req.params.id);
    const jour = date(req.query.date, 'Date') || aujourdhuiDakar();
    const lignes = (await db.all(`
      SELECT o.id AS ouvrier_id, o.matricule, o.nom, o.prenom, o.metier, o.taux_horaire AS taux_actuel, o.actif,
        p.id, p.presence, p.heures_normales, p.heures_sup, p.observation, p.statut, p.taux_horaire, p.majoration_hs_pct,
        p.motif_rejet, p.saisi_le, p.version, us.nom AS saisi_par_nom, uv.nom AS valide_par_nom, p.saisi_par
      FROM ouvriers o
      LEFT JOIN pointages p ON p.ouvrier_id = o.id AND p.chantier_id = ? AND p.date = ?
      LEFT JOIN users us ON us.id = p.saisi_par
      LEFT JOIN users uv ON uv.id = p.valide_par
      WHERE o.org_id = ? AND (
        (o.actif = 1 AND o.id IN (SELECT ouvrier_id FROM affectations WHERE chantier_id = ?))
        OR p.id IS NOT NULL)
      ORDER BY o.nom, o.prenom`, ch.id, jour, req.user.org_id, ch.id))
      .map((l) => masquer(req.user, { ...l, cout: l.id ? round(coutPointage(l)) : null }));
    const org = await db.get('SELECT heures_jour_standard, majoration_hs_pct FROM organisations WHERE id = ?', req.user.org_id);
    res.json({ chantier: { id: ch.id, code: ch.code, nom: ch.nom }, date: jour, heures_jour_standard: org.heures_jour_standard, lignes });
  });

  // Enregistrement (création ou correction) de la feuille de pointage
  r.put('/chantiers/:id/pointage', requirePerm('pointage.saisir'), async (req, res) => {
    const ch = await chargerChantier(db, req.user, req.params.id);
    const jour = date(req.body.date, 'Date', { requis: true });
    if (jour > aujourdhuiDakar()) throw new HttpError(400, 'Impossible de pointer une date future.');
    if (!Array.isArray(req.body.lignes) || req.body.lignes.length === 0) throw new HttpError(400, 'Aucune ligne de pointage.');
    if (req.body.lignes.length > 500) throw new HttpError(400, 'Trop de lignes dans une seule feuille.');
    const org = await db.get('SELECT * FROM organisations WHERE id = ?', req.user.org_id);
    // Identifiant d'opération fourni par l'appareil (mode hors ligne) : un renvoi n'est jamais appliqué deux fois
    const opId = req.body.operation_id === undefined ? null : String(req.body.operation_id);
    if (opId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opId)) throw new HttpError(400, 'Identifiant d\'opération invalide.');
    const horsLigne = req.body.saisi_hors_ligne_le ? String(req.body.saisi_hors_ligne_le).slice(0, 40) : null;

    const resultat = { enregistrees: 0, ignorees: [], conflits: [], versions: {} };
    let deja = null;
    await db.tx(async (t) => {
      if (opId) {
        // Si une requête identique est en cours, cette insertion attend sa fin : pas de double application
        const n = await t.run('INSERT INTO operations_sync (id, org_id, user_id) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING', opId, req.user.org_id, req.user.id);
        if (n === 0) { deja = await t.get('SELECT * FROM operations_sync WHERE id = ?', opId); return; }
      }
      for (const l of req.body.lignes) {
        const o = await t.get(`SELECT o.* FROM ouvriers o JOIN affectations a ON a.ouvrier_id = o.id
          WHERE o.id = ? AND a.chantier_id = ? AND o.org_id = ? AND o.actif = 1`, id(l.ouvrier_id, 'Ouvrier'), ch.id, req.user.org_id);
        if (!o) throw new HttpError(400, `Ouvrier ${l.ouvrier_id} non affecté à ce chantier ou inactif.`);
        const presence = choix(l.presence, 'Présence', PRESENCES);
        const h = normaliserHeures(presence,
          nombre(l.heures_normales, 'Heures normales', { min: 0, max: 24 }),
          nombre(l.heures_sup, 'Heures supplémentaires', { min: 0, max: 24 }), org.heures_jour_standard);
        // Verrou sur l'ouvrier : deux saisies simultanées ne peuvent pas dépasser 24 h à elles deux
        await t.run('SELECT 1 FROM ouvriers WHERE id = ? FOR UPDATE', o.id);
        const ailleurs = (await t.get(`SELECT COALESCE(SUM(heures_normales + heures_sup), 0) AS h FROM pointages
          WHERE ouvrier_id = ? AND date = ? AND chantier_id <> ?`, o.id, jour, ch.id)).h;
        if (h.heures_normales + h.heures_sup + ailleurs > 24) throw new HttpError(400, `${o.nom} ${o.prenom || ''} : plus de 24 h pointées le ${jour} (tous chantiers confondus).`);
        const obs = texte(l.observation, 'Observation', { max: 300 });
        const ex = await t.get('SELECT * FROM pointages WHERE ouvrier_id = ? AND chantier_id = ? AND date = ? FOR UPDATE', o.id, ch.id, jour);
        if (ex && ex.statut === 'valide') { resultat.ignorees.push({ ouvrier_id: o.id, raison: 'Pointage déjà validé' }); continue; }
        // Conflit : la ligne a changé depuis que l'appareil l'a lue (autre saisie, validation, rejet)
        if (Object.prototype.hasOwnProperty.call(l, 'version')) {
          const attendue = l.version === null ? null : Number(l.version);
          if ((ex ? ex.version : null) !== attendue) {
            const auteur = ex ? (await t.get('SELECT nom FROM users WHERE id = ?', ex.valide_par || ex.saisi_par) || {}).nom : null;
            resultat.conflits.push({ ouvrier_id: o.id, nom: `${o.nom} ${o.prenom || ''}`.trim(), version_serveur: ex ? ex.version : null,
              statut_serveur: ex ? ex.statut : null,
              raison: `Ligne modifiée entre-temps${auteur ? ` par ${auteur}` : ''}${ex && ex.statut === 'rejete' ? ' (rejetée)' : ''}. Votre saisie n'a pas été appliquée.` });
            continue;
          }
        }
        if (ex) {
          await t.run(`UPDATE pointages SET presence=?, heures_normales=?, heures_sup=?, taux_horaire=?, majoration_hs_pct=?,
            observation=?, statut='saisi', saisi_par=?, saisi_le=now(), valide_par=NULL, valide_le=NULL, motif_rejet=NULL, version = version + 1 WHERE id=?`,
            presence, h.heures_normales, h.heures_sup, o.taux_horaire, org.majoration_hs_pct, obs, req.user.id, ex.id);
          resultat.versions[o.id] = ex.version + 1;
        } else {
          resultat.versions[o.id] = 1;
          await t.run(`INSERT INTO pointages (org_id, chantier_id, ouvrier_id, date, presence, heures_normales, heures_sup,
            taux_horaire, majoration_hs_pct, observation, saisi_par) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            req.user.org_id, ch.id, o.id, jour, presence, h.heures_normales, h.heures_sup, o.taux_horaire, org.majoration_hs_pct, obs, req.user.id);
        }
        resultat.enregistrees++;
      }
      await audit(t, req.user, 'saisie_pointage', 'chantier', ch.id,
        { date: jour, lignes: resultat.enregistrees, conflits: resultat.conflits.length || undefined, hors_ligne: horsLigne || undefined, operation: opId || undefined });
      if (opId) {
        await t.run('UPDATE operations_sync SET resultat = ? WHERE id = ?', JSON.stringify(resultat), opId);
        await t.run(`DELETE FROM operations_sync WHERE created_at < now() - interval '60 days'`);
      }
    });
    if (deja) {
      if (deja.user_id !== req.user.id) throw new HttpError(409, 'Identifiant d\'opération déjà utilisé.');
      return res.json({ ...deja.resultat, rejouee: true });
    }
    res.json(resultat);
  });

  // Validation ou rejet. Principe des quatre yeux : on ne valide pas sa propre saisie (sauf administrateur).
  r.post('/chantiers/:id/pointage/validation', requirePerm('pointage.valider'), async (req, res) => {
    const ch = await chargerChantier(db, req.user, req.params.id);
    const jour = date(req.body.date, 'Date', { requis: true });
    const action = choix(req.body.action, 'Action', ['valider', 'rejeter']);
    const motif = texte(req.body.motif, 'Motif', { max: 300, requis: action === 'rejeter' });
    const filtreIds = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : null;

    const resultat = { traitees: 0, ignorees: [] };
    await db.tx(async (t) => {
      const lignes = (await t.all(`SELECT * FROM pointages WHERE chantier_id = ? AND date = ? AND statut = 'saisi' FOR UPDATE`, ch.id, jour))
        .filter((p) => !filtreIds || filtreIds.includes(p.id));
      for (const p of lignes) {
        if (p.saisi_par === req.user.id && req.user.role !== 'admin') {
          resultat.ignorees.push({ id: p.id, raison: 'Vous ne pouvez pas valider votre propre saisie.' });
          continue;
        }
        await t.run(`UPDATE pointages SET statut = ?, valide_par = ?, valide_le = now(), motif_rejet = ?, version = version + 1 WHERE id = ?`,
          action === 'valider' ? 'valide' : 'rejete', req.user.id, action === 'rejeter' ? motif : null, p.id);
        resultat.traitees++;
      }
      await audit(t, req.user, action === 'valider' ? 'validation_pointage' : 'rejet_pointage', 'chantier', ch.id, { date: jour, lignes: resultat.traitees, motif });
    });
    res.json(resultat);
  });

  // Déverrouillage d'un pointage validé (correction) : réservé à la direction et à l'administrateur
  r.post('/pointages/:id/deverrouiller', requirePerm('pointage.valider'), async (req, res) => {
    if (!['admin', 'direction'].includes(req.user.role)) throw new HttpError(403, 'Réservé à la direction.');
    const p = await db.get('SELECT * FROM pointages WHERE id = ? AND org_id = ?', id(req.params.id, 'Pointage'), req.user.org_id);
    if (!p) throw new HttpError(404, 'Pointage introuvable.');
    const motif = texte(req.body.motif, 'Motif', { requis: true, max: 300 });
    await db.run(`UPDATE pointages SET statut = 'saisi', valide_par = NULL, valide_le = NULL, version = version + 1 WHERE id = ?`, p.id);
    await audit(db, req.user, 'deverrouillage_pointage', 'pointage', p.id, { motif, avant: p });
    res.json({ ok: true });
  });

  // ================= Consultation, coûts et exports =================
  async function requetePointages(req) {
    const f = await filtreChantiers(db, req.user, 'p.chantier_id');
    const params = [req.user.org_id, ...f.params];
    let where = `p.org_id = ?${f.sql}`;
    const du = date(req.query.du, 'Du'); const au = date(req.query.au, 'Au');
    if (du) { where += ' AND p.date >= ?'; params.push(du); }
    if (au) { where += ' AND p.date <= ?'; params.push(au); }
    if (req.query.chantier_id) { where += ' AND p.chantier_id = ?'; params.push(id(req.query.chantier_id, 'Chantier')); }
    if (req.query.ouvrier_id) { where += ' AND p.ouvrier_id = ?'; params.push(id(req.query.ouvrier_id, 'Ouvrier')); }
    if (req.query.statut) { where += ' AND p.statut = ?'; params.push(choix(req.query.statut, 'Statut', ['saisi', 'valide', 'rejete'])); }
    return { where, params };
  }

  const listePointages = async (req) => {
    const { where, params } = await requetePointages(req);
    return (await db.all(`SELECT p.*, c.code AS chantier_code, c.nom AS chantier_nom, o.matricule, o.nom, o.prenom, o.metier,
        ${COUT_SQL} AS cout, us.nom AS saisi_par_nom, uv.nom AS valide_par_nom
      FROM pointages p JOIN chantiers c ON c.id = p.chantier_id JOIN ouvriers o ON o.id = p.ouvrier_id
      LEFT JOIN users us ON us.id = p.saisi_par LEFT JOIN users uv ON uv.id = p.valide_par
      WHERE ${where} ORDER BY p.date DESC, c.code, o.nom LIMIT 5000`, ...params))
      .map((p) => masquer(req.user, { ...p, cout: TRAVAILLE(p) ? round(p.cout) : 0 }));
  };

  r.get('/pointages', requirePerm('pointage.lire'), async (req, res) => res.json(await listePointages(req)));

  r.get('/pointages/export.csv', requirePerm('pointage.lire'), async (req, res) => {
    const cols = [
      { titre: 'Date', valeur: 'date' }, { titre: 'Chantier', valeur: 'chantier_code' },
      { titre: 'Matricule', valeur: 'matricule' }, { titre: 'Nom', valeur: (p) => `${p.nom} ${p.prenom || ''}`.trim() },
      { titre: 'Métier', valeur: 'metier' }, { titre: 'Présence', valeur: 'presence' },
      { titre: 'Heures normales', valeur: 'heures_normales' }, { titre: 'Heures sup.', valeur: 'heures_sup' },
    ];
    if (can(req.user, 'cout.lire')) cols.push({ titre: 'Taux horaire (XOF)', valeur: 'taux_horaire' }, { titre: 'Coût (XOF)', valeur: 'cout' });
    cols.push({ titre: 'Statut', valeur: 'statut' }, { titre: 'Saisi par', valeur: 'saisi_par_nom' }, { titre: 'Validé par', valeur: 'valide_par_nom' }, { titre: 'Observation', valeur: 'observation' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="pointages_${aujourdhuiDakar()}.csv"`);
    res.send(csv(await listePointages(req), cols));
  });

  // Coûts de main-d'œuvre agrégés par chantier, métier, ouvrier, jour ou mois
  r.get('/couts/main-oeuvre', requirePerm('cout.lire'), async (req, res) => {
    const groupes = { chantier: `c.code || ' — ' || c.nom`, metier: 'o.metier', ouvrier: `o.matricule || ' — ' || o.nom || ' ' || COALESCE(o.prenom, '')`, jour: `to_char(p.date, 'YYYY-MM-DD')`, mois: `to_char(p.date, 'YYYY-MM')` };
    const g = choix(req.query.groupe, 'Groupe', Object.keys(groupes), { defaut: 'chantier' });
    const { where, params } = await requetePointages(req);
    const inclureNonValides = req.query.inclure_non_valides === '1';
    const rows = (await db.all(`SELECT ${groupes[g]} AS groupe,
        COUNT(DISTINCT p.ouvrier_id) AS ouvriers, COUNT(*) AS lignes,
        SUM(p.heures_normales) AS heures_normales, SUM(p.heures_sup) AS heures_sup,
        SUM(${COUT_SQL}) AS cout
      FROM pointages p JOIN chantiers c ON c.id = p.chantier_id JOIN ouvriers o ON o.id = p.ouvrier_id
      WHERE ${where} AND p.presence IN ('present','demi_journee') ${inclureNonValides ? "AND p.statut <> 'rejete'" : "AND p.statut = 'valide'"}
      GROUP BY 1 ORDER BY ${g === 'jour' || g === 'mois' ? '1' : '6 DESC'}`, ...params))
      .map((x) => ({ ...x, cout: round(x.cout) }));
    res.json({ groupe: g, valides_uniquement: !inclureNonValides, lignes: rows, total: rows.reduce((s, x) => s + x.cout, 0) });
  });

  return r;
};
