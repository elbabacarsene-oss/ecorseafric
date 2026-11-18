'use strict';
/* BTP Manager 360 — interface web (SPA sans dépendance). */

// ============ Utilitaires ============
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtXOF = (n) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' F CFA');
const fmtNum = (n, d = 2) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(n));
const fmtDate = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
const aujourdhui = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dakar' }).format(new Date());

const LIB = {
  statut_chantier: { preparation: ['En préparation', 'bleu'], en_cours: ['En cours', 'vert'], suspendu: ['Suspendu', 'orange'], termine: ['Terminé', ''], receptionne: ['Réceptionné', ''] },
  presence: { present: 'Présent', demi_journee: '½ journée', absent: 'Absent', conge: 'Congé', maladie: 'Maladie', absence_autorisee: 'Abs. autorisée' },
  statut_pointage: { saisi: ['À valider', 'orange'], valide: ['Validé', 'vert'], rejete: ['Rejeté', 'rouge'] },
  statut_etude: { brouillon: ['Brouillon', ''], valide: ['Validée', 'bleu'], accepte: ['Acceptée', 'vert'], refuse: ['Refusée', 'rouge'] },
  nature: { main_oeuvre: "Main-d'œuvre", materiau: 'Matériaux', materiel: 'Matériel', sous_traitance: 'Sous-traitance' },
  role: { admin: 'Administrateur', direction: 'Direction', conducteur: 'Conducteur de travaux', chef_chantier: 'Chef de chantier', metreur: 'Métreur / Économiste', comptable: 'Comptable' },
};
const badge = (map, k) => { const v = LIB[map][k] || [k, '']; return `<span class="badge ${v[1]}">${esc(v[0])}</span>`; };

async function api(method, url, body) {
  // Toute requête d'écriture part en JSON (exigé par la protection CSRF du serveur), même sans données
  if (method !== 'GET' && body === undefined) body = {};
  let res;
  try {
    res = await fetch('/api' + url, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw erreurHorsLigne();
  }
  if (res.status === 401 && !url.startsWith('/auth/')) { state.moi = null; location.hash = '#/connexion'; throw new Error('Session expirée, reconnectez-vous.'); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  if (res.status === 403 && data && data.code === 'email_non_verifie') { state.moi = null; router(); }
  if (res.status === 503 && data && data.code === 'hors_ligne') throw erreurHorsLigne(data.error);
  if (!res.ok) throw new Error((data && data.error) || `Erreur ${res.status}`);
  return data;
}
function erreurHorsLigne(message) {
  const e = new Error(message || 'Pas de connexion internet.');
  e.horsLigne = true;
  return e;
}
const GET = (u) => api('GET', u);
const POST = (u, b = {}) => api('POST', u, b);

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'visible' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

const state = { moi: null, config: { nom_produit: 'BTP Manager 360', inscription_ouverte: true } };
const logoEntreprise = () => (state.moi && state.moi.organisation.a_logo ? `/api/organisation/logo?v=${state.moi.organisation.logo_version}` : '/logo.svg');
const peut = (p) => !!state.moi && state.moi.permissions.includes(p);
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v !== null && v !== undefined) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

// ============ Formulaire modal générique ============
// champs : [{ name, label, type: text|number|date|select|textarea|password|email, options: [[val, lib]], required, value, large, step }]
function formulaire({ titre, champs, valider = 'Enregistrer', onSubmit, intro = '' }) {
  const d = $('#dialog');
  const champ = (c) => {
    const req = c.required ? 'required' : '';
    const val = c.value ?? '';
    let input;
    if (c.type === 'select') {
      input = `<select name="${c.name}" ${req}>${c.vide !== false ? '<option value="">—</option>' : ''}${c.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    } else if (c.type === 'textarea') {
      input = `<textarea name="${c.name}" rows="3" ${req}>${esc(val)}</textarea>`;
    } else {
      input = `<input name="${c.name}" type="${c.type || 'text'}" value="${esc(val)}" ${req} ${c.step ? `step="${c.step}"` : (c.type === 'number' ? 'step="any"' : '')} ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.autocomplete ? `autocomplete="${c.autocomplete}"` : ''}>`;
    }
    return `<label class="${c.large ? 'large' : ''}"><span class="${c.required ? 'req' : ''}">${esc(c.label)}</span>${input}</label>`;
  };
  d.innerHTML = `<form method="dialog"><header>${esc(titre)}</header><div class="corps">${intro}<div class="msg"></div>
    <div class="form">${champs.map(champ).join('')}</div></div>
    <footer><button type="button" class="btn secondaire" data-annuler>Annuler</button><button class="btn vert" type="submit">${esc(valider)}</button></footer></form>`;
  $('[data-annuler]', d).onclick = () => d.close();
  $('form', d).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const v = {};
    for (const c of champs) {
      const x = fd.get(c.name);
      v[c.name] = c.type === 'number' ? (x === '' ? null : Number(x)) : (x === '' ? null : x);
    }
    const btn = $('button[type=submit]', d); btn.disabled = true;
    try { await onSubmit(v); d.close(); } catch (err) { $('.msg', d).innerHTML = `<div class="erreur">${esc(err.message)}</div>`; } finally { btn.disabled = false; }
  };
  d.showModal();
  const first = $('input, select, textarea', d); if (first) first.focus();
}

function confirmer(message, action) {
  formulaire({ titre: 'Confirmation', champs: [], intro: `<p>${esc(message)}</p>`, valider: 'Confirmer', onSubmit: action });
}

// ============ Rendu principal ============
const NAV = [
  { titre: 'Pilotage' },
  { href: '#/', lib: 'Tableau de bord' },
  { href: '#/chantiers', lib: 'Chantiers', perm: 'chantier.lire' },
  { titre: 'Pointage' },
  { href: '#/pointage', lib: 'Feuille de pointage', perm: 'pointage.lire' },
  { href: '#/pointages', lib: 'Historique & coûts MO', perm: 'pointage.lire' },
  { href: '#/synchronisation', lib: 'Synchronisation', perm: 'pointage.saisir' },
  { href: '#/personnel', lib: 'Personnel', perm: 'personnel.lire' },
  { titre: 'Déboursé sec' },
  { href: '#/etudes', lib: 'Études de prix', perm: 'debourse.lire' },
  { href: '#/ouvrages', lib: "Bibliothèque d'ouvrages", perm: 'debourse.lire' },
  { href: '#/ressources', lib: 'Ressources & prix', perm: 'debourse.lire' },
  { titre: 'Administration', perm: 'admin.journal' },
  { href: '#/admin', lib: 'Utilisateurs & paramètres', perm: 'admin.utilisateurs' },
  { href: '#/journal', lib: "Journal d'activité", perm: 'admin.journal' },
  { titre: 'Compte' },
  { href: '#/abonnement', lib: 'Abonnement' },
];

function coquille(contenu) {
  const h = location.hash || '#/';
  const actif = (href) => (href === '#/' ? h === '#/' || h === '' : h.startsWith(href) && (h.length === href.length || '/?'.includes(h[href.length])));
  const nav = NAV.filter((n) => !n.perm || peut(n.perm)).map((n) => (n.titre ? `<li class="titre">${esc(n.titre)}</li>` : `<li><a href="${n.href}" class="${actif(n.href) ? 'actif' : ''}">${esc(n.lib)}</a></li>`)).join('');
  const u = state.moi.utilisateur;
  $('#app').innerHTML = `<div class="layout">
    <aside class="sidebar" id="sidebar"><div class="brand"><img src="${logoEntreprise()}" alt="Logo ${esc(state.moi.organisation.nom)}"><div><b>${esc(state.moi.organisation.nom)}</b><small>${esc(state.config.nom_produit)}</small></div></div><ul class="nav">${nav}</ul></aside>
    <main class="main"><div class="topbar"><button class="btn secondaire petit menu-mobile" id="burger">☰ Menu</button><span id="etat-sync"></span>
      <div class="user"><span>${esc(u.nom)} · ${esc(LIB.role[u.role])}</span><button class="btn secondaire petit" id="mdp">Mot de passe</button><button class="btn secondaire petit" id="logout">Déconnexion</button></div></div>
      ${bandeauAcces()}<div id="page">${contenu}</div></main></div>`;
  $('#burger').onclick = () => $('#sidebar').classList.toggle('ouvert');
  $('#logout').onclick = () => deconnecter();
  majIndicateur();
  $('#mdp').onclick = () => formulaire({
    titre: 'Changer mon mot de passe', champs: [
      { name: 'actuel', label: 'Mot de passe actuel', type: 'password', required: true, autocomplete: 'current-password' },
      { name: 'nouveau', label: 'Nouveau mot de passe (10 caractères min., lettres et chiffres)', type: 'password', required: true, autocomplete: 'new-password' }],
    onSubmit: async (v) => { await POST('/auth/mot-de-passe', v); toast('Mot de passe modifié.'); },
  });
}

const ROUTES = [];
const route = (re, fn) => ROUTES.push([re, fn]);

async function router() {
  const h = location.hash.slice(1) || '/';
  const [chemin, query] = h.split('?');
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  if (chemin === '/connexion' || chemin === '/inscription') return pageAuth(chemin === '/inscription');
  if (PAGES_PUBLIQUES[chemin]) return PAGES_PUBLIQUES[chemin](params);
  if (!state.moi) {
    try { state.moi = await GET('/auth/moi'); } catch (e) {
      if (e.horsLigne) {
        $('#app').innerHTML = '<div class="auth"><div class="auth-box"><h3>Pas de connexion internet</h3><p>Ouvrez l\'application une première fois avec du réseau et connectez-vous : vous pourrez ensuite pointer même hors connexion.</p><button class="btn vert" id="reessayer">Réessayer</button></div></div>';
        $('#reessayer').onclick = () => router();
        return;
      }
      location.hash = '#/connexion'; return;
    }
    synchroniserFile();
  }
  if (!state.moi.utilisateur.email_verifie) return pageEmailNonConfirme();
  for (const [re, fn] of ROUTES) {
    const m = chemin.match(re);
    if (m) {
      coquille('<div class="vide">Chargement…</div>');
      try { await fn(params, ...m.slice(1)); } catch (e) { $('#page').innerHTML = `<div class="erreur">${esc(e.message)}</div>`; }
      return;
    }
  }
  coquille('<div class="vide">Page introuvable.</div>');
}
window.addEventListener('hashchange', router);
// Un dialogue fermé ne doit pas laisser de champs dans le DOM (risque de confusion de sélecteurs)
$('#dialog').addEventListener('close', (e) => { e.target.innerHTML = ''; });
const rafraichir = () => router();
const page = (html) => { $('#page').innerHTML = html; };

// ============ Authentification ============
function pageAuth(inscription) {
  $('#app').innerHTML = `<div class="auth"><div class="auth-box">
    <div class="brand"><img src="/logo.svg" alt=""><div><b>${esc(state.config.nom_produit)}</b><small>Pointage & déboursés secs pour le BTP</small></div></div>
    <div class="msg"></div>
    <form id="f">${inscription ? `
      <label>Entreprise<input name="entreprise" required></label>
      <label>Votre nom<input name="nom" required autocomplete="name"></label>` : ''}
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label>Mot de passe<input name="mot_de_passe" type="password" required autocomplete="${inscription ? 'new-password' : 'current-password'}"></label>
      ${inscription ? '<span class="muted">10 caractères minimum, lettres et chiffres.</span>' : ''}
      <button class="btn vert" type="submit">${inscription ? "Créer l'espace entreprise" : 'Se connecter'}</button>
    </form>
    ${inscription ? `<p class="muted">Essai gratuit de ${state.config.essai_heures || 24} h, sans moyen de paiement. Un e-mail de confirmation vous sera envoyé.</p>` : '<p class="muted"><a href="#/mot-de-passe-oublie">Mot de passe oublié ?</a></p>'}
    <p class="muted">${inscription ? '<a href="#/connexion">J\'ai déjà un compte</a>' : (state.config.inscription_ouverte ? 'Nouvelle entreprise ? <a href="#/inscription">Créer un espace gratuitement</a>' : '')}</p>
  </div></div>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target));
    try {
      await POST(inscription ? '/auth/inscription' : '/auth/connexion', v);
      viderDonneesLocales();
      state.moi = await GET('/auth/moi');
      location.hash = '#/';
    } catch (err) { $('.msg').innerHTML = `<div class="erreur">${esc(err.message)}</div>`; }
  };
}

