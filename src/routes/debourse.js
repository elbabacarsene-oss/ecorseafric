'use strict';
const express = require('express');
const { requirePerm, can } = require('../auth');
const { HttpError, id, chargerChantier, filtreChantiers, audit, texte, nombre, choix, csv } = require('../util');
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
  r.get('/ressources', LIRE, async (req, res) => {
    let sql = `SELECT r.*, (SELECT COUNT(*) FROM ouvrage_composants WHERE ressource_id = r.id) AS utilisations
      FROM ressources r WHERE r.org_id = ?`;
    const params = [req.user.org_id];
    if (req.query.type) { sql += ' AND r.type = ?'; params.push(choix(req.query.type, 'Type', NATURES)); }
    if (req.query.q) { sql += ' AND (r.code ILIKE ? OR r.designation ILIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    res.json(await db.all(sql + ' ORDER BY r.type, r.code', ...params));
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
  const chargerRessource = async (req) => {
    const x = await db.get('SELECT * FROM ressources WHERE id = ? AND org_id = ?', id(req.params.id, 'Ressource'), req.user.org_id);
    if (!x) throw new HttpError(404, 'Ressource introuvable.');
    return x;
  };

  r.post('/ressources', ECRIRE, async (req, res) => {
    const x = lireRessource(req.body);
    if (await db.get('SELECT 1 FROM ressources WHERE org_id = ? AND code = ?', req.user.org_id, x.code)) throw new HttpError(409, `Le code ${x.code} existe déjà.`);
    const nid = await db.insert('INSERT INTO ressources (org_id, type, code, designation, unite, prix_unitaire) VALUES (?,?,?,?,?,?)',
      req.user.org_id, x.type, x.code, x.designation, x.unite, x.prix_unitaire);
    await audit(db, req.user, 'creation', 'ressource', nid, x);
    res.status(201).json({ id: nid });
  });

  r.patch('/ressources/:id', ECRIRE, async (req, res) => {
    const ex = await chargerRessource(req);
    const x = lireRessource(req.body, ex);
    if (x.code !== ex.code && await db.get('SELECT 1 FROM ressources WHERE org_id = ? AND code = ? AND id <> ?', req.user.org_id, x.code, ex.id)) throw new HttpError(409, `Le code ${x.code} existe déjà.`);
    await db.run(`UPDATE ressources SET type=?, code=?, designation=?, unite=?, prix_unitaire=?, updated_at=now() WHERE id=?`,
      x.type, x.code, x.designation, x.unite, x.prix_unitaire, ex.id);
    await audit(db, req.user, 'modification', 'ressource', ex.id, { prix_avant: ex.prix_unitaire, prix_apres: x.prix_unitaire });
    res.json({ ok: true });
  });

  r.delete('/ressources/:id', ECRIRE, async (req, res) => {
    const ex = await chargerRessource(req);
    if (await db.get('SELECT 1 FROM ouvrage_composants WHERE ressource_id = ?', ex.id)) throw new HttpError(409, 'Ressource utilisée dans un ouvrage : suppression impossible.');
    await db.run('DELETE FROM ressources WHERE id = ?', ex.id);
    await audit(db, req.user, 'suppression', 'ressource', ex.id, ex);
    res.json({ ok: true });
  });

  // ================= Ouvrages et sous-détails de prix =================
  const detailOuvrage = async (o, x = db) => {
    const composants = (await x.all(`SELECT oc.id, oc.ressource_id, oc.quantite, oc.pertes_pct,
        r.type, r.code, r.designation, r.unite, r.prix_unitaire
      FROM ouvrage_composants oc JOIN ressources r ON r.id = oc.ressource_id WHERE oc.ouvrage_id = ? ORDER BY r.type, oc.id`, o.id))
      .map((c) => ({ ...c, montant: round(c.quantite * (1 + c.pertes_pct / 100) * c.prix_unitaire, 2) }));
    const ds = deboursSecOuvrage(o.quantite_base, composants);
    return { ...o, composants, ds: Object.fromEntries(Object.entries(ds).map(([k, v]) => [k, round(v, 2)])) };
  };

  const chargerOuvrage = async (req, oid, x = db) => {
    const o = await x.get('SELECT * FROM ouvrages WHERE id = ? AND org_id = ?', id(oid, 'Ouvrage'), req.user.org_id);
    if (!o) throw new HttpError(404, 'Ouvrage introuvable.');
    return o;
  };

  r.get('/ouvrages', LIRE, async (req, res) => {
    let sql = 'SELECT * FROM ouvrages WHERE org_id = ?';
    const params = [req.user.org_id];
    if (req.query.lot) { sql += ' AND lot = ?'; params.push(String(req.query.lot)); }
    if (req.query.q) { sql += ' AND (code ILIKE ? OR designation ILIKE ?)'; params.push(`%${req.query.q}%`, `%${req.query.q}%`); }
    const out = [];
    for (const o of await db.all(sql + ' ORDER BY lot, code', ...params)) {
      const d = await detailOuvrage(o);
      out.push({ ...o, nb_composants: d.composants.length, ds: d.ds });
    }
    res.json(out);
  });

  r.get('/ouvrages/:id', LIRE, async (req, res) => res.json(await detailOuvrage(await chargerOuvrage(req, req.params.id))));

  const enregistrerOuvrage = async (req, ex) => {
    const b = req.body;
    const o = {
      code: texte(b.code, 'Code', { requis: true, max: 30 }),
      designation: texte(b.designation, 'Désignation', { requis: true, max: 250 }),
      lot: choix(b.lot, 'Lot', LOTS),
      unite: texte(b.unite, 'Unité', { requis: true, max: 15 }),
      quantite_base: nombre(b.quantite_base, 'Quantité de base', { min: 0.000001, defaut: 1 }),
    };
    if (!Array.isArray(b.composants)) throw new HttpError(400, 'Le sous-détail (composants) est obligatoire.');
    if (await db.get('SELECT 1 FROM ouvrages WHERE org_id = ? AND code = ? AND id <> ?', req.user.org_id, o.code, ex ? ex.id : 0)) throw new HttpError(409, `Le code ${o.code} existe déjà.`);
    return db.tx(async (t) => {
      let oid;
      if (ex) {
        await t.run(`UPDATE ouvrages SET code=?, designation=?, lot=?, unite=?, quantite_base=?, updated_at=now() WHERE id=?`,
          o.code, o.designation, o.lot, o.unite, o.quantite_base, ex.id);
        await t.run('DELETE FROM ouvrage_composants WHERE ouvrage_id = ?', ex.id);
        oid = ex.id;
      } else {
        oid = await t.insert('INSERT INTO ouvrages (org_id, code, designation, lot, unite, quantite_base) VALUES (?,?,?,?,?,?)',
          req.user.org_id, o.code, o.designation, o.lot, o.unite, o.quantite_base);
      }
      for (const c of b.composants) {
        const rid = id(c.ressource_id, 'Ressource');
        if (!await t.get('SELECT 1 FROM ressources WHERE id = ? AND org_id = ?', rid, req.user.org_id)) throw new HttpError(400, 'Ressource invalide dans le sous-détail.');
        await t.run('INSERT INTO ouvrage_composants (ouvrage_id, ressource_id, quantite, pertes_pct) VALUES (?,?,?,?)',
          oid, rid, nombre(c.quantite, 'Quantité', { requis: true, min: 0 }), nombre(c.pertes_pct, 'Pertes %', { min: 0, max: 100, defaut: 0 }));
      }
      await audit(t, req.user, ex ? 'modification' : 'creation', 'ouvrage', oid, { code: o.code });
      return oid;
    });
  };

  r.post('/ouvrages', ECRIRE, async (req, res) => res.status(201).json({ id: await enregistrerOuvrage(req, null) }));
  r.put('/ouvrages/:id', ECRIRE, async (req, res) => res.json({ id: await enregistrerOuvrage(req, await chargerOuvrage(req, req.params.id)) }));
  r.delete('/ouvrages/:id', ECRIRE, async (req, res) => {
    const o = await chargerOuvrage(req, req.params.id);
    await db.run('DELETE FROM ouvrages WHERE id = ?', o.id); // les lignes d'étude conservent leur copie du DS
    await audit(db, req.user, 'suppression', 'ouvrage', o.id, { code: o.code });
    res.json({ ok: true });
  });

  // ================= Études de prix =================
  // Accès à une étude : même organisation, et si elle est liée à un chantier, accès à ce chantier.
  const chargerEtude = async (req, eid) => {
    const e = await db.get('SELECT * FROM etudes WHERE id = ? AND org_id = ?', id(eid, 'Étude'), req.user.org_id);
    if (!e) throw new HttpError(404, 'Étude introuvable.');
    if (e.chantier_id) {
      try { await chargerChantier(db, req.user, e.chantier_id); } catch { throw new HttpError(404, 'Étude introuvable.'); }
    }
    return e;
  };
  const exigerBrouillon = (e) => { if (e.statut !== 'brouillon') throw new HttpError(409, 'Étude validée : repassez-la en brouillon ou dupliquez-la pour la modifier.'); };
  const lignesEtude = (eid) => db.all('SELECT * FROM etude_lignes WHERE etude_id = ? ORDER BY ordre, id', eid);

  r.get('/etudes', LIRE, async (req, res) => {
    const f = await filtreChantiers(db, req.user, 'e.chantier_id');
    // Les rôles restreints voient aussi les études non rattachées à un chantier
    const fsql = f.sql ? ` AND (e.chantier_id IS NULL OR (TRUE ${f.sql}))` : '';
    const etudes = await db.all(`SELECT e.*, c.code AS chantier_code FROM etudes e LEFT JOIN chantiers c ON c.id = e.chantier_id
      WHERE e.org_id = ?${fsql} ORDER BY e.id DESC`, req.user.org_id, ...f.params);
    const lignes = etudes.length ? await db.all('SELECT * FROM etude_lignes WHERE etude_id = ANY(?::int[]) ORDER BY ordre, id', etudes.map((e) => e.id)) : [];
    res.json(etudes.map((e) => {
      const c = calculerEtude(e, lignes.filter((l) => l.etude_id === e.id));
      return { ...e, nb_lignes: c.lignes.length, debourse_sec: c.debourse_sec, coefficient_k: c.coefficient_k, total_ht: c.total_ht, total_ttc: c.total_ttc };
    }));
  });

  const lireEtude = async (req, b, ex = {}) => {
    const v = (k) => (b[k] !== undefined ? b[k] : ex[k]);
    const chantierId = v('chantier_id') ? (await chargerChantier(db, req.user, v('chantier_id'))).id : null;
    const tvaDefaut = (await db.get('SELECT tva_pct FROM organisations WHERE id = ?', req.user.org_id)).tva_pct;
    return {
      chantier_id: chantierId,
      reference: texte(v('reference'), 'Référence', { requis: true, max: 40 }),
      objet: texte(v('objet'), 'Objet', { requis: true, max: 250 }),
      client: texte(v('client'), 'Client', { max: 160 }),
      frais_chantier_pct: nombre(v('frais_chantier_pct'), 'Frais de chantier %', { min: 0, max: 100, defaut: 0 }),
      frais_generaux_pct: nombre(v('frais_generaux_pct'), 'Frais généraux %', { min: 0, max: 100, defaut: 0 }),
      aleas_pct: nombre(v('aleas_pct'), 'Aléas %', { min: 0, max: 100, defaut: 0 }),
      benefice_pct: nombre(v('benefice_pct'), 'Bénéfice %', { min: 0, max: 100, defaut: 0 }),
      tva_pct: nombre(v('tva_pct'), 'TVA %', { min: 0, max: 100, defaut: tvaDefaut }),
    };
  };

  r.post('/etudes', ECRIRE, async (req, res) => {
    const e = await lireEtude(req, req.body);
    if (await db.get('SELECT 1 FROM etudes WHERE org_id = ? AND reference = ?', req.user.org_id, e.reference)) throw new HttpError(409, `La référence ${e.reference} existe déjà.`);
    const nid = await db.insert(`INSERT INTO etudes (org_id, chantier_id, reference, objet, client, frais_chantier_pct, frais_generaux_pct,
      aleas_pct, benefice_pct, tva_pct, cree_par) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      req.user.org_id, e.chantier_id, e.reference, e.objet, e.client, e.frais_chantier_pct, e.frais_generaux_pct, e.aleas_pct, e.benefice_pct, e.tva_pct, req.user.id);
    await audit(db, req.user, 'creation', 'etude', nid, { reference: e.reference });
    res.status(201).json({ id: nid });
  });

  r.get('/etudes/:id', LIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
    const noms = await db.all('SELECT id, nom FROM users WHERE id IN (?, ?)', e.cree_par || 0, e.valide_par || 0);
    const nom = (uid) => (noms.find((u) => u.id === uid) || {}).nom || null;
    res.json({ ...e, cree_par_nom: nom(e.cree_par), valide_par_nom: nom(e.valide_par), calcul: calculerEtude(e, await lignesEtude(e.id)) });
  });

  r.patch('/etudes/:id', ECRIRE, async (req, res) => {
    const ex = await chargerEtude(req, req.params.id);
    exigerBrouillon(ex);
    const e = await lireEtude(req, req.body, ex);
    if (e.reference !== ex.reference && await db.get('SELECT 1 FROM etudes WHERE org_id = ? AND reference = ? AND id <> ?', req.user.org_id, e.reference, ex.id)) throw new HttpError(409, `La référence ${e.reference} existe déjà.`);
    await db.run(`UPDATE etudes SET chantier_id=?, reference=?, objet=?, client=?, frais_chantier_pct=?, frais_generaux_pct=?, aleas_pct=?,
      benefice_pct=?, tva_pct=? WHERE id=?`,
      e.chantier_id, e.reference, e.objet, e.client, e.frais_chantier_pct, e.frais_generaux_pct, e.aleas_pct, e.benefice_pct, e.tva_pct, ex.id);
    await audit(db, req.user, 'modification', 'etude', ex.id, e);
    res.json({ ok: true });
  });

  // DS unitaire décomposé d'un ouvrage de la bibliothèque, pour copie dans une ligne
  const dsDepuisOuvrage = async (req, ouvrageId, x = db) => {
    const o = await detailOuvrage(await chargerOuvrage(req, ouvrageId, x), x);
    return { o, ds: { ds_main_oeuvre: o.ds.main_oeuvre, ds_materiau: o.ds.materiau, ds_materiel: o.ds.materiel, ds_sous_traitance: o.ds.sous_traitance } };
  };

  r.post('/etudes/:id/lignes', ECRIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
    exigerBrouillon(e);
    const b = req.body;
    const quantite = nombre(b.quantite, 'Quantité', { requis: true, min: 0 });
    let ligne;
    if (b.ouvrage_id) {
      const { o, ds } = await dsDepuisOuvrage(req, b.ouvrage_id);
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
    const nid = await db.insert(`INSERT INTO etude_lignes (etude_id, ouvrage_id, ordre, lot, designation, unite, quantite,
      ds_main_oeuvre, ds_materiau, ds_materiel, ds_sous_traitance)
      VALUES (?,?,(SELECT COALESCE(MAX(ordre), 0) + 1 FROM etude_lignes WHERE etude_id = ?),?,?,?,?,?,?,?,?)`,
      e.id, ligne.ouvrage_id, e.id, ligne.lot, ligne.designation, ligne.unite, quantite,
      ligne.ds_main_oeuvre, ligne.ds_materiau, ligne.ds_materiel, ligne.ds_sous_traitance);
    res.status(201).json({ id: nid });
  });

  const chargerLigne = async (req) => {
    const e = await chargerEtude(req, req.params.id);
    const l = await db.get('SELECT * FROM etude_lignes WHERE id = ? AND etude_id = ?', id(req.params.lid, 'Ligne'), e.id);
    if (!l) throw new HttpError(404, 'Ligne introuvable.');
    return { e, l };
  };

  r.patch('/etudes/:id/lignes/:lid', ECRIRE, async (req, res) => {
    const { e, l } = await chargerLigne(req);
    exigerBrouillon(e);
    const b = req.body;
    const n = (k, champ) => nombre(b[k], champ, { min: 0, defaut: l[k] });
    await db.run(`UPDATE etude_lignes SET quantite=?, designation=?, unite=?, ds_main_oeuvre=?, ds_materiau=?, ds_materiel=?, ds_sous_traitance=? WHERE id=?`,
      n('quantite', 'Quantité'), texte(b.designation ?? l.designation, 'Désignation', { requis: true, max: 250 }),
      texte(b.unite ?? l.unite, 'Unité', { requis: true, max: 15 }),
      n('ds_main_oeuvre', 'DS MO'), n('ds_materiau', 'DS matériaux'), n('ds_materiel', 'DS matériel'), n('ds_sous_traitance', 'DS sous-traitance'), l.id);
    res.json({ ok: true });
  });

  r.delete('/etudes/:id/lignes/:lid', ECRIRE, async (req, res) => {
    const { e, l } = await chargerLigne(req);
    exigerBrouillon(e);
    await db.run('DELETE FROM etude_lignes WHERE id = ?', l.id);
    res.json({ ok: true });
  });

  // Recalcule les DS des lignes liées à un ouvrage à partir des prix actuels de la bibliothèque
  r.post('/etudes/:id/actualiser', ECRIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
    exigerBrouillon(e);
    const n = await db.tx(async (t) => {
      let k = 0;
      for (const l of await t.all('SELECT * FROM etude_lignes WHERE etude_id = ? AND ouvrage_id IS NOT NULL', e.id)) {
        const { ds } = await dsDepuisOuvrage(req, l.ouvrage_id, t);
        await t.run('UPDATE etude_lignes SET ds_main_oeuvre=?, ds_materiau=?, ds_materiel=?, ds_sous_traitance=? WHERE id=?',
          ds.ds_main_oeuvre, ds.ds_materiau, ds.ds_materiel, ds.ds_sous_traitance, l.id);
        k++;
      }
      await audit(t, req.user, 'actualisation_prix', 'etude', e.id, { lignes: k });
      return k;
    });
    res.json({ lignes_actualisees: n });
  });

  // Duplication (variante ou nouvelle version)
  r.post('/etudes/:id/dupliquer', ECRIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
    const reference = texte(req.body.reference, 'Nouvelle référence', { requis: true, max: 40 });
    if (await db.get('SELECT 1 FROM etudes WHERE org_id = ? AND reference = ?', req.user.org_id, reference)) throw new HttpError(409, `La référence ${reference} existe déjà.`);
    const nid = await db.tx(async (t) => {
      const k = await t.insert(`INSERT INTO etudes (org_id, chantier_id, reference, objet, client, frais_chantier_pct, frais_generaux_pct,
        aleas_pct, benefice_pct, tva_pct, cree_par) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        req.user.org_id, e.chantier_id, reference, e.objet, e.client, e.frais_chantier_pct, e.frais_generaux_pct, e.aleas_pct, e.benefice_pct, e.tva_pct, req.user.id);
      await t.run(`INSERT INTO etude_lignes (etude_id, ouvrage_id, ordre, lot, designation, unite, quantite, ds_main_oeuvre, ds_materiau, ds_materiel, ds_sous_traitance)
        SELECT ?, ouvrage_id, ordre, lot, designation, unite, quantite, ds_main_oeuvre, ds_materiau, ds_materiel, ds_sous_traitance FROM etude_lignes WHERE etude_id = ?`, k, e.id);
      await audit(t, req.user, 'duplication', 'etude', k, { source: e.reference });
      return k;
    });
    res.status(201).json({ id: nid });
  });

  // Changement de statut. Validation interne par une personne autre que le rédacteur (sauf admin).
  r.post('/etudes/:id/statut', LIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
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
        if (!(await lignesEtude(e.id)).length) throw new HttpError(409, 'Impossible de valider une étude sans ligne.');
      }
    }
    await db.run('UPDATE etudes SET statut = ?, valide_par = ? WHERE id = ?',
      statut, statut === 'brouillon' ? null : (statut === 'valide' ? req.user.id : e.valide_par), e.id);
    await audit(db, req.user, 'statut_' + statut, 'etude', e.id);
    res.json({ ok: true });
  });

  r.delete('/etudes/:id', ECRIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
    exigerBrouillon(e);
    await db.run('DELETE FROM etudes WHERE id = ?', e.id);
    await audit(db, req.user, 'suppression', 'etude', e.id, { reference: e.reference });
    res.json({ ok: true });
  });

  r.get('/etudes/:id/export.csv', LIRE, async (req, res) => {
    const e = await chargerEtude(req, req.params.id);
    const c = calculerEtude(e, await lignesEtude(e.id));
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
