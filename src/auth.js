'use strict';
const crypto = require('node:crypto');

const SESSION_DUREE_MS = 12 * 60 * 60 * 1000; // 12 h
const COOKIE = 'ea_session';

// ---------- Mots de passe (scrypt, sel aléatoire) ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
function validerMotDePasse(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Le mot de passe doit contenir des lettres et des chiffres.';
  return null;
}

// ---------- Matrice des permissions (appliquée côté serveur) ----------
// Rôles :
//   admin         administrateur de l'entreprise (utilisateurs, paramètres, tout)
//   direction     direction générale / technique : lecture et validation globales
//   conducteur    conducteur de travaux : ses chantiers, valide les pointages
//   chef_chantier saisit les pointages de ses chantiers
//   metreur       métreur / économiste : bibliothèques et études de prix
//   comptable     lecture des coûts, exports
const PERMISSIONS = {
  'chantier.lire':       ['admin', 'direction', 'conducteur', 'chef_chantier', 'metreur', 'comptable'],
  'chantier.ecrire':     ['admin', 'direction', 'conducteur'],
  'personnel.lire':      ['admin', 'direction', 'conducteur', 'chef_chantier', 'comptable'],
  'personnel.ecrire':    ['admin', 'direction', 'conducteur'],
  'pointage.lire':       ['admin', 'direction', 'conducteur', 'chef_chantier', 'comptable'],
  'pointage.saisir':     ['admin', 'conducteur', 'chef_chantier'],
  'pointage.valider':    ['admin', 'direction', 'conducteur'],
  'cout.lire':           ['admin', 'direction', 'conducteur', 'comptable', 'metreur'],
  'debourse.lire':       ['admin', 'direction', 'conducteur', 'metreur', 'comptable'],
  'debourse.ecrire':     ['admin', 'direction', 'metreur'],
  'etude.valider':       ['admin', 'direction'],
  'admin.utilisateurs':  ['admin'],
  'admin.parametres':    ['admin'],
  'admin.journal':       ['admin', 'direction'],
};
// Rôles limités aux chantiers qui leur sont explicitement attribués
const ROLES_RESTREINTS_CHANTIER = new Set(['conducteur', 'chef_chantier']);

function can(user, perm) {
  return !!user && (PERMISSIONS[perm] || []).includes(user.role);
}

// ---------- Sessions ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function creerSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_DUREE_MS);
  return token;
}
function supprimerSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}
function lireCookie(req, nom) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === nom) return decodeURIComponent(v.join('='));
  }
  return null;
}
function cookieSession(token, secure) {
  const attrs = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${SESSION_DUREE_MS / 1000}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
function cookieEfface(secure) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

// Middleware : charge l'utilisateur de la session
function sessionMiddleware(db) {
  const stmt = db.prepare(`
    SELECT u.id, u.org_id, u.email, u.nom, u.role, u.actif, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`);
  return (req, _res, next) => {
    const token = lireCookie(req, COOKIE);
    req.sessionToken = token;
    if (token) {
      const row = stmt.get(sha256(token));
      if (row && row.actif && row.expires_at > Date.now()) req.user = row;
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
  next();
}
function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
    if (!can(req.user, perm)) return res.status(403).json({ error: 'Accès refusé pour votre rôle.' });
    next();
  };
}

// Limitation simple en mémoire : renvoie true si plus de `max` essais dans la fenêtre.
// Connexion : 10 essais / 15 min par IP+email. Inscription : 5 espaces / heure par IP.
const tentatives = new Map();
function limiterConnexion(cle, max = 10, fenetreMs = 15 * 60 * 1000) {
  const now = Date.now();
  const t = (tentatives.get(cle) || []).filter((x) => now - x < fenetreMs);
  t.push(now);
  tentatives.set(cle, t);
  return t.length > max;
}
function reinitialiserTentatives(cle) { tentatives.delete(cle); }

module.exports = {
  COOKIE, PERMISSIONS, ROLES_RESTREINTS_CHANTIER,
  hashPassword, verifyPassword, validerMotDePasse, can,
  creerSession, supprimerSession, cookieSession, cookieEfface,
  sessionMiddleware, requireAuth, requirePerm, limiterConnexion, reinitialiserTentatives,
};