// ============ Pages publiques : confirmation d'e-mail, mot de passe oublié ============
function boiteAuth(contenu) {
  $('#app').innerHTML = `<div class="auth"><div class="auth-box">
    <div class="brand"><img src="/logo.svg" alt=""><div><b>${esc(state.config.nom_produit)}</b><small>Pointage & déboursés secs pour le BTP</small></div></div>
    <div class="msg"></div>${contenu}</div></div>`;
}
const msgAuth = (html, ok = false) => { $('.msg').innerHTML = `<div class="${ok ? 'info' : 'erreur'}">${html}</div>`; };

const PAGES_PUBLIQUES = {
  '/mot-de-passe-oublie': () => {
    boiteAuth(`<form id="f"><p class="muted">Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <button class="btn vert">Recevoir le lien</button></form><p class="muted"><a href="#/connexion">Retour à la connexion</a></p>`);
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await POST('/auth/mot-de-passe-oublie', Object.fromEntries(new FormData(e.target)));
        msgAuth('Si un compte existe pour cette adresse, un e-mail vient d\'être envoyé. Le lien est valable 1 heure. Pensez à regarder dans les courriers indésirables.', true);
        e.target.remove();
      } catch (err) { msgAuth(esc(err.message)); }
    };
  },
  '/reinitialiser': (p) => {
    boiteAuth(`<form id="f"><label>Nouveau mot de passe<input name="mot_de_passe" type="password" required autocomplete="new-password"></label>
      <label>Confirmation<input name="confirmation" type="password" required autocomplete="new-password"></label>
      <span class="muted">10 caractères minimum, lettres et chiffres.</span><button class="btn vert">Enregistrer</button></form>`);
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      if (v.mot_de_passe !== v.confirmation) { msgAuth('Les deux mots de passe ne correspondent pas.'); return; }
      try {
        await POST('/auth/reinitialiser', { jeton: p.jeton, mot_de_passe: v.mot_de_passe });
        state.moi = null;
        msgAuth('Mot de passe modifié. <a href="#/connexion">Se connecter</a>', true);
        e.target.remove();
      } catch (err) { msgAuth(esc(err.message) + ' <a href="#/mot-de-passe-oublie">Nouvelle demande</a>'); }
    };
  },
  '/confirmer': async (p) => {
    boiteAuth('<p class="muted">Confirmation en cours…</p>');
    try {
      await POST('/auth/confirmer-email', { jeton: p.jeton });
      state.moi = null;
      boiteAuth(`<div class="info">Adresse confirmée. Votre essai gratuit de ${state.config.essai_heures || 24} h commence maintenant.</div>
        <a class="btn vert" href="#/">Accéder à mon espace</a>`);
    } catch (err) {
      boiteAuth(`<div class="erreur">${esc(err.message)}</div><a class="btn secondaire" href="#/">Continuer</a>`);
    }
  },
};

function pageEmailNonConfirme() {
  const u = state.moi.utilisateur;
  boiteAuth(`<h3>Confirmez votre adresse e-mail</h3>
    <p>Un e-mail a été envoyé à <b>${esc(u.email)}</b>. Cliquez sur le lien qu'il contient pour activer votre espace : votre essai gratuit de ${state.config.essai_heures || 24} h démarrera à ce moment-là.</p>
    <p class="muted">Rien reçu ? Vérifiez les courriers indésirables, ou renvoyez l'e-mail.</p>
    <div class="actions"><button class="btn vert" id="renvoyer">Renvoyer l'e-mail</button><button class="btn secondaire" id="deja">J'ai confirmé</button><button class="btn secondaire" id="sortir">Déconnexion</button></div>`);
  $('#renvoyer').onclick = () => POST('/auth/renvoyer-confirmation').then(() => msgAuth('E-mail renvoyé.', true)).catch((e) => msgAuth(esc(e.message)));
  $('#deja').onclick = () => { state.moi = null; router(); };
  $('#sortir').onclick = () => deconnecter();
}

// ============ Mode hors ligne : synchronisation ============
function viderDonneesLocales() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('vider-donnees');
}

async function deconnecter() {
  if (HorsLigne.disponible && state.moi) {
    const n = (await HorsLigne.operations(state.moi.utilisateur.id)).length;
    if (n && !window.confirm(`${n} saisie(s) de pointage ne sont pas encore envoyées. Elles resteront sur cet appareil et partiront à votre prochaine connexion. Se déconnecter quand même ?`)) return;
  }
  try { await POST('/auth/deconnexion'); } catch { /* hors ligne : la session expirera d'elle-même */ }
  viderDonneesLocales();
  state.moi = null;
  location.hash = '#/connexion';
}

async function majIndicateur() {
  const el = $('#etat-sync');
  if (!el || !state.moi) return;
  let html = navigator.onLine ? '' : '<span class="badge rouge">Hors connexion</span> ';
  if (HorsLigne.disponible) {
    const uid = state.moi.utilisateur.id;
    const ops = await HorsLigne.operations(uid);
    const evts = await HorsLigne.evenements(uid);
    const echecs = ops.filter((o) => o.statut === 'echec').length;
    if (ops.length - echecs) html += `<a class="badge orange" href="#/synchronisation">${ops.length - echecs} saisie(s) à envoyer</a> `;
    if (echecs + evts.length) html += `<a class="badge rouge" href="#/synchronisation">${echecs + evts.length} à revoir</a>`;
  }
  if ($('#etat-sync')) $('#etat-sync').innerHTML = html;
}

async function synchroniserFile({ silencieux = false } = {}) {
  const vide = { envoyees: 0, conflits: 0, echecs: 0, reste: 0 };
  if (!HorsLigne.disponible || !state.moi) return vide;
  const uid = state.moi.utilisateur.id;
  if (!(await HorsLigne.operations(uid)).some((o) => o.statut === 'en_attente')) { majIndicateur(); return vide; }
  const b = await HorsLigne.synchroniser(uid);
  majIndicateur();
  if (!silencieux && b.envoyees) toast(`${b.envoyees} saisie(s) faite(s) hors connexion envoyée(s).${b.conflits ? ` ${b.conflits} ligne(s) à revoir.` : ''}`, b.conflits > 0);
  if (!silencieux && b.connexion_requise) toast('Des saisies attendent sur cet appareil : reconnectez-vous pour les envoyer.', true);
  return b;
}

// Garde en mémoire de l'appareil les ouvriers des chantiers actifs, pour pointer sans réseau
let dernierPrechargement = 0;
function prechargerPourHorsLigne(chantiers) {
  if (Date.now() - dernierPrechargement < 10 * 60 * 1000 || !peut('personnel.lire')) return;
  dernierPrechargement = Date.now();
  chantiers.filter((c) => ['en_cours', 'preparation', 'suspendu'].includes(c.statut)).slice(0, 30)
    .forEach((c) => GET(`/chantiers/${c.id}/ouvriers`).catch(() => {}));
}

