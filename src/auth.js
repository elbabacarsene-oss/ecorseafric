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

async function creerSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + SESSION_DUREE_MS);
  return token;
}
async function supprimerSession(db, token) {
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

// Jetons à usage unique envoyés par e-mail (stockés hachés)
const DUREES_JETON = { verification: 48 * 3600 * 1000, reinitialisation: 3600 * 1000 };
async function creerJeton(db, userId, type) {
  const jeton = crypto.randomBytes(32).toString('base64url');
  await db.run('UPDATE jetons SET utilise = TRUE WHERE user_id = ? AND type = ? AND utilise = FALSE', userId, type);
  await db.run('INSERT INTO jetons (token_hash, user_id, type, expires_at) VALUES (?, ?, ?, ?)', sha256(jeton), userId, type, Date.now() + DUREES_JETON[type]);
  return jeton;
}
// Consomme un jeton valide et renvoie l'identifiant de l'utilisateur, ou null
async function consommerJeton(db, jeton, type) {
  const r = await db.get(`UPDATE jetons SET utilise = TRUE WHERE token_hash = ? AND type = ? AND utilise = FALSE AND expires_at > ?
    RETURNING user_id`, sha256(String(jeton || '')), type, Date.now());
  return r ? r.user_id : null;
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
// Middleware : charge l'utilisateur de la session et l'état d'abonnement de son entreprise
function sessionMiddleware(db) {
  return async (req, _res, next) => {
    const token = lireCookie(req, COOKIE);
    req.sessionToken = token;
    if (token) {
      const row = await db.get(`
        SELECT u.id, u.org_id, u.email, u.nom, u.role, u.actif, u.email_verifie, s.expires_at,
          o.essai_fin, o.abonnement_fin
        FROM sessions s JOIN users u ON u.id = s.user_id JOIN organisations o ON o.id = u.org_id
        WHERE s.token_hash = ?`, sha256(token));
      if (row && row.actif && row.expires_at > Date.now()) req.user = row;
    }
    next();
  };
}

// État d'accès d'une entreprise : essai, abonnement actif, expiré, ou essai non démarré (e-mail non confirmé)
function etatAcces(org, maintenant = new Date()) {
  const ab = org.abonnement_fin ? new Date(org.abonnement_fin) : null;
  const es = org.essai_fin ? new Date(org.essai_fin) : null;
  if (ab && ab > maintenant) return { statut: 'abonne', fin: ab.toISOString() };
  if (es && es > maintenant) return { statut: 'essai', fin: es.toISOString() };
  if (!es && !ab) return { statut: 'non_demarre', fin: null };
  return { statut: 'expire', fin: (ab && (!es || ab > es) ? ab : es).toISOString() };
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

// Limitation des tentatives, stockée dans PostgreSQL : valable quel que soit le nombre d'instances
// (Vercel lance plusieurs copies de l'application). Renvoie true si plus de `max` essais dans la fenêtre.
// Connexion : 10 essais / 15 min par IP+email. Inscription : 5 espaces / heure par IP.
async function limiterConnexion(db, cle, max = 10, fenetreMs = 15 * 60 * 1000) {
  await db.run('INSERT INTO tentatives (cle) VALUES (?)', cle);
  const { n } = await db.get(`SELECT COUNT(*) AS n FROM tentatives WHERE cle = ? AND le > now() - make_interval(secs => ?)`, cle, fenetreMs / 1000);
  if (Math.random() < 0.02) await db.run(`DELETE FROM tentatives WHERE le < now() - interval '1 day'`);
  return n > max;
}
function reinitialiserTentatives(db, cle) { return db.run('DELETE FROM tentatives WHERE cle = ?', cle); }

module.exports = {
  COOKIE, PERMISSIONS, ROLES_RESTREINTS_CHANTIER,
  hashPassword, verifyPassword, validerMotDePasse, can,
  creerSession, supprimerSession, creerJeton, consommerJeton, etatAcces, sha256, cookieSession, cookieEfface,
  sessionMiddleware, requireAuth, requirePerm, limiterConnexion, reinitialiserTentatives,
};
