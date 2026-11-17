'use strict';
const express = require('express');
const { requirePerm, can } = require('../auth');
const { tx } = require('../db');
const { HttpError, chargerChantier, filtreChantiers, audit, texte, nombre, choix, csv } = require('../util');
const { NATURES, deboursSecOuvrage, calculerEtude, round } = require('../calc');

const UNITES = ['m', 'm²', 'm³', 'kg', 't', 'u', 'ens', 'fft', 'h', 'j', 'l', 'sac', 'voyage'];
const LOTS = ['Installation de chantier', 'Terrassement', 'Fondations', 'Béton armé', 'Maçonnerie', 'Étanchéité',
  'Charpente', 'Couverture', 'Électricité', 'Plomberie', 'Climatisation', 'Menuiserie', 'Revêtements',
  'Peinture', 'VRD', 'Assainissement', 'Aménagements extérieurs', 'Divers'];

module.exports = function debourseRoutes(db) {
  const r = express.Router();
  const LIRE = requirePerm('debourse.lire');
  const ECRIRE = requirePerm('debourse.ecrire');

  r.get('/debourse/referentiels', LIRE, (_req, res) => res.json({ unites: UNITES, lots: LOTS, natures: NATURES }));

  // ================= Ressources (prix élémentaires) =================
  r.get('/ressources', LIRE, (req, res) => {
    let sql = `SELECT r.*, (SELECT COUNT(*) FROM ouvrage_composants WHERE ressource_id = r.id) AS utilisations
      FROM ressources r WHERE r.org_id = ?`;
    const params = [req.user.org_id];
    if (req.query.type) { sql += ' AND r.type = ?'; params.push(choix(req.query.type, 'Type', NATURES)); }
    if (req.query.q) { sql += ' AND (r.code LIKE ? OR r.designation LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    res.json(db.prepare(sql + ' ORDER BY r.type, r.code').all(...params));
  });

  const lireRessource = (b, ex = {}) => {
    const v = (k) => (b[k] !== undefined ? b[k] : ex[k]);
    return {
      type: choix(v('type'), 'Type', NATURES),
      code: texte(v('code'), 'Code', { requis: true, max: 30 }),
      designation: texte(v('designation'), 'Désignation', { requis: true, max: 200 }),
      unite: texte(v('unite'), 'Unité', { requis: true, max: 15 }),
      prix_unitaire: nombre(v('prix_unitaire'), 'Prix unitaire', { requis: true, min: 0, max: 1e10 }),
    };
  };

  r.post('/ressources', ECRIRE, (req, res) => {
    const x = lireRessource(req.body);
    if (db.prepare('SELECT 1 FROM ressources WHERE org_id = ? AND code = ?').get(req.user.org_id, x.code)) throw new HttpError(409, `Le code ${x.code} existe déjà.`);
    const ins = db.prepare('INSERT INTO ressources (org_id, type, code, designation, unite, prix_unitaire) VALUES (?,?,?,?,?,?)')
      .run(req.user.org_id, x.type, x.code, x.designation, x.unite, x.prix_unitaire);
    audit(db, req.user, 'creation', 'ressource', ins.lastInsertRowid, x);
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  r.patch('/ressources/:id', ECRIRE, (req, res) => {
    const ex = db.prepare('SELECT * FROM ressources WHERE id = ? AND org_id = ?').get(Number(req.params.id), req.user.org_id);
    if (!ex) throw new HttpError(404, 'Ressource introuvable.');
    const x = lireRessource(req.body, ex);
    if (x.code !== ex.code && db.prepare('SELECT 1 FROM ressources WHERE org_id = ? AND code = ? AND id <> ?').get(req.user.org_id, x.code, ex.id)) throw new HttpError(409, `Le code ${x.code} existe déjà.`);
    db.prepare(`UPDATE ressources SET type=?, code=?, designation=?, unite=?, prix_unitaire=?, updated_at=datetime('now') WHERE id=?`)
      .run(x.type, x.code, x.designation, x.unite, x.prix_unitaire, ex.id);
    audit(db, req.user, 'modification', 'ressource', ex.id, { prix_avant: ex.prix_unitaire, prix_apres: x.prix_unitaire });
    res.json({ ok: true });
  });

  r.delete('/ressources/:id', ECRIRE, (req, res) => {
    const ex = db.prepare('SELECT * FROM ressources WHERE id = ? AND org_id = ?').get(Number(req.params.id), req.user.org_id);
    if (!ex) throw new HttpError(404, 'Ressource introuvable.');
    if (db.prepare('SELECT 1 FROM ouvrage_composants WHERE ressource_id = ?').get(ex.id)) throw new HttpError(409, 'Ressource utilisée dans un ouvrage : suppression impossible.');
    db.prepare('DELETE FROM ressources WHERE id = ?').run(ex.id);
    audit(db, req.user, 'suppression', 'ressource', ex.id, ex);
    res.json({ ok: true });
  });

  // ================= Ouvrages et sous-détails de prix =================
  const composantsStmt = db.prepare(`SELECT oc.id, oc.ressource_id, oc.quantite, oc.pertes_pct,
      r.type, r.code, r.designation, r.unite, r.prix_unitaire
    FROM ouvrage_composants oc JOIN ressources r ON r.id = oc.ressource_id WHERE oc.ouvrage_id = ? ORDER BY r.type, oc.id`);

  const detailOuvrage = (o) => {
    const composants = composantsStmt.all(o.id).map((c) => ({
      ...c, montant: round(c.quantite * (1 + c.pertes_pct / 100) * c.prix_unitaire, 2),
    }));
    const ds = deboursSecOuvrage(o.quantite_base, composants);
    return { ...o, composants, ds: Object.fromEntries(Object.entries(ds).map(([k, v]) => [k, round(v, 2)])) };
  };

  const chargerOuvrage = (req, id) => {
    const o = db.prepare('SELECT * FROM ouvrages WHERE id = ? AND org_id = ?').get(Number(id), req.user.org_id);
    if (!o) throw new HttpError(404, 'Ouvrage introuvable.');
    return o;
  };

  r.get('/ouvrages', LIRE, (req, res) => {
    let sql = 'SELECT * FROM ouvrages WHERE org_id = ?';
    const params = [req.user.org_id];
    if (req.query.lot) { sql += ' AND lot = ?'; params.push(String(req.query.lot)); }
    if (req.query.q) { sql += ' AND (code LIKE ? OR designation LIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    res.json(db.prepare(sql + ' ORDER BY lot, code').all(...params).map((o) => {
      const d = detailOuvrage(o);
      return { ...o, nb_composants: d.composants.length, ds: d.ds };
    }));
  });

  r.get('/ouvrages/:id', LIRE, (req, res) => res.json(detailOuvrage(chargerOuvrage(req, req.params.id))));

  const enregistrerOuvrage = (req, ex) => {
    const b = req.body;
    const o = {
      code: texte(b.code, 'Code', { requis: true, max: 30 }),
      designation: texte(b.designation, 'Désignation', { requis: true, max: 250 }),
      lot: choix(b.lot, 'Lot', LOTS),
      unite: texte(b.unite, 'Unité', { requis: true, max: 15 }),
      quantite_base: nombre(b.quantite_base, 'Quantité de base', { min: 0.000001, defaut: 1 }),
    };
    if (!Array.isArray(b.composants)) throw new HttpError(400, 'Le sous-détail (composants) est obligatoire.');
    const doublon = db.prepare('SELECT 1 FROM ouvrages WHERE org_id = ? AND code = ? AND id <> ?').get(req.user.org_id, o.code, ex ? ex.id : 0);
    if (doublon) throw new HttpError(409, `Le code ${o.code} existe déjà.`);
    return tx(db, () => {
      let id;
      if (ex) {
        db.prepare(`UPDATE ouvrages SET code=?, designation=?, lot=?, unite=?, quantite_base=?, updated_at=datetime('now') WHERE id=?`)
          .run(o.code, o.designation, o.lot, o.unite, o.quantite_base, ex.id);
        db.prepare('DELETE FROM ouvrage_composants WHERE ouvrage_id = ?').run(ex.id);
        id = ex.id;
      } else {
        id = Number(db.prepare('INSERT INTO ouvrages (org_id, code, designation, lot, unite, quantite_base) VALUES (?,?,?,?,?,?)')
          .run(req.user.org_id, o.code, o.designation, o.lot, o.unite, o.quantite_base).lastInsertRowid);
      }
      const chk = db.prepare('SELECT 1 FROM ressources WHERE id = ? AND org_id = ?');
      const ins = db.prepare('INSERT INTO ouvrage_composants (ouvrage_id, ressource_id, quantite, pertes_pct) VALUES (?,?,?,?)');
      for (const c of b.composants) {
        if (!chk.get(Number(c.ressource_id), req.user.org_id)) throw new HttpError(400, 'Ressource invalide dans le sous-détail.');
        ins.run(id, Number(c.ressource_id), nombre(c.quantite, 'Quantité', { requis: true, min: 0 }), nombre(c.pertes_pct, 'Pertes %', { min: 0, max: 100, defaut: 0 }));
      }
      audit(db, req.user, ex ? 'modification' : 'creation', 'ouvrage', id, { code: o.code });
      return id;
    });
  };

  r.post('/ouvrages', ECRIRE, (req, res) => res.status(201).json({ id: enregistrerOuvrage(req, null) }));
  r.put('/ouvrages/:id', ECRIRE, (req, res) => res.json({ id: enregistrerOuvrage(req, chargerOuvrage(req, req.params.id)) }));
  r.delete('/ouvrages/:id', ECRIRE, (req, res) => {
    const o = chargerOuvrage(req, req.params.id);
    db.prepare('DELETE FROM ouvrages WHERE id = ?').run(o.id); // les lignes d'étude conservent leur copie du DS
    audit(db, req.user, 'suppression', 'ouvrage', o.id, { code: o.code });
    res.json({ ok: true });
  });

  // ================= Études de prix =================
  // Accès à une étude : même organisation, et si elle est liée à un chantier, accès à ce chantier.
  const chargerEtude = (req, id) => {
    const e = db.prepare('SELECT * FROM etudes WHERE id = ? AND org_id = ?').get(Number(id), req.user.org_id);
    if (!e) throw new HttpError(404, 'Étude introuvable.');
    if (e.chantier_id) {
      try { chargerChantier(db, req.user, e.chantier_id); } catch { throw new HttpError(404, 'Étude introuvable.'); }
    }
    return e;
  };
  const exigerBrouillon = (e) => { if (e.statut !== 'brouillon') throw new HttpError(409, 'Étude validée : repassez-la en brouillon ou dupliquez-la pour la modifier.'); };
  const lignesEtude = (id) => db.prepare('SELECT * FROM etude_lignes WHERE etude_id = ? ORDER BY ordre, id').all(id);

  r.get('/etudes', LIRE, (req, res) => {
    const f = filtreChantiers(db, req.user, 'e.chantier_id');
    // Les rôles restreints voient aussi les études non rattachées à un chantier
    const fsql = f.sql ? ` AND (e.chantier_id IS NULL OR (1 ${f.sql}))` : '';
    const etudes = db.prepare(`SELECT e.*, c.code AS chantier_code FROM etudes e LEFT JOIN chantiers c ON c.id = e.chantier_id
      WHERE e.org_id = ?${fsql} ORDER BY e.id DESC`).all(req.user.org_id, ...f.params);
    res.json(etudes.map((e) => {
      const c = calculerEtude(e, lignesEtude(e.id));
      return { ...e, nb_lignes: c.lignes.length, debourse_sec: c.debourse_sec, coefficient_k: c.coefficient_k, total_ht: c.total_ht, total_ttc: c.total_ttc };
    }));
  });

  const lireEtude = (req, b, ex = {}) => {
    const v = (k) => (b[k] !== undefined ? b[k] : ex[k]);
    const chantierId = v('chantier_id') ? chargerChantier(db, req.user, v('chantier_id')).id : null;
    return {
      chantier_id: chantierId,
      reference: texte(v('reference'), 'Référence', { requis: true, max: 40 }),
      objet: texte(v('objet'), 'Objet', { requis: true, max: 250 }),
      client: texte(v('client'), 'Client', { max: 160 }),
      frais_chantier_pct: nombre(v('frais_chantier_pct'), 'Frais de chantier %', { min: 0, max: 100, defaut: 0 }),
      frais_generaux_pct: nombre(v('frais_generaux_pct'), 'Frais généraux %', { min: 0, max: 100, defaut: 0 }),
      aleas_pct: nombre(v('aleas_pct'), 'Aléas %', { min: 0, max: 100, defaut: 0 }),
      benefice_pct: nombre(v('benefice_pct'), 'Bénéfice %', { min: 0, max: 100, defaut: 0 }),
      tva_pct: nombre(v('tva_pct'), 'TVA %', { min: 0, max: 100, defaut: db.prepare('SELECT tva_pct FROM organisations WHERE id = ?').get(req.user.org_id).tva_pct }),
    };
  };

  r.post('/etudes', ECRIRE, (req, res) => {
    const e = lireEtude(req, req.body);
    if (db.prepare('SELECT 1 FROM etudes WHERE org_id = ? AND reference = ?').get(req.user.org_id, e.reference)) throw new HttpError(409, `La référence ${e.reference} existe déjà.`);
    const ins = db.prepare(`INSERT INTO etudes (org_id, chantier_id, reference, objet, client, frais_chantier_pct, frais_generaux_pct,
      aleas_pct, benefice_pct, tva_pct, cree_par) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.user.org_id, e.chantier_id, e.reference, e.objet, e.client, e.frais_chantier_pct, e.frais_generaux_pct, e.aleas_pct, e.benefice_pct, e.tva_pct, req.user.id);
    audit(db, req.user, 'creation', 'etude', ins.lastInsertRowid, { reference: e.reference });
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  r.get('/etudes/:id', LIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    const noms = db.prepare('SELECT id, nom FROM users WHERE id IN (?, ?)').all(e.cree_par || 0, e.valide_par || 0);
    const nom = (id) => (noms.find((u) => u.id === id) || {}).nom || null;
    res.json({ ...e, cree_par_nom: nom(e.cree_par), valide_par_nom: nom(e.valide_par), calcul: calculerEtude(e, lignesEtude(e.id)) });
  });

  r.patch('/etudes/:id', ECRIRE, (req, res) => {
    const ex = chargerEtude(req, req.params.id);
    exigerBrouillon(ex);
    const e = lireEtude(req, req.body, ex);
    if (e.reference !== ex.reference && db.prepare('SELECT 1 FROM etudes WHERE org_id = ? AND reference = ? AND id <> ?').get(req.user.org_id, e.reference, ex.id)) throw new HttpError(409, `La référence ${e.reference} existe déjà.`);
    db.prepare(`UPDATE etudes SET chantier_id=?, reference=?, objet=?, client=?, frais_chantier_pct=?, frais_generaux_pct=?, aleas_pct=?,
      benefice_pct=?, tva_pct=? WHERE id=?`)
      .run(e.chantier_id, e.reference, e.objet, e.client, e.frais_chantier_pct, e.frais_generaux_pct, e.aleas_pct, e.benefice_pct, e.tva_pct, ex.id);
    audit(db, req.user, 'modification', 'etude', ex.id, e);
    res.json({ ok: true });
  });

  // DS unitaire décomposé d'un ouvrage de la bibliothèque, pour copie dans une ligne
  const dsDepuisOuvrage = (req, ouvrageId) => {
    const o = detailOuvrage(chargerOuvrage(req, ouvrageId));
    return { o, ds: { ds_main_oeuvre: o.ds.main_oeuvre, ds_materiau: o.ds.materiau, ds_materiel: o.ds.materiel, ds_sous_traitance: o.ds.sous_traitance } };
  };

  r.post('/etudes/:id/lignes', ECRIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    exigerBrouillon(e);
    const b = req.body;
    const quantite = nombre(b.quantite, 'Quantité', { requis: true, min: 0 });
    const ordre = (db.prepare('SELECT COALESCE(MAX(ordre), 0) AS m FROM etude_lignes WHERE etude_id = ?').get(e.id).m) + 1;
    let ligne;
    if (b.ouvrage_id) {
      const { o, ds } = dsDepuisOuvrage(req, b.ouvrage_id);
      ligne = { ouvrage_id: o.id, lot: o.lot, designation: o.designation, unite: o.unite, ...ds };
    } else {
      ligne = {
        ouvrage_id: null,
        lot: b.lot ? choix(b.lot, 'Lot', LOTS) : null,
        designation: texte(b.designation, 'Désignation', { requis: true, max: 250 }),
        unite: texte(b.unite, 'Unité', { requis: true, max: 15 }),
        ds_main_oeuvre: nombre(b.ds_main_oeuvre, 'DS main-d\'œuvre', { min: 0, defaut: 0 }),
        ds_materiau: nombre(b.ds_materiau, 'DS matériaux', { min: 0, defaut: 0 }),
        ds_materiel: nombre(b.ds_materiel, 'DS matériel', { min: 0, defaut: 0 }),
        ds_sous_traitance: nombre(b.ds_sous_traitance, 'DS sous-traitance', { min: 0, defaut: 0 }),
      };
    }
    const ins = db.prepare(`INSERT INTO etude_lignes (etude_id, ouvrage_id, ordre, lot, designation, unite, quantite,
      ds_main_oeuvre, ds_materiau, ds_materiel, ds_sous_traitance) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(e.id, ligne.ouvrage_id, ordre, ligne.lot, ligne.designation, ligne.unite, quantite,
        ligne.ds_main_oeuvre, ligne.ds_materiau, ligne.ds_materiel, ligne.ds_sous_traitance);
    res.status(201).json({ id: Number(ins.lastInsertRowid) });
  });

  const chargerLigne = (req) => {
    const e = chargerEtude(req, req.params.id);
    const l = db.prepare('SELECT * FROM etude_lignes WHERE id = ? AND etude_id = ?').get(Number(req.params.lid), e.id);
    if (!l) throw new HttpError(404, 'Ligne introuvable.');
    return { e, l };
  };

  r.patch('/etudes/:id/lignes/:lid', ECRIRE, (req, res) => {
    const { e, l } = chargerLigne(req);
    exigerBrouillon(e);
    const b = req.body;
    const n = (k, champ) => nombre(b[k], champ, { min: 0, defaut: l[k] });
    db.prepare(`UPDATE etude_lignes SET quantite=?, designation=?, unite=?, ds_main_oeuvre=?, ds_materiau=?, ds_materiel=?, ds_sous_traitance=? WHERE id=?`)
      .run(n('quantite', 'Quantité'), texte(b.designation ?? l.designation, 'Désignation', { requis: true, max: 250 }),
        texte(b.unite ?? l.unite, 'Unité', { requis: true, max: 15 }),
        n('ds_main_oeuvre', 'DS MO'), n('ds_materiau', 'DS matériaux'), n('ds_materiel', 'DS matériel'), n('ds_sous_traitance', 'DS sous-traitance'), l.id);
    res.json({ ok: true });
  });

  r.delete('/etudes/:id/lignes/:lid', ECRIRE, (req, res) => {
    const { e, l } = chargerLigne(req);
    exigerBrouillon(e);
    db.prepare('DELETE FROM etude_lignes WHERE id = ?').run(l.id);
    res.json({ ok: true });
  });

  // Recalcule les DS des lignes liées à un ouvrage à partir des prix actuels de la bibliothèque
  r.post('/etudes/:id/actualiser', ECRIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    exigerBrouillon(e);
    let n = 0;
    tx(db, () => {
      const upd = db.prepare('UPDATE etude_lignes SET ds_main_oeuvre=?, ds_materiau=?, ds_materiel=?, ds_sous_traitance=? WHERE id=?');
      for (const l of lignesEtude(e.id)) {
        if (!l.ouvrage_id) continue;
        const { ds } = dsDepuisOuvrage(req, l.ouvrage_id);
        upd.run(ds.ds_main_oeuvre, ds.ds_materiau, ds.ds_materiel, ds.ds_sous_traitance, l.id);
        n++;
      }
      audit(db, req.user, 'actualisation_prix', 'etude', e.id, { lignes: n });
    });
    res.json({ lignes_actualisees: n });
  });

  // Duplication (variante ou nouvelle version)
  r.post('/etudes/:id/dupliquer', ECRIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    const reference = texte(req.body.reference, 'Nouvelle référence', { requis: true, max: 40 });
    if (db.prepare('SELECT 1 FROM etudes WHERE org_id = ? AND reference = ?').get(req.user.org_id, reference)) throw new HttpError(409, `La référence ${reference} existe déjà.`);
    const id = tx(db, () => {
      const nid = Number(db.prepare(`INSERT INTO etudes (org_id, chantier_id, reference, objet, client, frais_chantier_pct, frais_generaux_pct,
        aleas_pct, benefice_pct, tva_pct, cree_par) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.org_id, e.chantier_id, reference, e.objet, e.client, e.frais_chantier_pct, e.frais_generaux_pct, e.aleas_pct, e.benefice_pct, e.tva_pct, req.user.id).lastInsertRowid);
      db.prepare(`INSERT INTO etude_lignes (etude_id, ouvrage_id, ordre, lot, designation, unite, quantite, ds_main_oeuvre, ds_materiau, ds_materiel, ds_sous_traitance)
        SELECT ?, ouvrage_id, ordre, lot, designation, unite, quantite, ds_main_oeuvre, ds_materiau, ds_materiel, ds_sous_traitance FROM etude_lignes WHERE etude_id = ?`).run(nid, e.id);
      audit(db, req.user, 'duplication', 'etude', nid, { source: e.reference });
      return nid;
    });
    res.status(201).json({ id });
  });

  // Changement de statut. Validation interne par une personne autre que le rédacteur (sauf admin).
  r.post('/etudes/:id/statut', LIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    const statut = choix(req.body.statut, 'Statut', ['brouillon', 'valide', 'accepte', 'refuse']);
    if (statut === 'brouillon') {
      if (!can(req.user, 'debourse.ecrire')) throw new HttpError(403, 'Accès refusé pour votre rôle.');
      if (e.statut !== 'brouillon' && !can(req.user, 'etude.valider')) throw new HttpError(403, 'Seule la direction peut rouvrir une étude validée.');
    } else {
      if (!can(req.user, 'etude.valider')) throw new HttpError(403, 'Seule la direction peut valider une étude.');
      if (statut === 'valide' && e.statut !== 'brouillon') throw new HttpError(409, 'Seule une étude en brouillon peut être validée.');
      if ((statut === 'accepte' || statut === 'refuse') && e.statut !== 'valide') throw new HttpError(409, 'L\'étude doit d\'abord être validée en interne.');
      if (statut === 'valide') {
        if (e.cree_par === req.user.id && req.user.role !== 'admin') throw new HttpError(403, 'Le rédacteur ne peut pas valider sa propre étude.');
        if (lignesEtude(e.id).length === 0) throw new HttpError(409, 'Impossible de valider une étude sans ligne.');
      }
    }
    db.prepare('UPDATE etudes SET statut = ?, valide_par = ? WHERE id = ?')
      .run(statut, statut === 'brouillon' ? null : (statut === 'valide' ? req.user.id : e.valide_par), e.id);
    audit(db, req.user, 'statut_' + statut, 'etude', e.id);
    res.json({ ok: true });
  });

  r.delete('/etudes/:id', ECRIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    exigerBrouillon(e);
    db.prepare('DELETE FROM etudes WHERE id = ?').run(e.id);
    audit(db, req.user, 'suppression', 'etude', e.id, { reference: e.reference });
    res.json({ ok: true });
  });

  r.get('/etudes/:id/export.csv', LIRE, (req, res) => {
    const e = chargerEtude(req, req.params.id);
    const c = calculerEtude(e, lignesEtude(e.id));
    const lignes = c.lignes.map((l, i) => ({ n: i + 1, ...l }));
    const total = (lib, v) => ({ designation: lib, montant_ht: v });
    lignes.push({}, total('Déboursé sec total', c.debourse_sec), total(`Frais de chantier (${e.frais_chantier_pct} %)`, c.frais_chantier),
      total(`Frais généraux (${e.frais_generaux_pct} %)`, c.frais_generaux), total(`Aléas (${e.aleas_pct} %)`, c.aleas),
      total(`Bénéfice (${e.benefice_pct} %)`, c.benefice), total(`Coefficient K`, c.coefficient_k),
      total('TOTAL HT', c.total_ht), total(`TVA (${e.tva_pct} %)`, c.tva), total('TOTAL TTC', c.total_ttc));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="etude_${e.reference.replace(/[^\w-]/g, '_')}.csv"`);
    res.send(csv(lignes, [
      { titre: 'N°', valeur: 'n' }, { titre: 'Lot', valeur: 'lot' }, { titre: 'Désignation', valeur: 'designation' },
      { titre: 'Unité', valeur: 'unite' }, { titre: 'Quantité', valeur: 'quantite' },
      { titre: 'DS MO unit.', valeur: 'ds_main_oeuvre' }, { titre: 'DS Matériaux unit.', valeur: 'ds_materiau' },
      { titre: 'DS Matériel unit.', valeur: 'ds_materiel' }, { titre: 'DS Sous-trait. unit.', valeur: 'ds_sous_traitance' },
      { titre: 'DS unitaire', valeur: 'ds_unitaire' }, { titre: 'DS total', valeur: 'ds_total' },
      { titre: 'PU vente HT', valeur: 'pu_vente' }, { titre: 'Montant HT (XOF)', valeur: 'montant_ht' },
    ]));
  });

  return r;
};