window.addEventListener('online', () => { majIndicateur(); synchroniserFile(); });
window.addEventListener('offline', () => majIndicateur());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchroniserFile(); });
setInterval(() => { if (navigator.onLine) synchroniserFile(); }, 30 * 1000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

route(/^\/synchronisation$/, async () => {
  if (!HorsLigne.disponible) { page('<h1>Synchronisation</h1><div class="info">Ce navigateur ne permet pas la saisie hors connexion.</div>'); return; }
  const uid = state.moi.utilisateur.id;
  const ops = await HorsLigne.operations(uid);
  const evts = await HorsLigne.evenements(uid);
  const lienFeuille = (chId, date) => `#/pointage?chantier=${chId}&date=${date}`;
  let html = `<h1>Synchronisation</h1>
    <p class="muted">Les pointages saisis sans réseau sont gardés sur cet appareil puis envoyés automatiquement dès que la connexion revient (application ouverte).
    Un même envoi n'est jamais enregistré deux fois. Si une ligne a été modifiée entre-temps par quelqu'un d'autre, elle n'est pas écrasée : elle apparaît ci-dessous « à revoir ».</p>
    <div class="actions"><span class="badge ${navigator.onLine ? 'vert' : 'rouge'}">${navigator.onLine ? 'Connecté' : 'Hors connexion'}</span>
    ${ops.some((o) => o.statut === 'en_attente') ? '<button class="btn vert" id="envoyer">Envoyer maintenant</button>' : ''}</div>
    <h2>Saisies sur l'appareil (${ops.length})</h2>`;
  html += ops.length ? `<div class="table-wrap"><table><thead><tr><th>Chantier</th><th>Date</th><th class="num">Lignes</th><th>Saisi le</th><th class="num">Tentatives</th><th>État</th><th></th></tr></thead><tbody>
    ${ops.map((o) => `<tr><td>${esc(o.chantier_code)}</td><td>${fmtDate(o.date)}</td><td class="num">${o.lignes.length}</td><td>${fmtDateHeure(o.cree_le)}</td><td class="num">${o.tentatives}</td>
      <td>${o.statut === 'echec' ? `<span class="badge rouge">Refusé</span> <span class="muted">${esc(o.erreur || '')}</span>` : `<span class="badge orange">À envoyer</span>${o.erreur ? ` <span class="muted">${esc(o.erreur)}</span>` : ''}`}</td>
      <td class="actions"><a class="btn secondaire petit" href="${lienFeuille(o.chantier_id, o.date)}">Ouvrir</a>
        ${o.statut === 'echec' ? `<button class="btn secondaire petit" data-reessayer="${o.id}">Réessayer</button>` : ''}
        <button class="btn danger petit" data-suppr-op="${o.id}">Supprimer</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucune saisie en attente : tout est envoyé.</div>';
  html += `<h2>À revoir (${evts.length})</h2>`;
  html += evts.length ? evts.map((e) => `<div class="panneau"><div class="actions"><b>${esc(e.chantier_code)} — ${fmtDate(e.date)}</b><span class="muted">envoyé le ${fmtDateHeure(e.le)}</span>
      <a class="btn secondaire petit" href="${lienFeuille(e.chantier_id, e.date)}">Ouvrir la feuille</a><button class="btn secondaire petit" data-suppr-evt="${e.id}">Marquer comme traité</button></div>
      <ul>${e.details.map((d) => `<li>${esc(d.nom || 'Ouvrier ' + d.ouvrier_id)} : ${esc(d.raison)}</li>`).join('')}</ul></div>`).join('')
    : '<div class="panneau vide">Aucun conflit.</div>';
  page(html);
  if ($('#envoyer')) $('#envoyer').onclick = async () => { await synchroniserFile(); rafraichir(); };
  $$('[data-reessayer]').forEach((b) => { b.onclick = async () => { await HorsLigne.marquerAReessayer(b.dataset.reessayer); await synchroniserFile(); rafraichir(); }; });
  $$('[data-suppr-op]').forEach((b) => { b.onclick = () => confirmer('Supprimer définitivement cette saisie non envoyée ?', async () => { await HorsLigne.supprimerOperation(b.dataset.supprOp); majIndicateur(); rafraichir(); }); });
  $$('[data-suppr-evt]').forEach((b) => { b.onclick = async () => { await HorsLigne.supprimerEvenement(Number(b.dataset.supprEvt)); majIndicateur(); rafraichir(); }; });
});

// ============ Abonnement ============
const fmtDateHeure = (iso) => (iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Dakar', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—');
function bandeauAcces() {
  const a = state.moi.acces;
  const heures = a.fin ? (Date.parse(a.fin) - Date.now()) / 3600000 : 0;
  if (a.statut === 'essai') return `<div class="bandeau">Essai gratuit : il reste <b>${heures >= 1 ? Math.floor(heures) + ' h' : Math.max(1, Math.round(heures * 60)) + ' min'}</b> (jusqu'au ${fmtDateHeure(a.fin)}). <a href="#/abonnement">S'abonner</a></div>`;
  if (a.statut === 'expire' || a.statut === 'non_demarre') return `<div class="bandeau alerte">Votre ${a.statut === 'expire' ? 'période d\'essai ou abonnement est terminé' : 'essai n\'a pas démarré'} : l'espace est en <b>lecture seule</b>. <a href="#/abonnement">Renouveler l'abonnement</a></div>`;
  if (a.statut === 'abonne' && heures < 24 * 7) return `<div class="bandeau attention">Votre abonnement se termine le ${fmtDateHeure(a.fin)}. <a href="#/abonnement">Le prolonger</a></div>`;
  return '';
}

route(/^\/abonnement$/, async (p) => {
  let verif = null;
  if (p.paiement) {
    // Retour de Wave : le serveur interroge Wave pour connaître le vrai statut du paiement
    for (let i = 0; i < 5; i++) {
      try { verif = await POST(`/abonnement/paiements/${Number(p.paiement)}/verifier`); } catch (e) { verif = { erreur: e.message }; break; }
      if (verif.statut !== 'en_attente') break;
      await new Promise((r) => setTimeout(r, 2500));
    }
    state.moi = await GET('/auth/moi');
    coquille('<div class="vide">Chargement…</div>');
  }
  const ab = await GET('/abonnement');
  const a = ab.acces;
  const libStatut = { essai: ['Essai gratuit', 'bleu'], abonne: ['Abonnement actif', 'vert'], expire: ['Expiré — lecture seule', 'rouge'], non_demarre: ['Essai non démarré', 'orange'] }[a.statut];
  let html = '<h1>Abonnement</h1>';
  if (verif) {
    html += verif.erreur ? `<div class="erreur">${esc(verif.erreur)}</div>`
      : verif.statut === 'paye' ? '<div class="info">Paiement reçu. Merci ! Votre abonnement est actif.</div>'
      : verif.statut === 'echoue' ? '<div class="erreur">Le paiement a été annulé ou a expiré. Aucun montant n\'a été débité. Vous pouvez réessayer.</div>'
      : `<div class="info">Paiement en cours de confirmation par Wave. <button class="btn petit" id="reverifier">Vérifier à nouveau</button></div>`;
  }
  html += `<div class="panneau"><dl class="fiche"><dt>Statut</dt><dd><span class="badge ${libStatut[1]}">${libStatut[0]}</span></dd>
    ${a.fin ? `<dt>${a.statut === 'expire' ? 'Terminé le' : 'Jusqu\'au'}</dt><dd>${fmtDateHeure(a.fin)} (heure de Dakar)</dd>` : ''}
    ${ab.prix_mensuel ? `<dt>Tarif</dt><dd>${fmtXOF(ab.prix_mensuel)} par mois</dd>` : ''}</dl>
    <p class="muted">Sans abonnement actif, vos données restent consultables mais la saisie (pointage, études, chantiers…) est bloquée. Un paiement prolonge l'abonnement à partir de sa date de fin actuelle : rien n'est perdu en payant en avance.</p></div>`;
  if (!ab.paiement_disponible) {
    html += '<div class="info">Le paiement en ligne n\'est pas encore activé sur ce service. Contactez le support pour vous abonner.</div>';
  } else if (!ab.peut_payer) {
    html += '<div class="info">Seul un administrateur de votre entreprise peut régler l\'abonnement.</div>';
  } else {
    html += `<h2>Payer avec Wave</h2><div class="cartes">${ab.durees.map((m) => `<div class="carte vert"><div class="lib">${m} mois</div>
      <div class="val">${fmtXOF(ab.prix_mensuel * m)}</div><p><button class="btn vert" data-mois="${m}">Payer avec Wave</button></p></div>`).join('')}</div>
      <p class="muted">Vous serez redirigé vers la page de paiement sécurisée de Wave (application Wave ou QR code), puis ramené ici.</p>`;
  }
  if (ab.paiements.length) {
    const lib = { paye: ['Payé', 'vert'], en_attente: ['En attente', 'orange'], echoue: ['Annulé / échoué', 'rouge'] };
    html += `<h2>Historique des paiements</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Durée</th><th class="num">Montant</th><th>Statut</th><th>Période couverte</th><th></th></tr></thead><tbody>
      ${ab.paiements.map((x) => `<tr><td>${fmtDateHeure(x.created_at)}</td><td>${x.mois} mois</td><td class="num">${fmtXOF(x.montant)}</td>
        <td><span class="badge ${lib[x.statut][1]}">${lib[x.statut][0]}</span></td>
        <td>${x.periode_debut ? `${fmtDate(x.periode_debut)} → ${fmtDate(x.periode_fin)}` : '—'}</td>
        <td>${x.statut === 'en_attente' ? `<button class="btn secondaire petit" data-verif="${x.id}">Vérifier</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  page(html);
  $$('[data-mois]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { const r = await POST('/abonnement/paiements', { mois: Number(b.dataset.mois) }); location.href = r.wave_launch_url; }
      catch (e) { toast(e.message, true); b.disabled = false; }
    };
  });
  $$('[data-verif]').forEach((b) => { b.onclick = () => { location.hash = `#/abonnement?paiement=${b.dataset.verif}&t=${Date.now()}`; }; });
  if ($('#reverifier')) $('#reverifier').onclick = () => { location.hash = `#/abonnement?paiement=${Number(p.paiement)}&t=${Date.now()}`; };
});

// ============ Tableau de bord ============
function barre(pct) {
  if (pct === null || pct === undefined) return '<span class="muted">Pas d\'étude de référence</span>';
  const cls = pct > 100 ? 'depasse' : pct > 85 ? 'proche' : '';
  return `<div class="actions"><div class="barre" data-pct="${Math.min(pct, 100)}"><span class="${cls}"></span></div><span>${fmtNum(pct, 1)} %</span></div>`;
}
const appliquerBarres = () => $$('.barre[data-pct]').forEach((b) => { b.firstElementChild.style.width = b.dataset.pct + '%'; });

route(/^\/$/, async () => {
  const d = await GET('/tableau-de-bord');
  const c = d.chantiers;
  let html = `<h1>Tableau de bord</h1><p class="muted">Situation au ${fmtDate(d.date)} (heure de Dakar). Toutes les valeurs proviennent des données enregistrées.</p>
    <div class="cartes">
      <div class="carte vert"><div class="lib">Chantiers en cours</div><div class="val">${c.en_cours}</div></div>
      <div class="carte"><div class="lib">En préparation</div><div class="val">${c.preparation}</div></div>
      <div class="carte ${c.en_retard ? 'alerte' : ''}"><div class="lib">En retard (date de fin dépassée)</div><div class="val">${c.en_retard}</div></div>
      <div class="carte"><div class="lib">Suspendus</div><div class="val">${c.suspendus}</div></div>`;
  if (d.pointage) {
    html += `<div class="carte vert"><div class="lib">Présents aujourd'hui</div><div class="val">${d.pointage.presents_aujourdhui}</div></div>
      <div class="carte"><div class="lib">Ouvriers actifs</div><div class="val">${d.pointage.ouvriers_actifs}</div></div>
      <div class="carte ${d.pointage.lignes_a_valider ? 'attention' : ''}"><div class="lib">Lignes de pointage à valider</div><div class="val">${d.pointage.lignes_a_valider}</div></div>`;
  }
  if (d.couts) html += `<div class="carte"><div class="lib">Coût MO validé (${d.couts.mois.split('-').reverse().join('/')})</div><div class="val">${fmtXOF(d.couts.mo_validee_mois)}</div></div>`;
  html += '</div>';

  if (d.pointage && d.pointage.jours_a_valider.length) {
    html += `<h2>Pointages en attente de validation</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Chantier</th><th class="num">Lignes</th><th></th></tr></thead><tbody>
      ${d.pointage.jours_a_valider.map((j) => `<tr><td>${fmtDate(j.date)}</td><td>${esc(j.code)} — ${esc(j.nom)}</td><td class="num">${j.lignes}</td>
      <td><a class="btn petit" href="#/pointage?chantier=${j.chantier_id}&date=${j.date}">Ouvrir</a></td></tr>`).join('')}</tbody></table></div>`;
  }
  if (d.couts) {
    html += `<h2>Main-d'œuvre : réel validé / prévu au déboursé sec</h2>`;
    html += d.couts.par_chantier.length ? `<div class="table-wrap"><table><thead><tr><th>Chantier</th><th>Statut</th><th class="num">MO prévue (DS)</th><th class="num">MO réelle validée</th><th>Consommation</th></tr></thead><tbody>
      ${d.couts.par_chantier.map((x) => `<tr class="cliquable" data-href="#/chantiers/${x.id}"><td>${esc(x.code)} — ${esc(x.nom)}</td><td>${badge('statut_chantier', x.statut)}</td>
      <td class="num">${fmtXOF(x.mo_prevue)}</td><td class="num">${fmtXOF(x.mo_reelle)}</td><td>${barre(x.consommation_pct)}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="panneau vide">Aucun chantier actif.</div>';
  }
  if (!c.en_cours && !c.preparation && peut('chantier.ecrire')) {
    html += `<div class="info">Pour démarrer : créez un <a href="#/chantiers">chantier</a>, enregistrez votre <a href="#/personnel">personnel</a>, puis saisissez le pointage. Pour les déboursés secs, commencez par les <a href="#/ressources">ressources</a>.</div>`;
  }
  page(html);
  appliquerBarres();
  $$('tr[data-href]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
});

// ============ Chantiers ============
let refChantiers = null;
const chargerChantiers = async () => (refChantiers = await GET('/chantiers'));

function formChantier(ch = {}) {
  const { types, statuts } = refChantiers;
  formulaire({
    titre: ch.id ? `Modifier ${ch.code}` : 'Nouveau chantier',
    champs: [
      { name: 'code', label: 'Code chantier', required: true, value: ch.code },
      { name: 'nom', label: 'Nom', required: true, value: ch.nom },
      { name: 'type_projet', label: 'Type de projet', type: 'select', options: types.map((t) => [t, t]), value: ch.type_projet },
      { name: 'statut', label: 'Statut', type: 'select', vide: false, options: statuts.map((s) => [s, LIB.statut_chantier[s][0]]), value: ch.statut || 'preparation' },
      { name: 'client', label: 'Client / maître d\'ouvrage', value: ch.client },
      { name: 'ville', label: 'Ville', value: ch.ville },
      { name: 'region', label: 'Région', value: ch.region },
      { name: 'adresse', label: 'Adresse', value: ch.adresse },
      { name: 'date_debut', label: 'Date de démarrage', type: 'date', value: ch.date_debut },
      { name: 'date_fin_prevue', label: 'Date contractuelle de fin', type: 'date', value: ch.date_fin_prevue },
      { name: 'montant_marche', label: 'Montant du marché HT (F CFA)', type: 'number', min: 0, value: ch.montant_marche },
      { name: 'budget_initial', label: 'Budget initial (F CFA)', type: 'number', min: 0, value: ch.budget_initial },
    ],
    onSubmit: async (v) => {
      if (ch.id) { await api('PATCH', `/chantiers/${ch.id}`, v); toast('Chantier modifié.'); rafraichir(); }
      else { const r = await POST('/chantiers', v); toast('Chantier créé.'); location.hash = `#/chantiers/${r.id}`; }
    },
  });
}

route(/^\/chantiers$/, async (p) => {
  const d = await GET('/chantiers' + qs({ statut: p.statut, q: p.q }));
  refChantiers = d;
  page(`<div class="topbar"><h1>Chantiers</h1>${peut('chantier.ecrire') ? '<button class="btn vert" id="nouveau">+ Nouveau chantier</button>' : ''}</div>
    <form class="filtres" id="filtres"><label>Recherche<input name="q" value="${esc(p.q || '')}" placeholder="Code, nom, client, ville"></label>
      <label>Statut<select name="statut"><option value="">Tous</option>${d.statuts.map((s) => `<option value="${s}" ${p.statut === s ? 'selected' : ''}>${LIB.statut_chantier[s][0]}</option>`).join('')}</select></label>
      <button class="btn secondaire">Filtrer</button></form>
    ${d.chantiers.length ? `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Nom</th><th>Type</th><th>Client</th><th>Ville</th><th>Fin prévue</th><th class="num">Marché HT</th><th>Statut</th></tr></thead><tbody>
    ${d.chantiers.map((c) => `<tr class="cliquable" data-href="#/chantiers/${c.id}"><td><b>${esc(c.code)}</b></td><td>${esc(c.nom)}</td><td>${esc(c.type_projet || '')}</td><td>${esc(c.client || '')}</td><td>${esc(c.ville || '')}</td>
      <td>${fmtDate(c.date_fin_prevue)}</td><td class="num">${fmtXOF(c.montant_marche)}</td><td>${badge('statut_chantier', c.statut)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucun chantier enregistré.</div>'}`);
  $('#filtres').onsubmit = (e) => { e.preventDefault(); location.hash = '#/chantiers' + qs(Object.fromEntries(new FormData(e.target))); };
  if ($('#nouveau')) $('#nouveau').onclick = () => formChantier();
  $$('tr[data-href]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
});

route(/^\/chantiers\/(\d+)$/, async (_p, id) => {
  const [s] = await Promise.all([GET(`/chantiers/${id}/synthese`), refChantiers ? null : chargerChantiers()]);
  const ch = s.chantier;
  const affectes = peut('personnel.lire') ? await GET(`/chantiers/${id}/ouvriers`) : [];
  let html = `<div class="topbar"><h1>${esc(ch.code)} — ${esc(ch.nom)} ${badge('statut_chantier', ch.statut)}</h1>
    <div class="actions">${peut('pointage.lire') ? `<a class="btn vert" href="#/pointage?chantier=${ch.id}">Pointage</a>` : ''}
    ${peut('chantier.ecrire') ? '<button class="btn secondaire" id="modifier">Modifier</button>' : ''}</div></div>
    <div class="grille-2"><div class="panneau"><h3>Informations</h3><dl class="fiche">
      <dt>Type</dt><dd>${esc(ch.type_projet || '—')}</dd><dt>Client</dt><dd>${esc(ch.client || '—')}</dd>
      <dt>Localisation</dt><dd>${esc([ch.adresse, ch.ville, ch.region].filter(Boolean).join(', ') || '—')}</dd>
      <dt>Démarrage</dt><dd>${fmtDate(ch.date_debut)}</dd><dt>Fin contractuelle</dt><dd>${fmtDate(ch.date_fin_prevue)}</dd>
      <dt>Marché HT</dt><dd>${fmtXOF(ch.montant_marche)}</dd><dt>Budget initial</dt><dd>${fmtXOF(ch.budget_initial)}</dd></dl></div>
    <div class="panneau"><h3>Main-d'œuvre</h3><dl class="fiche">
      <dt>Ouvriers affectés</dt><dd>${s.ouvriers_affectes}</dd><dt>Jours pointés</dt><dd>${s.pointage.jours_pointes}</dd>
      <dt>Heures validées</dt><dd>${fmtNum(s.pointage.heures_validees, 1)} h</dd><dt>Lignes à valider</dt><dd>${s.pointage.lignes_en_attente}</dd>
      ${s.pointage.cout_mo_valide !== undefined ? `<dt>Coût MO validé</dt><dd><b>${fmtXOF(s.pointage.cout_mo_valide)}</b></dd><dt>Coût MO en attente</dt><dd>${fmtXOF(s.pointage.cout_mo_en_attente)}</dd>` : ''}
      ${s.prevision ? `<dt>MO prévue (DS)</dt><dd>${fmtXOF(s.prevision.ds_par_nature.main_oeuvre)} <span class="muted">— étude <a href="#/etudes/${s.prevision.etude_id}">${esc(s.prevision.reference)}</a></span></dd>
        <dt>Consommation</dt><dd>${barre(s.consommation_mo_pct ?? null)}</dd>` : (s.pointage.cout_mo_valide !== undefined ? '<dt>MO prévue</dt><dd class="muted">Aucune étude validée ou acceptée liée à ce chantier.</dd>' : '')}
    </dl></div></div>`;
  if (s.prevision) {
    const n = s.prevision.ds_par_nature;
    html += `<div class="panneau"><h3>Déboursé sec de référence (${esc(s.prevision.reference)})</h3><dl class="fiche">
      ${Object.keys(LIB.nature).map((k) => `<dt>${LIB.nature[k]}</dt><dd>${fmtXOF(n[k])}</dd>`).join('')}
      <dt><b>Déboursé sec total</b></dt><dd><b>${fmtXOF(s.prevision.debourse_sec)}</b></dd><dt>Prix de vente HT</dt><dd>${fmtXOF(s.prevision.total_ht)}</dd></dl></div>`;
  }
  if (peut('personnel.lire')) {
    html += `<div class="topbar"><h2>Personnel affecté (${affectes.length})</h2>${peut('personnel.ecrire') ? '<button class="btn secondaire" id="affecter">Gérer les affectations</button>' : ''}</div>
      ${affectes.length ? `<div class="table-wrap"><table><thead><tr><th>Matricule</th><th>Nom</th><th>Métier</th><th>Statut</th></tr></thead><tbody>
      ${affectes.map((o) => `<tr><td>${esc(o.matricule)}</td><td>${esc(o.nom)} ${esc(o.prenom || '')}</td><td>${esc(o.metier)}</td><td>${o.actif ? '<span class="badge vert">Actif</span>' : '<span class="badge">Inactif</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="panneau vide">Aucun ouvrier affecté. Affectez du personnel pour pouvoir le pointer.</div>'}`;
  }
  page(html);
  appliquerBarres();
  if ($('#modifier')) $('#modifier').onclick = () => formChantier(ch);
  if ($('#affecter')) $('#affecter').onclick = async () => {
    const tous = await GET('/ouvriers?actif=1');
    const ids = new Set(affectes.map((o) => o.id));
    const d = $('#dialog');
    d.innerHTML = `<form><header>Affectations — ${esc(ch.code)}</header><div class="corps"><div class="msg"></div>
      <input id="filtre-aff" placeholder="Filtrer…" class="large"><div class="table-wrap"><table><tbody>
      ${tous.map((o) => `<tr data-txt="${esc((o.nom + ' ' + (o.prenom || '') + ' ' + o.metier + ' ' + o.matricule).toLowerCase())}"><td><input type="checkbox" value="${o.id}" ${ids.has(o.id) ? 'checked' : ''}></td>
        <td>${esc(o.matricule)}</td><td>${esc(o.nom)} ${esc(o.prenom || '')}</td><td>${esc(o.metier)}</td></tr>`).join('') || '<tr><td class="vide">Aucun ouvrier actif. Créez-en dans « Personnel ».</td></tr>'}
      </tbody></table></div></div><footer><button type="button" class="btn secondaire" data-annuler>Annuler</button><button class="btn vert">Enregistrer</button></footer></form>`;
    $('#filtre-aff').oninput = (e) => $$('tr[data-txt]', d).forEach((tr) => { tr.hidden = !tr.dataset.txt.includes(e.target.value.toLowerCase()); });
    $('[data-annuler]', d).onclick = () => d.close();
    $('form', d).onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('PUT', `/chantiers/${ch.id}/ouvriers`, { ouvrier_ids: $$('input[type=checkbox]:checked', d).map((c) => Number(c.value)) });
        d.close(); toast('Affectations enregistrées.'); rafraichir();
      } catch (err) { $('.msg', d).innerHTML = `<div class="erreur">${esc(err.message)}</div>`; }
    };
    d.showModal();
  };
});

// ============ Feuille de pointage (mobile) ============
route(/^\/pointage$/, async (p) => {
  const { chantiers } = await chargerChantiers();
  const actifs = chantiers.filter((c) => ['en_cours', 'preparation', 'suspendu'].includes(c.statut));
  const chId = p.chantier || (actifs[0] && actifs[0].id) || (chantiers[0] && chantiers[0].id);
  const jour = p.date || aujourdhui();
  let html = `<h1>Feuille de pointage</h1>
    <form class="filtres" id="sel"><label>Chantier<select name="chantier">${chantiers.map((c) => `<option value="${c.id}" ${String(c.id) === String(chId) ? 'selected' : ''}>${esc(c.code)} — ${esc(c.nom)}</option>`).join('')}</select></label>
    <label>Date<input type="date" name="date" value="${jour}" max="${aujourdhui()}"></label></form>`;
  if (!chId) { page(html + '<div class="panneau vide">Aucun chantier accessible.</div>'); return; }

  // Feuille du serveur ; sans réseau, copie gardée sur l'appareil ou, à défaut, feuille vierge des ouvriers affectés
  let f; let source = 'serveur';
  try {
    f = await GET(`/chantiers/${chId}/pointage?date=${jour}`);
    if (navigator.onLine) prechargerPourHorsLigne(chantiers);
  } catch (e) {
    if (!e.horsLigne) throw e;
    let affectes;
    try { affectes = await GET(`/chantiers/${chId}/ouvriers`); } catch (e2) {
      if (!e2.horsLigne) throw e2;
      page(html + '<div class="panneau vide">Pas de connexion, et la liste des ouvriers de ce chantier n\'a pas encore été chargée sur cet appareil. Ouvrez une fois la feuille de ce chantier avec du réseau.</div>');
      $('#sel').onchange = (ev) => { location.hash = '#/pointage' + qs(Object.fromEntries(new FormData(ev.currentTarget))); };
      return;
    }
    source = 'appareil';
    f = { chantier: { id: Number(chId) }, date: jour, heures_jour_standard: state.moi.organisation.heures_jour_standard,
      lignes: affectes.filter((o) => o.actif).map((o) => ({ ouvrier_id: o.id, matricule: o.matricule, nom: o.nom, prenom: o.prenom, metier: o.metier, id: null, statut: null, version: null, cout: null })) };
  }
  // Saisies faites sur cet appareil et pas encore envoyées
  const attente = HorsLigne.disponible ? await HorsLigne.enAttentePourFeuille(state.moi.utilisateur.id, Number(chId), jour) : new Map();
  for (const l of f.lignes) {
    const a = attente.get(l.ouvrier_id);
    if (a && l.statut !== 'valide') Object.assign(l, { presence: a.presence, heures_normales: Number(a.heures_normales), heures_sup: Number(a.heures_sup), observation: a.observation, en_attente: a.op_statut });
  }
  const saisir = peut('pointage.saisir');
  const voitCout = peut('cout.lire');
  const lignes = f.lignes;
  html += lignes.length ? `<div class="table-wrap" id="feuille">${lignes.map((l) => {
    const verrou = l.statut === 'valide';
    const presence = l.presence || 'present';
    return `<div class="pointage-ligne ${verrou ? 'verrou' : ''} ${l.statut === 'rejete' ? 'rejet' : ''}" data-ouvrier="${l.ouvrier_id}" data-id="${l.id || ''}" data-presence="${presence}">
      <div><div class="nom">${esc(l.nom)} ${esc(l.prenom || '')}</div><div class="muted">${esc(l.matricule)} · ${esc(l.metier)}
        ${l.en_attente ? ` · <span class="badge ${l.en_attente === 'echec' ? 'rouge' : 'orange'}">${l.en_attente === 'echec' ? 'Envoi refusé' : 'Sur l\'appareil, à envoyer'}</span>` : (l.statut ? ' · ' + badge('statut_pointage', l.statut) : ' · <span class="badge">Non saisi</span>')}
        ${l.saisi_par_nom ? ` · saisi par ${esc(l.saisi_par_nom)}` : ''}${l.valide_par_nom ? ` · ${l.statut === 'rejete' ? 'rejeté' : 'validé'} par ${esc(l.valide_par_nom)}` : ''}
        ${voitCout && l.cout !== null ? ` · <b>${fmtXOF(l.cout)}</b>` : ''}</div>
        ${l.motif_rejet ? `<div class="erreur">Motif du rejet : ${esc(l.motif_rejet)}</div>` : ''}</div>
      <div class="champs">
        <div class="presence-btns">${['present', 'demi_journee', 'absent', 'conge', 'maladie'].map((k) => `<button type="button" data-p="${k}" class="${presence === k ? 'on' : ''} ${['absent', 'conge', 'maladie'].includes(k) ? 'abs' : ''}" ${verrou || !saisir ? 'disabled' : ''}>${LIB.presence[k]}</button>`).join('')}</div>
        <label class="muted">HN <input class="court" type="number" step="0.25" min="0" max="24" name="hn" value="${l.heures_normales ?? (presence === 'demi_journee' ? f.heures_jour_standard / 2 : f.heures_jour_standard)}" ${verrou || !saisir ? 'disabled' : ''}></label>
        <label class="muted">HS <input class="court" type="number" step="0.25" min="0" max="24" name="hs" value="${l.heures_sup ?? 0}" ${verrou || !saisir ? 'disabled' : ''}></label>
        <input name="obs" placeholder="Observation" value="${esc(l.observation || '')}" ${verrou || !saisir ? 'disabled' : ''}>
        ${l.statut === 'saisi' && peut('pointage.valider') ? `<input type="checkbox" class="sel-val" value="${l.id}" checked title="Inclure dans la validation">` : ''}
        ${verrou && ['admin', 'direction'].includes(state.moi.utilisateur.role) ? `<button type="button" class="btn danger petit" data-deverrou="${l.id}">Déverrouiller</button>` : ''}
      </div></div>`;
  }).join('')}</div>
    <div class="barre-fixe"><span class="muted">${lignes.length} ouvrier(s) · HN = heures normales, HS = heures supplémentaires</span><div class="actions">
      ${saisir && lignes.some((l) => l.statut !== 'valide') ? '<button class="btn secondaire" id="tous-presents">Tous présents</button><button class="btn vert" id="enregistrer">Enregistrer le pointage</button>' : ''}
      ${peut('pointage.valider') && lignes.some((l) => l.statut === 'saisi') ? '<button class="btn" id="valider">Valider la sélection</button><button class="btn danger" id="rejeter">Rejeter</button>' : ''}
    </div></div>` : `<div class="panneau vide">Aucun ouvrier affecté à ce chantier. ${peut('personnel.ecrire') ? `<a href="#/chantiers/${chId}">Gérer les affectations</a>` : ''}</div>`;
  if (source === 'appareil') html = html.replace('<div class="table-wrap" id="feuille">', '<div class="info">Hors connexion : feuille préparée à partir des ouvriers affectés. Votre saisie sera gardée sur l\'appareil et envoyée au retour du réseau.</div><div class="table-wrap" id="feuille">');
  page(html);

  $('#sel').onchange = (e) => { location.hash = '#/pointage' + qs(Object.fromEntries(new FormData(e.currentTarget))); };
  $$('.pointage-ligne').forEach((row) => {
    $$('.presence-btns button', row).forEach((b) => {
      b.onclick = () => {
        row.dataset.presence = b.dataset.p;
        $$('.presence-btns button', row).forEach((x) => x.classList.toggle('on', x === b));
        const hn = $('[name=hn]', row), hs = $('[name=hs]', row);
        if (['absent', 'conge', 'maladie'].includes(b.dataset.p)) { hn.value = 0; hs.value = 0; }
        else if (b.dataset.p === 'demi_journee') hn.value = f.heures_jour_standard / 2;
        else if (Number(hn.value) === 0 || Number(hn.value) === f.heures_jour_standard / 2) hn.value = f.heures_jour_standard;
      };
    });
  });
  if ($('#tous-presents')) $('#tous-presents').onclick = () => $$('.pointage-ligne:not(.verrou) [data-p=present]').forEach((b) => b.click());
  if ($('#enregistrer')) $('#enregistrer').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const versions = new Map(f.lignes.map((l) => [l.ouvrier_id, l.version ?? null]));
      const lignesSaisies = $$('.pointage-ligne:not(.verrou)').map((row) => ({
        ouvrier_id: Number(row.dataset.ouvrier), presence: row.dataset.presence,
        heures_normales: $('[name=hn]', row).value, heures_sup: $('[name=hs]', row).value, observation: $('[name=obs]', row).value,
        version: versions.get(Number(row.dataset.ouvrier)) ?? null,
      }));
      if (!lignesSaisies.length) { toast('Toutes les lignes sont déjà validées.'); return; }
      if (!HorsLigne.disponible) {
        const r = await api('PUT', `/chantiers/${chId}/pointage`, { date: jour, lignes: lignesSaisies });
        toast(`${r.enregistrees} ligne(s) enregistrée(s).${r.ignorees.length ? ` ${r.ignorees.length} ignorée(s) (déjà validées).` : ''}${r.conflits.length ? ` ${r.conflits.length} en conflit.` : ''}`, r.conflits.length > 0);
        rafraichir();
        return;
      }
      // Toujours écrit d'abord sur l'appareil, puis envoyé : rien n'est perdu si le réseau coupe
      const ch = chantiers.find((c) => String(c.id) === String(chId));
      await HorsLigne.ajouter({ userId: state.moi.utilisateur.id, chantierId: Number(chId), chantierCode: ch ? ch.code : String(chId), date: jour, lignes: lignesSaisies });
      const b = await synchroniserFile({ silencieux: true });
      if (b.hors_ligne || !navigator.onLine) toast('Pas de réseau : pointage gardé sur l\'appareil. Il sera envoyé automatiquement au retour de la connexion.');
      else if (b.connexion_requise) toast('Pointage gardé sur l\'appareil. Reconnectez-vous pour l\'envoyer.', true);
      else if (b.conflits || b.echecs) toast(`Pointage envoyé avec ${b.conflits + b.echecs} ligne(s) à revoir : voir « Synchronisation ».`, true);
      else if (b.reste) toast('Pointage gardé sur l\'appareil, envoi en attente.', true);
      else toast('Pointage enregistré.');
      rafraichir();
    } catch (err) { toast(err.message, true); } finally { e.target.disabled = false; }
  };
  const ids = () => $$('.sel-val:checked').map((c) => Number(c.value));
  const traiter = async (action, motif) => {
    const r = await POST(`/chantiers/${chId}/pointage/validation`, { date: jour, action, motif, ids: ids() });
    toast(`${r.traitees} ligne(s) ${action === 'valider' ? 'validée(s)' : 'rejetée(s)'}.${r.ignorees.length ? ` ${r.ignorees.length} ignorée(s) : ${r.ignorees[0].raison}` : ''}`, r.ignorees.length > 0 && r.traitees === 0);
    rafraichir();
  };
  if ($('#valider')) $('#valider').onclick = () => traiter('valider').catch((e) => toast(e.message, true));
  if ($('#rejeter')) $('#rejeter').onclick = () => formulaire({ titre: 'Rejeter le pointage sélectionné', valider: 'Rejeter', champs: [{ name: 'motif', label: 'Motif du rejet', type: 'textarea', required: true, large: true }], onSubmit: (v) => traiter('rejeter', v.motif) });
  $$('[data-deverrou]').forEach((b) => {
    b.onclick = () => formulaire({ titre: 'Déverrouiller un pointage validé', valider: 'Déverrouiller', intro: '<div class="info">Le pointage repassera « à valider ». L\'opération est tracée dans le journal.</div>',
      champs: [{ name: 'motif', label: 'Motif', type: 'textarea', required: true, large: true }],
      onSubmit: async (v) => { await POST(`/pointages/${b.dataset.deverrou}/deverrouiller`, v); toast('Pointage déverrouillé.'); rafraichir(); } });
  });
});

// ============ Historique des pointages et coûts ============
route(/^\/pointages$/, async (p) => {
  const { chantiers } = await chargerChantiers();
  const debutMois = aujourdhui().slice(0, 8) + '01';
  const filtres = { du: p.du || debutMois, au: p.au || aujourdhui(), chantier_id: p.chantier_id || '', statut: p.statut || '' };
  const voitCout = peut('cout.lire');
  const groupe = p.groupe || 'chantier';
  const [liste, couts] = await Promise.all([
    GET('/pointages' + qs(filtres)),
    voitCout ? GET('/couts/main-oeuvre' + qs({ ...filtres, statut: '', groupe, inclure_non_valides: p.inclure })) : null,
  ]);
  let html = `<h1>Historique du pointage & coûts de main-d'œuvre</h1>
    <form class="filtres" id="filtres">
      <label>Du<input type="date" name="du" value="${filtres.du}"></label><label>Au<input type="date" name="au" value="${filtres.au}"></label>
      <label>Chantier<select name="chantier_id"><option value="">Tous</option>${chantiers.map((c) => `<option value="${c.id}" ${String(c.id) === String(filtres.chantier_id) ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></label>
      <label>Statut<select name="statut"><option value="">Tous</option>${Object.entries(LIB.statut_pointage).map(([k, v]) => `<option value="${k}" ${filtres.statut === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label>
      ${voitCout ? `<label>Regrouper les coûts par<select name="groupe">${[['chantier', 'Chantier'], ['metier', 'Métier'], ['ouvrier', 'Ouvrier'], ['jour', 'Jour'], ['mois', 'Mois']].map(([k, l]) => `<option value="${k}" ${groupe === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Coûts<select name="inclure"><option value="">Validés uniquement</option><option value="1" ${p.inclure === '1' ? 'selected' : ''}>Validés + à valider</option></select></label>` : ''}
      <button class="btn secondaire">Appliquer</button>
      <a class="btn secondaire" href="/api/pointages/export.csv${qs(filtres)}">Export Excel (CSV)</a>
    </form>`;
  if (couts) {
    html += `<h2>Coûts de main-d'œuvre ${couts.valides_uniquement ? '(pointages validés)' : '(validés et à valider)'}</h2>
      ${couts.lignes.length ? `<div class="table-wrap"><table><thead><tr><th>${esc({ chantier: 'Chantier', metier: 'Métier', ouvrier: 'Ouvrier', jour: 'Jour', mois: 'Mois' }[groupe])}</th><th class="num">Ouvriers</th><th class="num">Heures normales</th><th class="num">Heures sup.</th><th class="num">Coût</th></tr></thead><tbody>
      ${couts.lignes.map((l) => `<tr><td>${esc(groupe === 'jour' ? fmtDate(l.groupe) : l.groupe)}</td><td class="num">${l.ouvriers}</td><td class="num">${fmtNum(l.heures_normales, 2)}</td><td class="num">${fmtNum(l.heures_sup, 2)}</td><td class="num">${fmtXOF(l.cout)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td></td><td class="num">${fmtNum(couts.lignes.reduce((s, l) => s + l.heures_normales, 0))}</td><td class="num">${fmtNum(couts.lignes.reduce((s, l) => s + l.heures_sup, 0))}</td><td class="num">${fmtXOF(couts.total)}</td></tr>
      </tbody></table></div>` : '<div class="panneau vide">Aucun coût sur la période.</div>'}`;
  }
  html += `<h2>Détail (${liste.length} ligne${liste.length > 1 ? 's' : ''})</h2>
    ${liste.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Chantier</th><th>Ouvrier</th><th>Métier</th><th>Présence</th><th class="num">HN</th><th class="num">HS</th>${voitCout ? '<th class="num">Coût</th>' : ''}<th>Statut</th><th>Validé par</th></tr></thead><tbody>
    ${liste.map((l) => `<tr><td>${fmtDate(l.date)}</td><td>${esc(l.chantier_code)}</td><td>${esc(l.nom)} ${esc(l.prenom || '')}</td><td>${esc(l.metier)}</td><td>${esc(LIB.presence[l.presence])}</td>
      <td class="num">${fmtNum(l.heures_normales)}</td><td class="num">${fmtNum(l.heures_sup)}</td>${voitCout ? `<td class="num">${fmtXOF(l.cout)}</td>` : ''}<td>${badge('statut_pointage', l.statut)}</td><td>${esc(l.valide_par_nom || '')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucun pointage sur la période.</div>'}`;
  page(html);
  $('#filtres').onsubmit = (e) => { e.preventDefault(); location.hash = '#/pointages' + qs(Object.fromEntries(new FormData(e.target))); };
});

// ============ Personnel ============
route(/^\/personnel$/, async (p) => {
  const actif = p.actif || '1';
  const liste = await GET('/ouvriers' + qs({ q: p.q, actif: actif === 'tous' ? '' : actif }));
  const voitCout = peut('cout.lire');
  page(`<div class="topbar"><h1>Personnel</h1>${peut('personnel.ecrire') ? '<button class="btn vert" id="nouveau">+ Nouvel ouvrier</button>' : ''}</div>
    <form class="filtres" id="filtres"><label>Recherche<input name="q" value="${esc(p.q || '')}" placeholder="Nom, matricule, métier"></label>
      <label>Statut<select name="actif"><option value="1">Actifs</option><option value="0" ${actif === '0' ? 'selected' : ''}>Inactifs</option><option value="tous" ${actif === 'tous' ? 'selected' : ''}>Tous</option></select></label>
      <button class="btn secondaire">Filtrer</button></form>
    ${liste.length ? `<div class="table-wrap"><table><thead><tr><th>Matricule</th><th>Nom</th><th>Métier</th><th>Catégorie</th><th>Téléphone</th>${voitCout ? '<th class="num">Taux horaire</th>' : ''}<th class="num">Chantiers</th><th>Statut</th>${peut('personnel.ecrire') ? '<th></th>' : ''}</tr></thead><tbody>
    ${liste.map((o) => `<tr><td>${esc(o.matricule)}</td><td>${esc(o.nom)} ${esc(o.prenom || '')}</td><td>${esc(o.metier)}</td><td>${esc(o.categorie || '')}</td><td>${esc(o.telephone || '')}</td>
      ${voitCout ? `<td class="num">${fmtXOF(o.taux_horaire)}</td>` : ''}<td class="num">${o.chantiers.length}</td><td>${o.actif ? '<span class="badge vert">Actif</span>' : '<span class="badge">Inactif</span>'}</td>
      ${peut('personnel.ecrire') ? `<td><button class="btn secondaire petit" data-edit="${o.id}">Modifier</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucun ouvrier.</div>'}`);
  $('#filtres').onsubmit = (e) => { e.preventDefault(); location.hash = '#/personnel' + qs(Object.fromEntries(new FormData(e.target))); };
  const form = (o = {}) => formulaire({
    titre: o.id ? `Modifier ${o.matricule}` : 'Nouvel ouvrier',
    champs: [
      { name: 'matricule', label: 'Matricule', required: true, value: o.matricule },
      { name: 'nom', label: 'Nom', required: true, value: o.nom }, { name: 'prenom', label: 'Prénom', value: o.prenom },
      { name: 'metier', label: 'Métier / spécialité', required: true, value: o.metier },
      { name: 'categorie', label: 'Catégorie', value: o.categorie }, { name: 'telephone', label: 'Téléphone', value: o.telephone },
      { name: 'taux_horaire', label: 'Taux horaire chargé (F CFA/h)', type: 'number', min: 0, required: true, value: o.taux_horaire },
      { name: 'actif', label: 'Statut', type: 'select', vide: false, options: [['1', 'Actif'], ['0', 'Inactif']], value: o.actif === 0 ? '0' : '1' },
    ],
    intro: '<div class="info">Le taux horaire est figé sur chaque pointage au moment de la saisie : le modifier n\'altère pas les coûts déjà enregistrés.</div>',
    onSubmit: async (v) => {
      v.actif = v.actif === '1';
      if (o.id) await api('PATCH', `/ouvriers/${o.id}`, v); else await POST('/ouvriers', v);
      toast('Ouvrier enregistré.'); rafraichir();
    },
  });
  if ($('#nouveau')) $('#nouveau').onclick = () => form();
  $$('[data-edit]').forEach((b) => { b.onclick = () => form(liste.find((o) => o.id === Number(b.dataset.edit))); });
});

// ============ Ressources ============
let refDS = null;
const referentiels = async () => refDS || (refDS = await GET('/debourse/referentiels'));

route(/^\/ressources$/, async (p) => {
  const [ref, liste] = await Promise.all([referentiels(), GET('/ressources' + qs({ type: p.type, q: p.q }))]);
  const ecrire = peut('debourse.ecrire');
  page(`<div class="topbar"><h1>Ressources & prix élémentaires</h1>${ecrire ? '<button class="btn vert" id="nouveau">+ Nouvelle ressource</button>' : ''}</div>
    <p class="muted">Main-d'œuvre (taux horaires chargés), matériaux (prix rendus chantier), matériel (location/heure ou jour), sous-traitance. Ces prix alimentent les sous-détails des ouvrages.</p>
    <form class="filtres" id="filtres"><label>Recherche<input name="q" value="${esc(p.q || '')}"></label>
      <label>Nature<select name="type"><option value="">Toutes</option>${ref.natures.map((n) => `<option value="${n}" ${p.type === n ? 'selected' : ''}>${LIB.nature[n]}</option>`).join('')}</select></label>
      <button class="btn secondaire">Filtrer</button></form>
    ${liste.length ? `<div class="table-wrap"><table><thead><tr><th>Nature</th><th>Code</th><th>Désignation</th><th>Unité</th><th class="num">Prix unitaire HT</th><th class="num">Utilisée dans</th><th>Mise à jour</th>${ecrire ? '<th></th>' : ''}</tr></thead><tbody>
    ${liste.map((r) => `<tr><td>${LIB.nature[r.type]}</td><td>${esc(r.code)}</td><td>${esc(r.designation)}</td><td>${esc(r.unite)}</td><td class="num">${fmtXOF(r.prix_unitaire)}</td>
      <td class="num">${r.utilisations} ouvrage(s)</td><td>${fmtDate(r.updated_at)}</td>
      ${ecrire ? `<td class="actions"><button class="btn secondaire petit" data-edit="${r.id}">Modifier</button>${r.utilisations ? '' : `<button class="btn danger petit" data-suppr="${r.id}">Suppr.</button>`}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucune ressource. Commencez par saisir vos prix élémentaires.</div>'}`);
  $('#filtres').onsubmit = (e) => { e.preventDefault(); location.hash = '#/ressources' + qs(Object.fromEntries(new FormData(e.target))); };
  const form = (r = {}) => formulaire({
    titre: r.id ? `Modifier ${r.code}` : 'Nouvelle ressource',
    champs: [
      { name: 'type', label: 'Nature', type: 'select', required: true, options: ref.natures.map((n) => [n, LIB.nature[n]]), value: r.type || p.type },
      { name: 'code', label: 'Code', required: true, value: r.code },
      { name: 'designation', label: 'Désignation', required: true, value: r.designation, large: true },
      { name: 'unite', label: 'Unité', required: true, value: r.unite, type: 'select', vide: false, options: ref.unites.map((u) => [u, u]) },
      { name: 'prix_unitaire', label: 'Prix unitaire HT (F CFA)', type: 'number', min: 0, required: true, value: r.prix_unitaire },
    ],
    intro: r.id ? '<div class="info">Les études existantes conservent leurs prix jusqu\'à ce que vous cliquiez « Actualiser les prix » sur l\'étude.</div>' : '',
    onSubmit: async (v) => { if (r.id) await api('PATCH', `/ressources/${r.id}`, v); else await POST('/ressources', v); toast('Ressource enregistrée.'); rafraichir(); },
  });
  if ($('#nouveau')) $('#nouveau').onclick = () => form();
  $$('[data-edit]').forEach((b) => { b.onclick = () => form(liste.find((x) => x.id === Number(b.dataset.edit))); });
  $$('[data-suppr]').forEach((b) => { b.onclick = () => confirmer('Supprimer cette ressource ?', async () => { await api('DELETE', `/ressources/${b.dataset.suppr}`); toast('Supprimée.'); rafraichir(); }); });
});

// ============ Ouvrages ============
route(/^\/ouvrages$/, async (p) => {
  const [ref, liste] = await Promise.all([referentiels(), GET('/ouvrages' + qs({ lot: p.lot, q: p.q }))]);
  page(`<div class="topbar"><h1>Bibliothèque d'ouvrages</h1>${peut('debourse.ecrire') ? '<a class="btn vert" href="#/ouvrages/nouveau">+ Nouvel ouvrage</a>' : ''}</div>
    <form class="filtres" id="filtres"><label>Recherche<input name="q" value="${esc(p.q || '')}"></label>
      <label>Lot<select name="lot"><option value="">Tous</option>${ref.lots.map((l) => `<option ${p.lot === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <button class="btn secondaire">Filtrer</button></form>
    ${liste.length ? `<div class="table-wrap"><table><thead><tr><th>Lot</th><th>Code</th><th>Désignation</th><th>Unité</th><th class="num">MO</th><th class="num">Matériaux</th><th class="num">Matériel</th><th class="num">Sous-trait.</th><th class="num">DS unitaire</th></tr></thead><tbody>
    ${liste.map((o) => `<tr class="cliquable" data-href="#/ouvrages/${o.id}"><td>${esc(o.lot)}</td><td>${esc(o.code)}</td><td>${esc(o.designation)}</td><td>${esc(o.unite)}</td>
      <td class="num">${fmtXOF(o.ds.main_oeuvre)}</td><td class="num">${fmtXOF(o.ds.materiau)}</td><td class="num">${fmtXOF(o.ds.materiel)}</td><td class="num">${fmtXOF(o.ds.sous_traitance)}</td><td class="num"><b>${fmtXOF(o.ds.total)}</b></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucun ouvrage. Un ouvrage est défini par son sous-détail de prix : les ressources (main-d\'œuvre, matériaux, matériel) nécessaires pour une quantité donnée.</div>'}`);
  $('#filtres').onsubmit = (e) => { e.preventDefault(); location.hash = '#/ouvrages' + qs(Object.fromEntries(new FormData(e.target))); };
  $$('tr[data-href]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
});

route(/^\/ouvrages\/(nouveau|\d+)$/, async (_p, id) => {
  const [ref, ressources] = await Promise.all([referentiels(), GET('/ressources')]);
  const o = id === 'nouveau' ? { code: '', designation: '', lot: '', unite: 'm³', quantite_base: 1, composants: [] } : await GET(`/ouvrages/${id}`);
  const ecrire = peut('debourse.ecrire');
  const dis = ecrire ? '' : 'disabled';
  const optRes = (sel) => ref.natures.map((n) => `<optgroup label="${LIB.nature[n]}">${ressources.filter((r) => r.type === n).map((r) => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.code)} — ${esc(r.designation)} (${esc(r.unite)})</option>`).join('')}</optgroup>`).join('');
  const ligneComp = (c = {}) => `<tr><td><select name="ressource_id" ${dis}><option value="">— choisir —</option>${optRes(c.ressource_id)}</select></td>
    <td><input class="court" type="number" step="any" min="0" name="quantite" value="${c.quantite ?? ''}" ${dis}></td>
    <td><input class="court" type="number" step="any" min="0" max="100" name="pertes_pct" value="${c.pertes_pct ?? 0}" ${dis}></td>
    <td class="num pu"></td><td class="num mt"></td>${ecrire ? '<td><button type="button" class="btn danger petit" data-retirer>✕</button></td>' : ''}</tr>`;

  page(`<div class="topbar"><h1>${id === 'nouveau' ? 'Nouvel ouvrage' : `${esc(o.code)} — ${esc(o.designation)}`}</h1><a class="btn secondaire" href="#/ouvrages">← Bibliothèque</a></div>
    <div class="msg"></div>
    <form id="f"><div class="panneau form">
      <label><span class="req">Code</span><input name="code" required value="${esc(o.code)}" ${dis}></label>
      <label class="large"><span class="req">Désignation</span><input name="designation" required value="${esc(o.designation)}" ${dis}></label>
      <label><span class="req">Lot</span><select name="lot" required ${dis}><option value="">—</option>${ref.lots.map((l) => `<option ${o.lot === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label><span class="req">Unité</span><select name="unite" ${dis}>${ref.unites.map((u) => `<option ${o.unite === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label><span class="req">Sous-détail établi pour une quantité de</span><input name="quantite_base" type="number" step="any" min="0.000001" value="${o.quantite_base}" ${dis}></label>
    </div>
    <h2>Sous-détail de prix</h2>
    ${ressources.length ? '' : '<div class="info">Aucune ressource : créez d\'abord vos <a href="#/ressources">ressources et prix élémentaires</a>.</div>'}
    <div class="table-wrap"><table><thead><tr><th>Ressource</th><th>Quantité</th><th>Pertes %</th><th class="num">PU</th><th class="num">Montant</th>${ecrire ? '<th></th>' : ''}</tr></thead>
      <tbody id="comps">${o.composants.map(ligneComp).join('')}</tbody></table></div>
    ${ecrire ? '<p><button type="button" class="btn secondaire" id="ajouter">+ Ajouter une ressource</button></p>' : ''}
    <div class="panneau"><h3>Déboursé sec unitaire (par <span id="u-lib">${esc(o.unite)}</span>)</h3><dl class="fiche" id="totaux"></dl>
      <p class="muted">DS unitaire = Σ (quantité × (1 + pertes %) × prix unitaire) ÷ quantité de base.</p></div>
    ${ecrire ? `<div class="actions"><button class="btn vert">Enregistrer l'ouvrage</button>${id !== 'nouveau' ? '<button type="button" class="btn danger" id="supprimer">Supprimer</button>' : ''}</div>` : ''}
    </form>`);

  const recalc = () => {
    const qb = Number($('#f [name=quantite_base]').value) || 1;
    const tot = { main_oeuvre: 0, materiau: 0, materiel: 0, sous_traitance: 0 };
    $$('#comps tr').forEach((tr) => {
      const r = ressources.find((x) => x.id === Number($('[name=ressource_id]', tr).value));
      const q = Number($('[name=quantite]', tr).value) || 0;
      const pe = Number($('[name=pertes_pct]', tr).value) || 0;
      const m = r ? q * (1 + pe / 100) * r.prix_unitaire : 0;
      $('.pu', tr).textContent = r ? fmtXOF(r.prix_unitaire) + '/' + r.unite : '';
      $('.mt', tr).textContent = r ? fmtXOF(m) : '';
      if (r) tot[r.type] += m / qb;
    });
    const total = Object.values(tot).reduce((s, x) => s + x, 0);
    $('#totaux').innerHTML = Object.keys(tot).map((k) => `<dt>${LIB.nature[k]}</dt><dd>${fmtXOF(tot[k])}</dd>`).join('') + `<dt><b>Total DS</b></dt><dd><b>${fmtXOF(total)}</b></dd>`;
    $('#u-lib').textContent = $('#f [name=unite]').value;
  };
  const brancher = () => $$('#comps [data-retirer]').forEach((b) => { b.onclick = () => { b.closest('tr').remove(); recalc(); }; });
  $('#f').oninput = recalc; $('#f').onchange = recalc;
  brancher(); recalc();
  if ($('#ajouter')) $('#ajouter').onclick = () => { $('#comps').insertAdjacentHTML('beforeend', ligneComp()); brancher(); recalc(); };
  if ($('#supprimer')) $('#supprimer').onclick = () => confirmer('Supprimer cet ouvrage ? Les études qui l\'utilisent conservent leurs prix.', async () => { await api('DELETE', `/ouvrages/${id}`); toast('Ouvrage supprimé.'); location.hash = '#/ouvrages'; });
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    if (!ecrire) return;
    const fd = new FormData(e.target);
    const body = {
      code: fd.get('code'), designation: fd.get('designation'), lot: fd.get('lot'), unite: fd.get('unite'), quantite_base: Number(fd.get('quantite_base')),
      composants: $$('#comps tr').map((tr) => ({ ressource_id: $('[name=ressource_id]', tr).value, quantite: $('[name=quantite]', tr).value, pertes_pct: $('[name=pertes_pct]', tr).value })).filter((c) => c.ressource_id),
    };
    try {
      const r = id === 'nouveau' ? await POST('/ouvrages', body) : await api('PUT', `/ouvrages/${id}`, body);
      toast('Ouvrage enregistré.');
      if (id === 'nouveau') location.hash = `#/ouvrages/${r.id}`; else rafraichir();
    } catch (err) { $('.msg').innerHTML = `<div class="erreur">${esc(err.message)}</div>`; window.scrollTo(0, 0); }
  };
});

// ============ Études de prix ============
function formEtude(e = {}, chantiers) {
  formulaire({
    titre: e.id ? `Paramètres de l'étude ${e.reference}` : 'Nouvelle étude de prix',
    champs: [
      { name: 'reference', label: 'Référence', required: true, value: e.reference },
      { name: 'objet', label: 'Objet', required: true, value: e.objet, large: true },
      { name: 'client', label: 'Client', value: e.client },
      { name: 'chantier_id', label: 'Chantier lié', type: 'select', options: chantiers.map((c) => [c.id, `${c.code} — ${c.nom}`]), value: e.chantier_id },
      { name: 'frais_chantier_pct', label: 'Frais de chantier (% du DS)', type: 'number', min: 0, value: e.frais_chantier_pct ?? 0 },
      { name: 'frais_generaux_pct', label: 'Frais généraux (%)', type: 'number', min: 0, value: e.frais_generaux_pct ?? 0 },
      { name: 'aleas_pct', label: 'Aléas et imprévus (%)', type: 'number', min: 0, value: e.aleas_pct ?? 0 },
      { name: 'benefice_pct', label: 'Bénéfice (%)', type: 'number', min: 0, value: e.benefice_pct ?? 0 },
      { name: 'tva_pct', label: 'TVA (%)', type: 'number', min: 0, value: e.tva_pct ?? state.moi.organisation.tva_pct },
    ],
    intro: '<div class="info">Prix de vente HT = Déboursé sec × K, avec K = (1 + frais de chantier) × (1 + frais généraux) × (1 + aléas) × (1 + bénéfice).</div>',
    onSubmit: async (v) => {
      if (e.id) { await api('PATCH', `/etudes/${e.id}`, v); toast('Étude modifiée.'); rafraichir(); }
      else { const r = await POST('/etudes', v); location.hash = `#/etudes/${r.id}`; }
    },
  });
}

route(/^\/etudes$/, async () => {
  const [liste, { chantiers }] = await Promise.all([GET('/etudes'), chargerChantiers()]);
  page(`<div class="topbar"><h1>Études de prix (déboursés secs)</h1>${peut('debourse.ecrire') ? '<button class="btn vert" id="nouveau">+ Nouvelle étude</button>' : ''}</div>
    ${liste.length ? `<div class="table-wrap"><table><thead><tr><th>Référence</th><th>Objet</th><th>Chantier</th><th class="num">Lignes</th><th class="num">Déboursé sec</th><th class="num">K</th><th class="num">Total HT</th><th class="num">Total TTC</th><th>Statut</th></tr></thead><tbody>
    ${liste.map((e) => `<tr class="cliquable" data-href="#/etudes/${e.id}"><td><b>${esc(e.reference)}</b></td><td>${esc(e.objet)}</td><td>${esc(e.chantier_code || '—')}</td><td class="num">${e.nb_lignes}</td>
      <td class="num">${fmtXOF(e.debourse_sec)}</td><td class="num">${fmtNum(e.coefficient_k, 4)}</td><td class="num">${fmtXOF(e.total_ht)}</td><td class="num">${fmtXOF(e.total_ttc)}</td><td>${badge('statut_etude', e.statut)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucune étude de prix.</div>'}`);
  if ($('#nouveau')) $('#nouveau').onclick = () => formEtude({}, chantiers);
  $$('tr[data-href]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
});

route(/^\/etudes\/(\d+)$/, async (_p, id) => {
  const [e, { chantiers }] = await Promise.all([GET(`/etudes/${id}`), chargerChantiers()]);
  const c = e.calcul;
  const modifiable = e.statut === 'brouillon' && peut('debourse.ecrire');
  const valider = peut('etude.valider');
  const lots = [...new Set(c.lignes.map((l) => l.lot || 'Divers'))];
  let corps = '';
  for (const lot of lots) {
    const ls = c.lignes.filter((l) => (l.lot || 'Divers') === lot);
    corps += `<tr><td colspan="${modifiable ? 11 : 10}"><b>${esc(lot)}</b></td></tr>` + ls.map((l) => `<tr>
      <td>${esc(l.designation)}${l.ouvrage_id ? '' : ' <span class="badge">saisie libre</span>'}</td><td>${esc(l.unite)}</td>
      <td class="num">${modifiable ? `<input class="court" type="number" step="any" min="0" value="${l.quantite}" data-qte="${l.id}">` : fmtNum(l.quantite, 3)}</td>
      <td class="num">${fmtXOF(l.ds_main_oeuvre)}</td><td class="num">${fmtXOF(l.ds_materiau)}</td><td class="num">${fmtXOF(l.ds_materiel)}</td><td class="num">${fmtXOF(l.ds_sous_traitance)}</td>
      <td class="num"><b>${fmtXOF(l.ds_unitaire)}</b></td><td class="num">${fmtXOF(l.pu_vente)}</td><td class="num">${fmtXOF(l.montant_ht)}</td>
      ${modifiable ? `<td><button class="btn danger petit" data-suppr="${l.id}">✕</button></td>` : ''}</tr>`).join('');
  }
  const ligne = (lib, v, cls = '') => `<tr class="${cls}"><td>${lib}</td><td class="num">${v}</td></tr>`;
  page(`<div class="topbar"><h1>Étude ${esc(e.reference)} ${badge('statut_etude', e.statut)}</h1>
    <div class="actions no-print">
      ${modifiable ? '<button class="btn secondaire" id="params">Paramètres</button><button class="btn secondaire" id="actualiser">Actualiser les prix</button>' : ''}
      ${peut('debourse.ecrire') ? '<button class="btn secondaire" id="dupliquer">Dupliquer (variante)</button>' : ''}
      <a class="btn secondaire" href="/api/etudes/${e.id}/export.csv">Export Excel (CSV)</a>
      <button class="btn secondaire" id="imprimer">Imprimer / PDF</button>
      ${valider && e.statut === 'brouillon' ? '<button class="btn" id="st-valide">Valider</button>' : ''}
      ${valider && e.statut === 'valide' ? '<button class="btn vert" id="st-accepte">Marquer acceptée</button><button class="btn danger" id="st-refuse">Refusée</button>' : ''}
      ${peut('debourse.ecrire') && e.statut !== 'brouillon' && (valider || e.statut === 'brouillon') ? '<button class="btn secondaire" id="st-brouillon">Repasser en brouillon</button>' : ''}
      ${modifiable ? '<button class="btn danger" id="supprimer">Supprimer</button>' : ''}
    </div></div>
    <div class="panneau"><dl class="fiche"><dt>Objet</dt><dd>${esc(e.objet)}</dd><dt>Client</dt><dd>${esc(e.client || '—')}</dd>
      <dt>Chantier</dt><dd>${e.chantier_id ? `<a href="#/chantiers/${e.chantier_id}">${esc((chantiers.find((x) => x.id === e.chantier_id) || {}).code || 'Voir')}</a>` : '—'}</dd>
      <dt>Rédigée par</dt><dd>${esc(e.cree_par_nom || '—')} le ${fmtDate(e.created_at)}</dd>${e.valide_par_nom ? `<dt>Validée par</dt><dd>${esc(e.valide_par_nom)}</dd>` : ''}
      <dt>Coefficient K</dt><dd><b>${fmtNum(c.coefficient_k, 4)}</b> <span class="muted">(FC ${e.frais_chantier_pct} % · FG ${e.frais_generaux_pct} % · aléas ${e.aleas_pct} % · bénéfice ${e.benefice_pct} %)</span></dd></dl></div>
    ${e.statut !== 'brouillon' ? '<div class="info no-print">Étude verrouillée. Pour la modifier, repassez-la en brouillon ou dupliquez-la.</div>' : ''}
    <h2>Détail quantitatif et estimatif</h2>
    <div class="table-wrap"><table><thead><tr><th>Désignation</th><th>U</th><th class="num">Qté</th><th class="num">DS MO</th><th class="num">DS Mat.</th><th class="num">DS Matériel</th><th class="num">DS S-T</th><th class="num">DS unit.</th><th class="num">PU vente HT</th><th class="num">Montant HT</th>${modifiable ? '<th></th>' : ''}</tr></thead>
    <tbody>${corps || `<tr><td colspan="11" class="vide">Aucune ligne.</td></tr>`}</tbody></table></div>
    ${modifiable ? '<p class="actions no-print"><button class="btn vert" id="aj-ouvrage">+ Ouvrage de la bibliothèque</button><button class="btn secondaire" id="aj-libre">+ Ligne libre</button></p>' : ''}
    <div class="grille-2"><div class="panneau"><h3>Déboursé sec par nature</h3><div class="table-wrap"><table><tbody>
      ${Object.keys(LIB.nature).map((k) => ligne(LIB.nature[k], `${fmtXOF(c.ds_par_nature[k])} <span class="muted">(${c.debourse_sec ? fmtNum(c.ds_par_nature[k] / c.debourse_sec * 100, 1) : 0} %)</span>`)).join('')}
      ${ligne('Déboursé sec total', fmtXOF(c.debourse_sec), 'total')}</tbody></table></div></div>
    <div class="panneau"><h3>Du déboursé sec au prix de vente</h3><div class="table-wrap"><table><tbody>
      ${ligne('Déboursé sec', fmtXOF(c.debourse_sec))}${ligne(`+ Frais de chantier (${e.frais_chantier_pct} %)`, fmtXOF(c.frais_chantier))}
      ${ligne(`+ Frais généraux (${e.frais_generaux_pct} %)`, fmtXOF(c.frais_generaux))}${ligne(`+ Aléas (${e.aleas_pct} %)`, fmtXOF(c.aleas))}
      ${ligne(`+ Bénéfice (${e.benefice_pct} %)`, fmtXOF(c.benefice))}
      ${ligne('Total HT (somme des lignes, PU arrondis)', fmtXOF(c.total_ht), 'total')}
      ${c.ecart_arrondis ? ligne('<span class="muted">dont écart d\'arrondi des PU</span>', `<span class="muted">${fmtXOF(c.ecart_arrondis)}</span>`) : ''}
      ${ligne(`TVA (${e.tva_pct} %)`, fmtXOF(c.tva))}${ligne('Total TTC', fmtXOF(c.total_ttc), 'total')}
    </tbody></table></div></div></div>`);

  const go = (sel, fn) => { const el = $(sel); if (el) el.onclick = () => fn().catch((err) => toast(err.message, true)); };
  $('#imprimer').onclick = () => window.print();
  if ($('#params')) $('#params').onclick = () => formEtude(e, chantiers);
  go('#actualiser', async () => { const r = await POST(`/etudes/${id}/actualiser`); toast(`${r.lignes_actualisees} ligne(s) actualisée(s) aux prix de la bibliothèque.`); rafraichir(); });
  for (const st of ['valide', 'accepte', 'refuse', 'brouillon']) go(`#st-${st}`, async () => { await POST(`/etudes/${id}/statut`, { statut: st }); toast('Statut mis à jour.'); rafraichir(); });
  if ($('#dupliquer')) $('#dupliquer').onclick = () => formulaire({ titre: 'Dupliquer l\'étude', champs: [{ name: 'reference', label: 'Nouvelle référence', required: true, value: e.reference + '-V2' }],
    onSubmit: async (v) => { const r = await POST(`/etudes/${id}/dupliquer`, v); toast('Étude dupliquée.'); location.hash = `#/etudes/${r.id}`; } });
  if ($('#supprimer')) $('#supprimer').onclick = () => confirmer('Supprimer définitivement cette étude ?', async () => { await api('DELETE', `/etudes/${id}`); location.hash = '#/etudes'; });
  $$('[data-suppr]').forEach((b) => { b.onclick = () => api('DELETE', `/etudes/${id}/lignes/${b.dataset.suppr}`).then(rafraichir).catch((err) => toast(err.message, true)); });
  $$('[data-qte]').forEach((inp) => { inp.onchange = () => api('PATCH', `/etudes/${id}/lignes/${inp.dataset.qte}`, { quantite: inp.value }).then(rafraichir).catch((err) => toast(err.message, true)); });
  if ($('#aj-ouvrage')) $('#aj-ouvrage').onclick = async () => {
    const ouvrages = await GET('/ouvrages');
    if (!ouvrages.length) { toast('La bibliothèque d\'ouvrages est vide.', true); return; }
    formulaire({ titre: 'Ajouter un ouvrage', champs: [
      { name: 'ouvrage_id', label: 'Ouvrage', type: 'select', required: true, large: true, options: ouvrages.map((o) => [o.id, `${o.lot} · ${o.code} — ${o.designation} (${fmtXOF(o.ds.total)}/${o.unite})`]) },
      { name: 'quantite', label: 'Quantité', type: 'number', min: 0, required: true }],
    onSubmit: async (v) => { await POST(`/etudes/${id}/lignes`, v); rafraichir(); } });
  };
  if ($('#aj-libre')) $('#aj-libre').onclick = async () => {
    const ref = await referentiels();
    formulaire({ titre: 'Ligne libre', champs: [
      { name: 'lot', label: 'Lot', type: 'select', options: ref.lots.map((l) => [l, l]) },
      { name: 'designation', label: 'Désignation', required: true, large: true },
      { name: 'unite', label: 'Unité', type: 'select', vide: false, options: ref.unites.map((u) => [u, u]) },
      { name: 'quantite', label: 'Quantité', type: 'number', min: 0, required: true },
      { name: 'ds_main_oeuvre', label: 'DS unitaire main-d\'œuvre', type: 'number', min: 0 },
      { name: 'ds_materiau', label: 'DS unitaire matériaux', type: 'number', min: 0 },
      { name: 'ds_materiel', label: 'DS unitaire matériel', type: 'number', min: 0 },
      { name: 'ds_sous_traitance', label: 'DS unitaire sous-traitance', type: 'number', min: 0 }],
    onSubmit: async (v) => { await POST(`/etudes/${id}/lignes`, v); rafraichir(); } });
  };
});

// ============ Administration ============
route(/^\/admin$/, async () => {
  const [users, { chantiers }] = await Promise.all([GET('/utilisateurs'), chargerChantiers()]);
  const org = state.moi.organisation;
  page(`<h1>Utilisateurs & paramètres</h1>
    <div class="topbar"><h2>Utilisateurs</h2><button class="btn vert" id="nouveau">+ Nouvel utilisateur</button></div>
    <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Chantiers autorisés</th><th>Statut</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr><td>${esc(u.nom)}</td><td>${esc(u.email)}</td><td>${esc(LIB.role[u.role])}</td>
      <td>${['conducteur', 'chef_chantier'].includes(u.role) ? (u.chantiers.map((id) => esc((chantiers.find((c) => c.id === id) || {}).code || '')).join(', ') || '<span class="badge orange">Aucun</span>') : '<span class="muted">Tous</span>'}</td>
      <td>${u.actif ? '<span class="badge vert">Actif</span>' : '<span class="badge">Désactivé</span>'}</td><td><button class="btn secondaire petit" data-edit="${u.id}">Modifier</button></td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">Les conducteurs de travaux et chefs de chantier n'accèdent qu'aux chantiers cochés. Les autres rôles voient tous les chantiers de l'entreprise.</p>
    <h2>Paramètres de l'entreprise</h2>
    <div class="panneau"><dl class="fiche"><dt>Raison sociale</dt><dd>${esc(org.nom)}</dd><dt>Devise</dt><dd>${esc(org.devise)} (franc CFA)</dd><dt>Fuseau horaire</dt><dd>${esc(org.fuseau)}</dd>
      <dt>Journée standard</dt><dd>${fmtNum(org.heures_jour_standard)} h</dd><dt>Majoration heures sup.</dt><dd>${fmtNum(org.majoration_hs_pct)} %</dd><dt>TVA par défaut</dt><dd>${fmtNum(org.tva_pct)} %</dd></dl>
      <p><button class="btn secondaire" id="params">Modifier les paramètres</button></p>
      <h3>Logo</h3><div class="actions"><img class="apercu-logo" src="${logoEntreprise()}" alt="Logo actuel">
        <label class="btn secondaire">Importer un logo<input type="file" id="logo-fichier" accept="image/png,image/jpeg,image/webp" hidden></label>
        ${org.a_logo ? '<button class="btn danger petit" id="logo-suppr">Retirer</button>' : ''}</div>
      <p class="muted">PNG, JPEG ou WebP, 300 Ko maximum. Le logo apparaît dans le menu de tous les utilisateurs de votre entreprise.</p>
      <p class="muted">La majoration est appliquée aux heures supplémentaires saisies et figée sur chaque pointage. Vérifiez les taux applicables (Code du travail et conventions collectives du BTP au Sénégal) avant usage pour la paie.</p></div>`);
  const roles = Object.entries(LIB.role);
  const form = (u = {}) => {
    formulaire({
      titre: u.id ? `Modifier ${u.nom}` : 'Nouvel utilisateur',
      champs: [
        { name: 'nom', label: 'Nom', required: true, value: u.nom },
        ...(u.id ? [] : [{ name: 'email', label: 'Email', type: 'email', required: true }]),
        { name: 'role', label: 'Rôle', type: 'select', vide: false, options: roles, value: u.role || 'chef_chantier' },
        ...(u.id ? [{ name: 'actif', label: 'Statut', type: 'select', vide: false, options: [['1', 'Actif'], ['0', 'Désactivé']], value: u.actif === 0 ? '0' : '1' }] : []),
        { name: 'mot_de_passe', label: u.id ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe initial', type: 'password', required: !u.id, autocomplete: 'new-password' },
      ],
      intro: chantiers.length ? `<p class="muted">Chantiers autorisés (conducteurs et chefs de chantier) :</p><div class="form">${chantiers.map((c) => `<label><span><input type="checkbox" name="ch" value="${c.id}" ${(u.chantiers || []).includes(c.id) ? 'checked' : ''}> ${esc(c.code)} — ${esc(c.nom)}</span></label>`).join('')}</div><hr>` : '',
      onSubmit: async (v) => {
        const ch = $$('#dialog input[name=ch]:checked').map((x) => Number(x.value));
        if (u.id) {
          const body = { nom: v.nom, role: v.role, actif: v.actif === '1', chantiers: ch };
          if (v.mot_de_passe) body.mot_de_passe = v.mot_de_passe;
          await api('PATCH', `/utilisateurs/${u.id}`, body);
        } else {
          const r = await POST('/utilisateurs', v);
          if (ch.length) await api('PATCH', `/utilisateurs/${r.id}`, { chantiers: ch });
        }
        toast('Utilisateur enregistré.'); rafraichir();
      },
    });
  };
  $('#nouveau').onclick = () => form();
  $$('[data-edit]').forEach((b) => { b.onclick = () => form(users.find((u) => u.id === Number(b.dataset.edit))); });
  const rechargerMoi = async () => { state.moi = await GET('/auth/moi'); rafraichir(); };
  $('#logo-fichier').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 300 * 1024) { toast('Le logo ne doit pas dépasser 300 Ko.', true); return; }
    const lecteur = new FileReader();
    lecteur.onload = () => api('PUT', '/organisation/logo', { image: lecteur.result })
      .then(() => { toast('Logo enregistré.'); return rechargerMoi(); }).catch((err) => toast(err.message, true));
    lecteur.readAsDataURL(f);
  };
  if ($('#logo-suppr')) $('#logo-suppr').onclick = () => api('DELETE', '/organisation/logo').then(rechargerMoi).catch((err) => toast(err.message, true));
  $('#params').onclick = () => formulaire({ titre: 'Paramètres', champs: [
    { name: 'nom', label: 'Raison sociale', required: true, value: org.nom },
    { name: 'heures_jour_standard', label: 'Heures par journée standard', type: 'number', min: 1, value: org.heures_jour_standard },
    { name: 'majoration_hs_pct', label: 'Majoration heures sup. (%)', type: 'number', min: 0, value: org.majoration_hs_pct },
    { name: 'tva_pct', label: 'TVA par défaut (%)', type: 'number', min: 0, value: org.tva_pct }],
  onSubmit: async (v) => { await api('PATCH', '/organisation', v); state.moi = await GET('/auth/moi'); toast('Paramètres enregistrés.'); rafraichir(); } });
});

route(/^\/journal$/, async () => {
  const j = await GET('/journal');
  page(`<h1>Journal d'activité</h1><p class="muted">300 dernières opérations sensibles (connexions, créations, modifications, validations).</p>
    ${j.length ? `<div class="table-wrap"><table><thead><tr><th>Date (UTC = heure de Dakar)</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détails</th></tr></thead><tbody>
    ${j.map((a) => `<tr><td>${esc(a.created_at)}</td><td>${esc(a.utilisateur || '')}</td><td>${esc(a.action)}</td><td>${esc(a.entite)} #${esc(a.entite_id ?? '')}</td><td class="muted">${esc((a.details || '').slice(0, 160))}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panneau vide">Aucune opération.</div>'}`);
});

setInterval(() => { if (state.moi) GET('/auth/moi').then((m) => { state.moi = m; }).catch(() => {}); }, 5 * 60 * 1000);
GET('/config').then((c) => { state.config = c; document.title = c.nom_produit; }).catch(() => {}).finally(router);
