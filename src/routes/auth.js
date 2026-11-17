'use strict';
const express = require('express');
const A = require('../auth');
const { HttpError, texte, nombre, choix, audit, tx } = { ...require('../util'), ...require('../db') };

const ROLES = ['admin', 'direction', 'conducteur', 'chef_chantier', 'metreur', 'comptable'];

module.exports = function authRoutes(db, { secureCookies, inscriptionOuverte }) {
  const r = express.Router();

  // Création d'un espace entreprise + premier administrateur
  r.post('/auth/inscription', (req, res) => {
    if (!inscriptionOuverte) throw new HttpError(403, 'Les inscriptions sont fermées sur cette instance.');
    const entreprise = texte(req.body.entreprise, 'Entreprise', { requis: true, max: 120 });
    const nom = texte(req.body.nom, 'Nom', { requis: true, max: 120 });
    const email = texte(req.body.email, 'Email', { requis: true, max: 160 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse email invalide.');
    const err = A.validerMotDePasse(req.body.mot_de_passe);
    if (err) throw new HttpError(400, err);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Un compte existe déjà avec cet email.');

    const userId = tx(db, () => {
      const org = db.prepare('INSERT INTO organisations (nom) VALUES (?)').run(entreprise);
      const u = db.prepare('INSERT INTO users (org_id, email, nom, password_hash, role) VALUES (?,?,?,?,?)')
        .run(org.lastInsertRowid, email, nom, A.hashPassword(req.body.mot_de_passe), 'admin');
      audit(db, { org_id: org.lastInsertRowid, id: u.lastInsertRowid }, 'inscription', 'organisation', org.lastInsertRowid);
      return u.lastInsertRowid;
    });
    const token = A.creerSession(db, userId);
    res.setHeader('Set-Cookie', A.cookieSession(token, secureCookies));
    res.status(201).json({ ok: true });
  });

  r.post('/auth/connexion', (req, res) => {
    const email = String(req.body.email || '').trim();
    const cle = `${req.ip}|${email.toLowerCase()}`;
    if (A.limiterConnexion(cle)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !u.actif || !A.verifyPassword(String(req.body.mot_de_passe || ''), u.password_hash)) {
      throw new HttpError(401, 'Email ou mot de passe incorrect.');
    }
    A.reinitialiserTentatives(cle);
    const token = A.creerSession(db, u.id);
    audit(db, u, 'connexion', 'utilisateur', u.id);
    res.setHeader('Set-Cookie', A.cookieSession(token, secureCookies));
    res.json({ ok: true });
  });

  r.post('/auth/deconnexion', (req, res) => {
    A.supprimerSession(db, req.sessionToken);
    res.setHeader('Set-Cookie', A.cookieEfface(secureCookies));
    res.json({ ok: true });
  });

  r.get('/auth/moi', A.requireAuth, (req, res) => {
    const org = db.prepare('SELECT * FROM organisations WHERE id = ?').get(req.user.org_id);
    const permissions = Object.keys(A.PERMISSIONS).filter((p) => A.can(req.user, p));
    res.json({ utilisateur: { id: req.user.id, nom: req.user.nom, email: req.user.email, role: req.user.role }, organisation: org, permissions });
  });

  r.post('/auth/mot-de-passe', A.requireAuth, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!A.verifyPassword(String(req.body.actuel || ''), u.password_hash)) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    const err = A.validerMotDePasse(req.body.nouveau);
    if (err) throw new HttpError(400, err);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(A.hashPassword(req.body.nouveau), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    const token = A.creerSession(db, u.id);
    audit(db, req.user, 'changement_mot_de_passe', 'utilisateur', u.id);
    res.setHeader('Set-Cookie', A.cookieSession(token, secureCookies));
    res.json({ ok: true });
  });

  // ---------- Administration : utilisateurs ----------
  const listeUsers = (orgId) => db.prepare(`
    SELECT u.id, u.email, u.nom, u.role, u.actif, u.created_at,
      (SELECT json_group_array(chantier_id) FROM user_chantiers WHERE user_id = u.id) AS chantiers
    FROM users u WHERE u.org_id = ? ORDER BY u.nom`).all(orgId)
    .map((u) => ({ ...u, chantiers: JSON.parse(u.chantiers) }));

  r.get('/utilisateurs', A.requirePerm('admin.utilisateurs'), (req, res) => res.json(listeUsers(req.user.org_id)));

  r.post('/utilisateurs', A.requirePerm('admin.utilisateurs'), (req, res) => {
    const nom = texte(req.body.nom, 'Nom', { requis: true, max: 120 });
    const email = texte(req.body.email, 'Email', { requis: true, max: 160 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse email invalide.');
    const role = choix(req.body.role, 'Rôle', ROLES);
    const err = A.validerMotDePasse(req.body.mot_de_passe);
    if (err) throw new HttpError(400, err);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Un compte existe déjà avec cet email.');
    const u = db.prepare('INSERT INTO users (org_id, email, nom, password_hash, role) VALUES (?,?,?,?,?)')
      .run(req.user.org_id, email, nom, A.hashPassword(req.body.mot_de_passe), role);
    audit(db, req.user, 'creation', 'utilisateur', u.lastInsertRowid, { email, role });
    res.status(201).json({ id: Number(u.lastInsertRowid) });
  });

  r.patch('/utilisateurs/:id', A.requirePerm('admin.utilisateurs'), (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(Number(req.params.id), req.user.org_id);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const role = req.body.role !== undefined ? choix(req.body.role, 'Rôle', ROLES) : u.role;
    const actif = req.body.actif !== undefined ? (req.body.actif ? 1 : 0) : u.actif;
    const nom = req.body.nom !== undefined ? texte(req.body.nom, 'Nom', { requis: true, max: 120 }) : u.nom;
    if (u.id === req.user.id && (role !== 'admin' || !actif)) {
      throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres droits administrateur.');
    }
    tx(db, () => {
      db.prepare('UPDATE users SET role = ?, actif = ?, nom = ? WHERE id = ?').run(role, actif, nom, u.id);
      if (!actif) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      if (req.body.mot_de_passe) {
        const err = A.validerMotDePasse(req.body.mot_de_passe);
        if (err) throw new HttpError(400, err);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(A.hashPassword(req.body.mot_de_passe), u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      }
      if (Array.isArray(req.body.chantiers)) {
        const ids = req.body.chantiers.map(Number);
        const valides = db.prepare(`SELECT id FROM chantiers WHERE org_id = ? AND id IN (${ids.map(() => '?').join(',') || 'NULL'})`)
          .all(req.user.org_id, ...ids).map((c) => c.id);
        if (valides.length !== new Set(ids).size) throw new HttpError(400, 'Chantier invalide.');
        db.prepare('DELETE FROM user_chantiers WHERE user_id = ?').run(u.id);
        const ins = db.prepare('INSERT INTO user_chantiers (user_id, chantier_id) VALUES (?, ?)');
        for (const id of valides) ins.run(u.id, id);
      }
      audit(db, req.user, 'modification', 'utilisateur', u.id, { role, actif, chantiers: req.body.chantiers });
    });
    res.json({ ok: true });
  });

  // ---------- Paramètres de l'entreprise ----------
  r.patch('/organisation', A.requirePerm('admin.parametres'), (req, res) => {
    const o = db.prepare('SELECT * FROM organisations WHERE id = ?').get(req.user.org_id);
    const v = {
      nom: req.body.nom !== undefined ? texte(req.body.nom, 'Nom', { requis: true, max: 120 }) : o.nom,
      majoration_hs_pct: nombre(req.body.majoration_hs_pct, 'Majoration HS', { min: 0, max: 200, defaut: o.majoration_hs_pct }),
      heures_jour_standard: nombre(req.body.heures_jour_standard, 'Heures/jour', { min: 1, max: 24, defaut: o.heures_jour_standard }),
      tva_pct: nombre(req.body.tva_pct, 'TVA', { min: 0, max: 100, defaut: o.tva_pct }),
    };
    db.prepare('UPDATE organisations SET nom=?, majoration_hs_pct=?, heures_jour_standard=?, tva_pct=? WHERE id=?')
      .run(v.nom, v.majoration_hs_pct, v.heures_jour_standard, v.tva_pct, o.id);
    audit(db, req.user, 'modification', 'organisation', o.id, v);
    res.json({ ok: true });
  });

  r.get('/journal', A.requirePerm('admin.journal'), (req, res) => {
    res.json(db.prepare(`
      SELECT a.*, u.nom AS utilisateur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.org_id = ? ORDER BY a.id DESC LIMIT 300`).all(req.user.org_id));
  });

  return r;
};
