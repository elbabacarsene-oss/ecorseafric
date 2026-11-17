'use strict';
const { ROLES_RESTREINTS_CHANTIER } = require('./auth');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Liste des chantiers accessibles (null = tous ceux de l'organisation)
async function chantiersAutorises(db, user) {
  if (!ROLES_RESTREINTS_CHANTIER.has(user.role)) return null;
  return (await db.all('SELECT chantier_id FROM user_chantiers WHERE user_id = ?', user.id)).map((r) => r.chantier_id);
}

// Vérifie qu'un chantier existe dans l'organisation ET que l'utilisateur y a accès.
// Renvoie 404 dans les deux cas pour ne pas révéler l'existence d'un chantier d'un autre client.
async function chargerChantier(db, user, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(404, 'Chantier introuvable.');
  const ch = await db.get('SELECT * FROM chantiers WHERE id = ? AND org_id = ?', n, user.org_id);
  if (!ch) throw new HttpError(404, 'Chantier introuvable.');
  const ids = await chantiersAutorises(db, user);
  if (ids && !ids.includes(ch.id)) throw new HttpError(404, 'Chantier introuvable.');
  return ch;
}

// Fragment SQL de filtrage des chantiers accessibles
async function filtreChantiers(db, user, colonne = 'c.id') {
  const ids = await chantiersAutorises(db, user);
  if (ids === null) return { sql: '', params: [] };
  if (ids.length === 0) return { sql: ' AND FALSE', params: [] };
  return { sql: ` AND ${colonne} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function audit(db, user, action, entite, entiteId, details) {
  return db.run('INSERT INTO audit_log (org_id, user_id, action, entite, entite_id, details) VALUES (?,?,?,?,?,?)',
    user.org_id, user.id ?? null, action, entite, entiteId ?? null, details ? JSON.stringify(details) : null);
}

// Identifiant numérique issu d'une URL : tout ce qui n'est pas un entier positif valide donne 404
function id(v, quoi = 'Ressource') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(404, `${quoi} introuvable.`);
  return n;
}

// ---------- Validation des entrées ----------
function texte(v, champ, { requis = false, max = 200 } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (requis) throw new HttpError(400, `Le champ « ${champ} » est obligatoire.`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `Le champ « ${champ} » dépasse ${max} caractères.`);
  return s;
}
function nombre(v, champ, { requis = false, min = -Infinity, max = Infinity, defaut = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requis) throw new HttpError(400, `Le champ « ${champ} » est obligatoire.`);
    return defaut;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `Le champ « ${champ} » doit être un nombre.`);
  if (n < min || n > max) throw new HttpError(400, `Le champ « ${champ} » doit être compris entre ${min} et ${max}.`);
  return n;
}
function date(v, champ, { requis = false } = {}) {
  if (!v) {
    if (requis) throw new HttpError(400, `Le champ « ${champ} » est obligatoire.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
    throw new HttpError(400, `Le champ « ${champ} » doit être une date AAAA-MM-JJ.`);
  }
  return v;
}
function choix(v, champ, valeurs, { requis = true, defaut = null } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requis && defaut === null) throw new HttpError(400, `Le champ « ${champ} » est obligatoire.`);
    return defaut;
  }
  if (!valeurs.includes(v)) throw new HttpError(400, `Valeur invalide pour « ${champ} ».`);
  return v;
}

// Date du jour à Dakar (UTC+0, sans heure d'été)
function aujourdhuiDakar() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar' }).format(new Date());
}

// Export CSV compatible Excel français (séparateur « ; », BOM UTF-8)
function csv(lignes, colonnes) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = [colonnes.map((c) => esc(c.titre)).join(';')];
  for (const l of lignes) out.push(colonnes.map((c) => esc(typeof c.valeur === 'function' ? c.valeur(l) : l[c.valeur])).join(';'));
  return '﻿' + out.join('\r\n') + '\r\n';
}

module.exports = {
  HttpError, id, chantiersAutorises, chargerChantier, filtreChantiers, audit,
  texte, nombre, date, choix, aujourdhuiDakar, csv,
};
