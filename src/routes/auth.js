'use strict';
const express = require('express');
const A = require('../auth');
const { HttpError, id, texte, nombre, choix, audit } = require('../util');
const { gabarit } = require('../email');

const ROLES = ['admin', 'direction', 'conducteur', 'chef_chantier', 'metreur', 'comptable'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

module.exports = function authRoutes(db, cfg, emetteur) {
  const r = express.Router();

  const lireEmail = (v) => {
    const email = texte(v, 'Email', { requis: true, max: 160 }).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Adresse email invalide.');
    return email;
  };

  async function envoyerConfirmation(user) {
    const jeton = await A.creerJeton(db, user.id, 'verification');
    const lien = `${cfg.appUrl}/confirmer?jeton=${jeton}`;
    await emetteur.envoyer({
      a: user.email, nom: user.nom, sujet: `Confirmez votre adresse e-mail — ${cfg.nomProduit}`,
      ...gabarit({ produit: cfg.nomProduit, titre: 'Confirmez votre adresse e-mail', bouton: 'Confirmer mon adresse', lien,
        intro: `Bonjour ${user.nom}, cliquez sur le bouton ci-dessous pour activer votre espace. Votre essai gratuit de ${cfg.essaiHeures} h commencera à ce moment-là.`,
        note: 'Ce lien est valable 48 heures. Si vous n\'êtes pas à l\'origine de cette inscription, ignorez ce message.' }),
    });
  }

  // ---------- Inscription : nouvel espace entreprise + premier administrateur ----------
  r.post('/auth/inscription', async (req, res) => {
    if (!cfg.inscriptionOuverte) throw new HttpError(403, 'Les inscriptions sont fermées sur cette instance.');
    if (await A.limiterConnexion(db, `inscription|${req.ip}`, 5, 60 * 60 * 1000)) throw new HttpError(429, 'Trop de créations d\'espace depuis cette adresse. Réessayez dans une heure.');
    const entreprise = texte(req.body.entreprise, 'Entreprise', { requis: true, max: 120 });
    const nom = texte(req.body.nom, 'Nom', { requis: true, max: 120 });
    const email = lireEmail(req.body.email);
    const err = A.validerMotDePasse(req.body.mot_de_passe);
    if (err) throw new HttpError(400, err);
    if (await db.get('SELECT 1 FROM users WHERE lower(email) = ?', email)) throw new HttpError(409, 'Un compte existe déjà avec cet email.');

    const user = await db.tx(async (t) => {
      const orgId = await t.insert('INSERT INTO organisations (nom) VALUES (?)', entreprise);
      const userId = await t.insert('INSERT INTO users (org_id, email, nom, password_hash, role) VALUES (?,?,?,?,?)',
        orgId, email, nom, A.hashPassword(req.body.mot_de_passe), 'admin');
      await audit(t, { org_id: orgId, id: userId }, 'inscription', 'organisation', orgId);
      return { id: userId, email, nom };
    });
    try { await envoyerConfirmation(user); } catch (e) { console.error(e.message); }
    const token = await A.creerSession(db, user.id);
    res.setHeader('Set-Cookie', A.cookieSession(token, cfg.secureCookies));
    res.status(201).json({ ok: true });
  });

  r.post('/auth/renvoyer-confirmation', A.requireAuth, async (req, res) => {
    if (req.user.email_verifie) return res.json({ ok: true, deja_verifie: true });
    if (await A.limiterConnexion(db, `renvoi|${req.user.id}`, 3, 60 * 60 * 1000)) throw new HttpError(429, 'Trop de demandes. Réessayez dans une heure.');
    await envoyerConfirmation(req.user);
    res.json({ ok: true });
  });

  // Confirmation : accessible sans être connecté (lien ouvert sur un autre appareil)
  r.post('/auth/confirmer-email', async (req, res) => {
    const userId = await A.consommerJeton(db, req.body.jeton, 'verification');
    if (!userId) throw new HttpError(400, 'Lien invalide ou expiré. Demandez un nouvel e-mail de confirmation.');
    await db.tx(async (t) => {
      const u = await t.get('UPDATE users SET email_verifie = TRUE WHERE id = ? RETURNING id, org_id, role', userId);
      // L'essai démarre à la confirmation de l'administrateur fondateur
      if (u.role === 'admin') {
        await t.run(`UPDATE organisations SET essai_fin = now() + make_interval(secs => ?) WHERE id = ? AND essai_fin IS NULL`, cfg.essaiHeures * 3600, u.org_id);
      }
      await audit(t, { org_id: u.org_id, id: u.id }, 'confirmation_email', 'utilisateur', u.id);
    });
    res.json({ ok: true });
  });

  // ---------- Connexion ----------
  r.post('/auth/connexion', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const cle = `${req.ip}|${email}`;
    if (await A.limiterConnexion(db, cle)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
    const u = await db.get('SELECT * FROM users WHERE lower(email) = ?', email);
    if (!u || !u.actif || !A.verifyPassword(String(req.body.mot_de_passe || ''), u.password_hash)) {
      throw new HttpError(401, 'Email ou mot de passe incorrect.');
    }
    await A.reinitialiserTentatives(db, cle);
    const token = await A.creerSession(db, u.id);
    await audit(db, u, 'connexion', 'utilisateur', u.id);
    res.setHeader('Set-Cookie', A.cookieSession(token, cfg.secureCookies));
    res.json({ ok: true });
  });

  r.post('/auth/deconnexion', async (req, res) => {
    await A.supprimerSession(db, req.sessionToken);
    res.setHeader('Set-Cookie', A.cookieEfface(cfg.secureCookies));
    res.json({ ok: true });
  });

  // ---------- Mot de passe oublié ----------
  // Réponse identique que le compte existe ou non (on ne révèle pas quelles adresses sont inscrites)
  r.post('/auth/mot-de-passe-oublie', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (await A.limiterConnexion(db, `oubli|${req.ip}`, 10, 60 * 60 * 1000) || await A.limiterConnexion(db, `oubli|${email}`, 3, 60 * 60 * 1000)) {
      throw new HttpError(429, 'Trop de demandes. Réessayez dans une heure.');
    }
    const u = EMAIL_RE.test(email) ? await db.get('SELECT * FROM users WHERE lower(email) = ? AND actif = 1', email) : null;
    if (u) {
      const jeton = await A.creerJeton(db, u.id, 'reinitialisation');
      const lien = `${cfg.appUrl}/reinitialiser?jeton=${jeton}`;
      try {
        await emetteur.envoyer({
          a: u.email, nom: u.nom, sujet: `Réinitialisation de votre mot de passe — ${cfg.nomProduit}`,
          ...gabarit({ produit: cfg.nomProduit, titre: 'Réinitialiser votre mot de passe', bouton: 'Choisir un nouveau mot de passe', lien,
            intro: `Bonjour ${u.nom}, une demande de réinitialisation du mot de passe a été faite pour votre compte.`,
            note: 'Ce lien est valable 1 heure et ne peut servir qu\'une fois. Si vous n\'avez rien demandé, ignorez ce message : votre mot de passe reste inchangé.' }),
        });
      } catch (e) { console.error(e.message); }
      await audit(db, u, 'demande_reinitialisation', 'utilisateur', u.id);
    }
    res.json({ ok: true });
  });

  r.post('/auth/reinitialiser', async (req, res) => {
    const err = A.validerMotDePasse(req.body.mot_de_passe);
    if (err) throw new HttpError(400, err);
    const userId = await A.consommerJeton(db, req.body.jeton, 'reinitialisation');
    if (!userId) throw new HttpError(400, 'Lien invalide ou expiré. Refaites une demande.');
    await db.tx(async (t) => {
      // Ouvrir le lien reçu par e-mail prouve aussi la possession de l'adresse
      const u = await t.get('UPDATE users SET password_hash = ?, email_verifie = TRUE WHERE id = ? RETURNING id, org_id, role',
        A.hashPassword(req.body.mot_de_passe), userId);
      if (u.role === 'admin') {
        await t.run('UPDATE organisations SET essai_fin = now() + make_interval(secs => ?) WHERE id = ? AND essai_fin IS NULL', cfg.essaiHeures * 3600, u.org_id);
      }
      await t.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      await audit(t, u, 'reinitialisation_mot_de_passe', 'utilisateur', u.id);
    });
    res.json({ ok: true });
  });

  r.get('/auth/moi', A.requireAuth, async (req, res) => {
    const org = await db.get(`SELECT id, nom, devise, fuseau, majoration_hs_pct, heures_jour_standard, tva_pct, created_at,
      logo_version, logo IS NOT NULL AS a_logo, essai_fin, abonnement_fin FROM organisations WHERE id = ?`, req.user.org_id);
    const permissions = Object.keys(A.PERMISSIONS).filter((p) => A.can(req.user, p));
    res.json({
      utilisateur: { id: req.user.id, nom: req.user.nom, email: req.user.email, role: req.user.role, email_verifie: req.user.email_verifie },
      organisation: org, acces: A.etatAcces(org), permissions,
    });
  });

  r.post('/auth/mot-de-passe', A.requireAuth, async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!A.verifyPassword(String(req.body.actuel || ''), u.password_hash)) throw new HttpError(400, 'Mot de passe actuel incorrect.');
    const err = A.validerMotDePasse(req.body.nouveau);
    if (err) throw new HttpError(400, err);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', A.hashPassword(req.body.nouveau), u.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
    const token = await A.creerSession(db, u.id);
    await audit(db, req.user, 'changement_mot_de_passe', 'utilisateur', u.id);
    res.setHeader('Set-Cookie', A.cookieSession(token, cfg.secureCookies));
    res.json({ ok: true });
  });

  // ---------- Administration : utilisateurs ----------
  r.get('/utilisateurs', A.requirePerm('admin.utilisateurs'), async (req, res) => {
    res.json(await db.all(`
      SELECT u.id, u.email, u.nom, u.role, u.actif, u.email_verifie, u.created_at,
        COALESCE((SELECT json_agg(chantier_id) FROM user_chantiers WHERE user_id = u.id), '[]'::json) AS chantiers
      FROM users u WHERE u.org_id = ? ORDER BY u.nom`, req.user.org_id));
  });

  // Un compte créé par l'administrateur est considéré comme vérifié : l'administrateur se porte garant de l'adresse
  r.post('/utilisateurs', A.requirePerm('admin.utilisateurs'), async (req, res) => {
    const nom = texte(req.body.nom, 'Nom', { requis: true, max: 120 });
    const email = lireEmail(req.body.email);
    const role = choix(req.body.role, 'Rôle', ROLES);
    const err = A.validerMotDePasse(req.body.mot_de_passe);
    if (err) throw new HttpError(400, err);
    if (await db.get('SELECT 1 FROM users WHERE lower(email) = ?', email)) throw new HttpError(409, 'Un compte existe déjà avec cet email.');
    const nid = await db.insert('INSERT INTO users (org_id, email, nom, password_hash, role, email_verifie) VALUES (?,?,?,?,?,TRUE)',
      req.user.org_id, email, nom, A.hashPassword(req.body.mot_de_passe), role);
    await audit(db, req.user, 'creation', 'utilisateur', nid, { email, role });
    res.status(201).json({ id: nid });
  });

  r.patch('/utilisateurs/:id', A.requirePerm('admin.utilisateurs'), async (req, res) => {
    const u = await db.get('SELECT * FROM users WHERE id = ? AND org_id = ?', id(req.params.id, 'Utilisateur'), req.user.org_id);
    if (!u) throw new HttpError(404, 'Utilisateur introuvable.');
    const role = req.body.role !== undefined ? choix(req.body.role, 'Rôle', ROLES) : u.role;
    const actif = req.body.actif !== undefined ? (req.body.actif ? 1 : 0) : u.actif;
    const nom = req.body.nom !== undefined ? texte(req.body.nom, 'Nom', { requis: true, max: 120 }) : u.nom;
    if (u.id === req.user.id && (role !== 'admin' || !actif)) {
      throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres droits administrateur.');
    }
    await db.tx(async (t) => {
      await t.run('UPDATE users SET role = ?, actif = ?, nom = ? WHERE id = ?', role, actif, nom, u.id);
      if (!actif) await t.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      if (req.body.mot_de_passe) {
        const err = A.validerMotDePasse(req.body.mot_de_passe);
        if (err) throw new HttpError(400, err);
        await t.run('UPDATE users SET password_hash = ? WHERE id = ?', A.hashPassword(req.body.mot_de_passe), u.id);
        await t.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      }
      if (Array.isArray(req.body.chantiers)) {
        const ids = [...new Set(req.body.chantiers.map((x) => id(x, 'Chantier')))];
        const valides = ids.length ? (await t.all(`SELECT id FROM chantiers WHERE org_id = ? AND id = ANY(?::int[])`, req.user.org_id, ids)).map((c) => c.id) : [];
        if (valides.length !== ids.length) throw new HttpError(400, 'Chantier invalide.');
        await t.run('DELETE FROM user_chantiers WHERE user_id = ?', u.id);
        for (const cid of valides) await t.run('INSERT INTO user_chantiers (user_id, chantier_id) VALUES (?, ?)', u.id, cid);
      }
      await audit(t, req.user, 'modification', 'utilisateur', u.id, { role, actif, chantiers: req.body.chantiers });
    });
    res.json({ ok: true });
  });

  // ---------- Paramètres de l'entreprise ----------
  r.patch('/organisation', A.requirePerm('admin.parametres'), async (req, res) => {
    const o = await db.get('SELECT * FROM organisations WHERE id = ?', req.user.org_id);
    const v = {
      nom: req.body.nom !== undefined ? texte(req.body.nom, 'Nom', { requis: true, max: 120 }) : o.nom,
      majoration_hs_pct: nombre(req.body.majoration_hs_pct, 'Majoration HS', { min: 0, max: 200, defaut: o.majoration_hs_pct }),
      heures_jour_standard: nombre(req.body.heures_jour_standard, 'Heures/jour', { min: 1, max: 24, defaut: o.heures_jour_standard }),
      tva_pct: nombre(req.body.tva_pct, 'TVA', { min: 0, max: 100, defaut: o.tva_pct }),
    };
    await db.run('UPDATE organisations SET nom=?, majoration_hs_pct=?, heures_jour_standard=?, tva_pct=? WHERE id=?',
      v.nom, v.majoration_hs_pct, v.heures_jour_standard, v.tva_pct, o.id);
    await audit(db, req.user, 'modification', 'organisation', o.id, v);
    res.json({ ok: true });
  });

  // ---------- Logo de l'entreprise ----------
  // PNG, JPEG ou WebP uniquement (pas de SVG, qui peut contenir du script), 300 Ko maximum.
  // Le type est déterminé par la signature du fichier, pas par ce que déclare le navigateur.
  const LOGO_MAX = 300 * 1024;
  const typeImage = (buf) => {
    if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
  };

  r.put('/organisation/logo', A.requirePerm('admin.parametres'), async (req, res) => {
    const m = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
    if (!m) throw new HttpError(400, 'Image invalide.');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > LOGO_MAX) throw new HttpError(400, 'Le logo ne doit pas dépasser 300 Ko.');
    const type = typeImage(buf);
    if (!type) throw new HttpError(400, 'Format accepté : PNG, JPEG ou WebP.');
    await db.run('UPDATE organisations SET logo = ?, logo_type = ?, logo_version = logo_version + 1 WHERE id = ?', buf, type, req.user.org_id);
    await audit(db, req.user, 'modification_logo', 'organisation', req.user.org_id, { type, octets: buf.length });
    res.json({ ok: true });
  });

  r.delete('/organisation/logo', A.requirePerm('admin.parametres'), async (req, res) => {
    await db.run('UPDATE organisations SET logo = NULL, logo_type = NULL, logo_version = logo_version + 1 WHERE id = ?', req.user.org_id);
    await audit(db, req.user, 'suppression_logo', 'organisation', req.user.org_id);
    res.json({ ok: true });
  });

  // Chaque utilisateur ne reçoit que le logo de sa propre entreprise
  r.get('/organisation/logo', A.requireAuth, async (req, res) => {
    const o = await db.get('SELECT logo, logo_type FROM organisations WHERE id = ?', req.user.org_id);
    if (!o.logo) throw new HttpError(404, 'Aucun logo.');
    res.setHeader('Content-Type', o.logo_type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(o.logo);
  });

  r.get('/journal', A.requirePerm('admin.journal'), async (req, res) => {
    res.json(await db.all(`
      SELECT a.*, u.nom AS utilisateur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.org_id = ? ORDER BY a.id DESC LIMIT 300`, req.user.org_id));
  });

  return r;
};
