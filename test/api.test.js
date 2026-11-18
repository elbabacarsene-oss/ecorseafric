'use strict';
// Tests d'intégration sur un vrai PostgreSQL (base effacée au démarrage).
// Base utilisée : DATABASE_URL_TEST, par défaut postgres://btp:btp@localhost:5432/btp_test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApp } = require('../src/server');
const { aujourdhuiDakar } = require('../src/util');
const { boiteDeTest } = require('../src/email');

const DB_URL = process.env.DATABASE_URL_TEST || 'postgres://btp:btp@localhost:5432/btp_test';
const WEBHOOK_SECRET = 'secret-webhook-test';
const PRIX = 15000;

// ---------- Faux serveur Wave ----------
const fauxWave = { sessions: new Map(), n: 0 };
const serveurWave = http.createServer((req, res) => {
  let corps = '';
  req.on('data', (c) => { corps += c; });
  req.on('end', () => {
    const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer cle-wave-test') return json(401, { code: 'unauthorized' });
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const b = JSON.parse(corps);
      const s = { id: `cos-${++fauxWave.n}`, amount: b.amount, currency: b.currency, client_reference: b.client_reference,
        success_url: b.success_url, error_url: b.error_url, checkout_status: 'open', payment_status: 'processing',
        wave_launch_url: `https://pay.wave.com/c/cos-${fauxWave.n}` };
      fauxWave.sessions.set(s.id, s);
      fauxWave.derniere = s;
      return json(200, s);
    }
    const m = req.url.match(/^\/v1\/checkout\/sessions\/(.+)$/);
    if (req.method === 'GET' && m && fauxWave.sessions.has(m[1])) return json(200, fauxWave.sessions.get(m[1]));
    json(404, { code: 'not-found' });
  });
});
const payer = (s) => Object.assign(s, { checkout_status: 'complete', payment_status: 'succeeded', transaction_id: 'TCN' + s.id });
const signer = (corps, secret = WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(t + corps).digest('hex')}`;

let server, base, db;
test.before(async () => {
  await new Promise((r) => serveurWave.listen(0, r));
  const app = await createApp({
    databaseUrl: DB_URL, reinitialiserBase: true, appUrl: 'http://app.test', prixMensuel: PRIX, essaiHeures: 24,
    wave: { apiKey: 'cle-wave-test', apiUrl: `http://127.0.0.1:${serveurWave.address().port}`, webhookSecret: WEBHOOK_SECRET },
    email: { brevoApiKey: null },
  });
  db = app.db;
  await new Promise((r) => { server = app.app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(async () => { server.close(); serveurWave.close(); await db.close(); });

// Petit client HTTP qui conserve le cookie de session
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u, {}) };
}

const MDP = 'MotDePasse2026';
const jour = aujourdhuiDakar();
const ctx = {};
const jetonDans = (email, chemin) => {
  const m = [...boiteDeTest].reverse().find((x) => x.a === email && x.texte.includes(chemin));
  assert.ok(m, `aucun e-mail ${chemin} pour ${email}`);
  return m.texte.match(new RegExp(`${chemin}\\?jeton=([A-Za-z0-9_-]+)`))[1];
};
// Inscription + confirmation de l'e-mail
async function inscrire(c, entreprise, email) {
  assert.equal((await c.post('/auth/inscription', { entreprise, nom: 'Admin ' + entreprise, email, mot_de_passe: MDP })).status, 201);
  assert.equal((await c.post('/auth/confirmer-email', { jeton: jetonDans(email, '/confirmer') })).status, 200);
}

test('inscription : e-mail à confirmer, puis essai de 24 h', async () => {
  const admin = client();
  let r = await admin.post('/auth/inscription', { entreprise: 'ECORSE AFRIC', nom: 'Admin EA', email: 'Admin@EA.sn', mot_de_passe: MDP });
  assert.equal(r.status, 201);
  r = await admin.get('/auth/moi');
  assert.equal(r.body.utilisateur.email_verifie, false);
  assert.equal(r.body.acces.statut, 'non_demarre');
  // Tant que l'adresse n'est pas confirmée, l'espace est inaccessible
  r = await admin.get('/chantiers');
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'email_non_verifie');

  const jeton = jetonDans('admin@ea.sn', '/confirmer');
  assert.equal((await client().post('/auth/confirmer-email', { jeton: 'faux' })).status, 400);
  assert.equal((await client().post('/auth/confirmer-email', { jeton })).status, 200); // depuis un autre appareil
  assert.equal((await client().post('/auth/confirmer-email', { jeton })).status, 400); // usage unique
  r = await admin.get('/auth/moi');
  assert.equal(r.body.utilisateur.email_verifie, true);
  assert.equal(r.body.acces.statut, 'essai');
  const heures = (Date.parse(r.body.acces.fin) - Date.now()) / 3600000;
  assert.ok(heures > 23.9 && heures <= 24, `essai de ${heures} h`);
  assert.equal(r.body.organisation.devise, 'XOF');

  // Email insensible à la casse, mauvais mot de passe, mot de passe faible
  assert.equal((await client().post('/auth/connexion', { email: 'ADMIN@ea.sn', mot_de_passe: MDP })).status, 200);
  assert.equal((await client().post('/auth/connexion', { email: 'admin@ea.sn', mot_de_passe: 'mauvais' })).status, 401);
  assert.equal((await client().post('/auth/inscription', { entreprise: 'X', nom: 'Y', email: 'a@b.sn', mot_de_passe: 'court' })).status, 400);
  assert.equal((await client().get('/chantiers')).status, 401);
  ctx.admin = admin;
});

test('mot de passe oublié', async () => {
  const anonyme = client();
  // Même réponse pour une adresse inconnue (on ne révèle pas les comptes existants)
  assert.equal((await anonyme.post('/auth/mot-de-passe-oublie', { email: 'inconnu@nulle-part.sn' })).status, 200);
  assert.equal((await anonyme.post('/auth/mot-de-passe-oublie', { email: 'admin@ea.sn' })).status, 200);
  const jeton = jetonDans('admin@ea.sn', '/reinitialiser');
  assert.equal((await anonyme.post('/auth/reinitialiser', { jeton, mot_de_passe: 'court' })).status, 400);
  assert.equal((await anonyme.post('/auth/reinitialiser', { jeton, mot_de_passe: 'NouveauMdp2026' })).status, 200);
  assert.equal((await anonyme.post('/auth/reinitialiser', { jeton, mot_de_passe: 'EncoreUn2026x' })).status, 400, 'jeton à usage unique');
  // Les sessions ouvertes sont fermées après réinitialisation
  assert.equal((await ctx.admin.get('/auth/moi')).status, 401);
  assert.equal((await anonyme.post('/auth/connexion', { email: 'admin@ea.sn', mot_de_passe: MDP })).status, 401);
  assert.equal((await ctx.admin.post('/auth/connexion', { email: 'admin@ea.sn', mot_de_passe: 'NouveauMdp2026' })).status, 200);
  // Remise du mot de passe d'origine pour la suite
  assert.equal((await ctx.admin.post('/auth/mot-de-passe', { actuel: 'NouveauMdp2026', nouveau: MDP })).status, 200);
});

test('création des utilisateurs, chantiers et ouvriers', async () => {
  const { admin } = ctx;
  for (const [nom, role] of [['Chef', 'chef_chantier'], ['Conducteur', 'conducteur'], ['Metreur', 'metreur'], ['Directeur', 'direction']]) {
    const r = await admin.post('/utilisateurs', { nom, email: `${role}@ea.sn`, role, mot_de_passe: MDP });
    assert.equal(r.status, 201);
    ctx[role + '_id'] = r.body.id;
  }
  let r = await admin.post('/chantiers', { code: 'CH-001', nom: 'Immeuble R+4 Mermoz', type_projet: 'Immeuble', ville: 'Dakar', statut: 'en_cours', montant_marche: 250000000, date_debut: '2026-01-15' });
  assert.equal(r.status, 201); ctx.ch1 = r.body.id;
  assert.equal((await admin.get(`/chantiers/${ctx.ch1}`)).body.date_debut, '2026-01-15');
  r = await admin.post('/chantiers', { code: 'CH-002', nom: 'Route Thiès', type_projet: 'Route', statut: 'en_cours' });
  ctx.ch2 = r.body.id;
  assert.equal((await admin.post('/chantiers', { code: 'CH-001', nom: 'doublon' })).status, 409);
  assert.equal((await admin.post('/chantiers', { code: 'X', nom: 'dates', date_debut: '2026-05-01', date_fin_prevue: '2026-01-01' })).status, 400);
  assert.equal((await admin.get('/chantiers/abc')).status, 404);
  assert.equal((await admin.get('/chantiers/99999999999')).status, 404);

  for (const role of ['chef_chantier', 'conducteur']) {
    assert.equal((await admin.patch(`/utilisateurs/${ctx[role + '_id']}`, { chantiers: [ctx.ch1] })).status, 200);
  }
  r = await admin.post('/ouvriers', { matricule: 'M001', nom: 'Diop', prenom: 'Moussa', metier: 'Maçon', taux_horaire: 1500 });
  ctx.o1 = r.body.id;
  r = await admin.post('/ouvriers', { matricule: 'M002', nom: 'Ndiaye', prenom: 'Fatou', metier: 'Ferrailleur', taux_horaire: 1250 });
  ctx.o2 = r.body.id;
  r = await admin.post('/ouvriers', { matricule: 'M003', nom: 'Fall', metier: 'Manœuvre', taux_horaire: 1000 });
  ctx.o3 = r.body.id;
  assert.equal((await admin.put(`/chantiers/${ctx.ch1}/ouvriers`, { ouvrier_ids: [ctx.o1, ctx.o2] })).status, 200);
  assert.equal((await admin.put(`/chantiers/${ctx.ch2}/ouvriers`, { ouvrier_ids: [ctx.o1, ctx.o3] })).status, 200);
  assert.deepEqual((await admin.get('/ouvriers')).body.find((o) => o.id === ctx.o1).chantiers.sort(), [ctx.ch1, ctx.ch2].sort());

  for (const role of ['chef_chantier', 'conducteur', 'metreur', 'direction']) {
    const c = client();
    assert.equal((await c.post('/auth/connexion', { email: `${role}@ea.sn`, mot_de_passe: MDP })).status, 200);
    ctx[role] = c;
  }
});

test('accès par chantier : le chef ne voit que ses chantiers, même en changeant l\'identifiant', async () => {
  const { chef_chantier: chef } = ctx;
  const r = await chef.get('/chantiers');
  assert.deepEqual(r.body.chantiers.map((c) => c.code), ['CH-001']);
  assert.equal((await chef.get(`/chantiers/${ctx.ch2}`)).status, 404);
  assert.equal((await chef.get(`/chantiers/${ctx.ch2}/pointage?date=${jour}`)).status, 404);
  assert.equal((await chef.put(`/chantiers/${ctx.ch2}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o1, presence: 'present' }] })).status, 404);
  assert.equal((await chef.post('/chantiers', { code: 'Z', nom: 'Z' })).status, 403);
  assert.equal((await chef.get('/utilisateurs')).status, 403);
  assert.equal((await chef.get('/couts/main-oeuvre')).status, 403);
});

test('pointage : saisie, contrôles, masquage des salaires, validation à quatre yeux', async () => {
  const { chef_chantier: chef, conducteur } = ctx;
  let r = await chef.get(`/chantiers/${ctx.ch1}/pointage?date=${jour}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.lignes.length, 2);
  assert.equal(r.body.lignes[0].taux_horaire, undefined, 'le chef ne voit pas les taux');
  assert.equal(r.body.lignes[0].taux_actuel, undefined);

  assert.equal((await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o3, presence: 'present' }] })).status, 400);
  assert.equal((await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: '2999-01-01', lignes: [{ ouvrier_id: ctx.o1, presence: 'present' }] })).status, 400);
  assert.equal((await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [{ ouvrier_id: 'abc', presence: 'present' }] })).status, 404);

  r = await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [
    { ouvrier_id: ctx.o1, presence: 'present', heures_normales: 8, heures_sup: 2 },
    { ouvrier_id: ctx.o2, presence: 'absent', heures_normales: 8 },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.enregistrees, 2);

  r = await ctx.admin.put(`/chantiers/${ctx.ch2}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o1, presence: 'present', heures_normales: 12, heures_sup: 4 }] });
  assert.equal(r.status, 400);

  assert.equal((await chef.post(`/chantiers/${ctx.ch1}/pointage/validation`, { date: jour, action: 'valider' })).status, 403);
  r = await conducteur.post(`/chantiers/${ctx.ch1}/pointage/validation`, { date: jour, action: 'valider' });
  assert.equal(r.body.traitees, 2);

  r = await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o1, presence: 'absent' }] });
  assert.equal(r.body.enregistrees, 0);
  assert.equal(r.body.ignorees.length, 1);

  const hier = new Date(Date.parse(jour) - 86400000).toISOString().slice(0, 10);
  await conducteur.put(`/chantiers/${ctx.ch1}/pointage`, { date: hier, lignes: [{ ouvrier_id: ctx.o2, presence: 'present' }] });
  r = await conducteur.post(`/chantiers/${ctx.ch1}/pointage/validation`, { date: hier, action: 'valider' });
  assert.equal(r.body.traitees, 0);
  assert.equal(r.body.ignorees.length, 1);

  // Coût MO validé : 8 × 1500 + 2 × 1500 × 1,15 = 15 450
  r = await ctx.direction.get('/couts/main-oeuvre?groupe=chantier');
  assert.equal(r.body.total, 15450);
  r = await ctx.direction.get('/couts/main-oeuvre?groupe=chantier&inclure_non_valides=1');
  assert.equal(r.body.total, 15450 + 8 * 1250);
  r = await ctx.direction.get('/couts/main-oeuvre?groupe=mois');
  assert.equal(r.body.lignes[0].groupe, jour.slice(0, 7));
  r = await ctx.direction.get('/pointages');
  assert.ok(r.body.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date)));

  r = await ctx.direction.get('/pointages/export.csv');
  assert.equal(r.status, 200);
  assert.match(r.body, /Diop Moussa/);
});

test('mode hors ligne : envoi rejoué sans doublon et détection des conflits', async () => {
  const { chef_chantier: chef, conducteur } = ctx;
  const avantHier = new Date(Date.parse(jour) - 2 * 86400000).toISOString().slice(0, 10);
  const url = `/chantiers/${ctx.ch1}/pointage`;
  let f = (await chef.get(`${url}?date=${avantHier}`)).body;
  const ligne = (ouvrierId) => f.lignes.find((l) => l.ouvrier_id === ouvrierId);
  assert.equal(ligne(ctx.o1).version, null, 'ligne pas encore saisie');

  // Saisie faite hors ligne puis envoyée deux fois (réseau coupé avant la réponse)
  const op = crypto.randomUUID();
  const corps = { date: avantHier, operation_id: op, saisi_hors_ligne_le: new Date().toISOString(), lignes: [
    { ouvrier_id: ctx.o1, presence: 'present', heures_normales: 8, version: null },
    { ouvrier_id: ctx.o2, presence: 'present', heures_normales: 7, version: null }] };
  let r = await chef.put(url, corps);
  assert.equal(r.status, 200);
  assert.equal(r.body.enregistrees, 2);
  r = await chef.put(url, corps);
  assert.equal(r.body.rejouee, true);
  assert.equal(r.body.enregistrees, 2, 'même résultat renvoyé');
  f = (await chef.get(`${url}?date=${avantHier}`)).body;
  assert.equal(ligne(ctx.o1).version, 1);

  // Le conducteur rejette une ligne pendant que le chef, hors ligne, la corrige sur une ancienne version
  await conducteur.post(`${url}/validation`, { date: avantHier, action: 'rejeter', motif: 'Heures à vérifier', ids: [ligne(ctx.o2).id] });
  r = await chef.put(url, { date: avantHier, operation_id: crypto.randomUUID(), lignes: [
    { ouvrier_id: ctx.o1, presence: 'present', heures_normales: 6, version: 1 },
    { ouvrier_id: ctx.o2, presence: 'present', heures_normales: 9, version: 1 }] });
  assert.equal(r.body.enregistrees, 1);
  assert.equal(r.body.conflits.length, 1);
  assert.equal(r.body.conflits[0].ouvrier_id, ctx.o2);
  assert.match(r.body.conflits[0].raison, /rejetée/);
  f = (await chef.get(`${url}?date=${avantHier}`)).body;
  assert.equal(ligne(ctx.o2).heures_normales, 7, 'la ligne en conflit n\'est pas écrasée');
  assert.equal(ligne(ctx.o1).heures_normales, 6);
  assert.equal(ligne(ctx.o1).version, 2);

  // Le renvoi de la première opération, même après ces changements, ne réécrit rien
  r = await chef.put(url, corps);
  assert.equal(r.body.rejouee, true);
  assert.equal((await chef.get(`${url}?date=${avantHier}`)).body.lignes.find((l) => l.ouvrier_id === ctx.o1).heures_normales, 6);

  // Deux envois simultanés de la même opération : une seule application
  const op2 = crypto.randomUUID();
  const c2 = { date: avantHier, operation_id: op2, lignes: [{ ouvrier_id: ctx.o1, presence: 'demi_journee', version: 2 }] };
  const [a, b] = await Promise.all([chef.put(url, c2), chef.put(url, c2)]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal([a.body, b.body].filter((x) => x.rejouee).length, 1);
  assert.equal((await chef.get(`${url}?date=${avantHier}`)).body.lignes.find((l) => l.ouvrier_id === ctx.o1).version, 3);

  // Identifiant invalide, ou réutilisé par un autre utilisateur
  assert.equal((await chef.put(url, { ...c2, operation_id: 'pas-un-uuid' })).status, 400);
  assert.equal((await conducteur.put(url, c2)).status, 409);
  // Nettoyage : remet la ligne de l'ouvrier 2 dans un état neutre pour la suite
  await ctx.admin.put(url, { date: avantHier, lignes: [{ ouvrier_id: ctx.o2, presence: 'absent' }] });
});

test('déboursé sec : bibliothèque, étude, validation et synthèse chantier', async () => {
  const { metreur, direction, chef_chantier: chef } = ctx;
  const res = {};
  for (const [code, type, designation, unite, prix] of [
    ['CIM', 'materiau', 'Ciment CEM II 42,5', 't', 80000],
    ['GRA', 'materiau', 'Gravier concassé 8/16', 'm³', 12000],
    ['MAC', 'main_oeuvre', 'Maçon', 'h', 1500],
    ['BET', 'materiel', 'Bétonnière 350 L', 'j', 10000],
  ]) {
    const r = await metreur.post('/ressources', { code, type, designation, unite, prix_unitaire: prix });
    assert.equal(r.status, 201);
    res[code] = r.body.id;
  }
  assert.equal((await chef.post('/ressources', { code: 'X', type: 'materiau', designation: 'x', unite: 'u', prix_unitaire: 1 })).status, 403);

  let r = await metreur.post('/ouvrages', { code: 'BA-01', designation: 'Béton dosé à 350 kg/m³', lot: 'Béton armé', unite: 'm³', quantite_base: 1, composants: [
    { ressource_id: res.CIM, quantite: 0.35, pertes_pct: 5 },
    { ressource_id: res.GRA, quantite: 0.8 },
    { ressource_id: res.MAC, quantite: 6 },
    { ressource_id: res.BET, quantite: 0.5 },
  ] });
  assert.equal(r.status, 201);
  const ouv = r.body.id;
  r = await metreur.get(`/ouvrages/${ouv}`);
  assert.equal(r.body.ds.total, 53000);
  assert.equal(r.body.ds.main_oeuvre, 9000);
  // Une ressource utilisée ne peut pas être supprimée ; une ressource libre oui
  assert.equal((await metreur.del(`/ressources/${res.CIM}`)).status, 409);

  r = await metreur.post('/etudes', { reference: 'DEV-2026-001', objet: 'Gros œuvre', chantier_id: ctx.ch1, frais_chantier_pct: 10, frais_generaux_pct: 12, benefice_pct: 10 });
  assert.equal(r.status, 201);
  const et = r.body.id;
  assert.equal((await metreur.post(`/etudes/${et}/lignes`, { ouvrage_id: ouv, quantite: 10 })).status, 201);
  r = await metreur.get(`/etudes/${et}`);
  assert.equal(r.body.calcul.debourse_sec, 530000);
  assert.equal(r.body.calcul.ds_par_nature.main_oeuvre, 90000);
  assert.equal(r.body.calcul.tva, Math.round(r.body.calcul.total_ht * 0.18));

  await metreur.patch(`/ressources/${res.MAC}`, { prix_unitaire: 2000 });
  assert.equal((await metreur.get(`/etudes/${et}`)).body.calcul.debourse_sec, 530000);
  assert.equal((await metreur.post(`/etudes/${et}/actualiser`)).body.lignes_actualisees, 1);
  assert.equal((await metreur.get(`/etudes/${et}`)).body.calcul.debourse_sec, 560000);
  assert.equal((await metreur.get('/etudes')).body[0].debourse_sec, 560000);

  assert.equal((await metreur.post(`/etudes/${et}/statut`, { statut: 'valide' })).status, 403);
  assert.equal((await direction.post(`/etudes/${et}/statut`, { statut: 'valide' })).status, 200);
  assert.equal((await metreur.post(`/etudes/${et}/lignes`, { ouvrage_id: ouv, quantite: 1 })).status, 409);
  assert.equal((await direction.post(`/etudes/${et}/statut`, { statut: 'accepte' })).status, 200);

  r = await direction.get(`/chantiers/${ctx.ch1}/synthese`);
  assert.equal(r.body.prevision.ds_par_nature.main_oeuvre, 120000);
  assert.equal(r.body.pointage.cout_mo_valide, 15450);
  assert.equal(r.body.consommation_mo_pct, 12.9);
  r = await chef.get(`/chantiers/${ctx.ch1}/synthese`);
  assert.equal(r.body.pointage.cout_mo_valide, undefined);
  assert.equal(r.body.prevision, null);

  r = await direction.get('/tableau-de-bord');
  assert.equal(r.body.chantiers.en_cours, 2);
  assert.equal(r.body.couts.par_chantier.find((c) => c.code === 'CH-001').mo_prevue, 120000);
  assert.equal(r.body.couts.mo_validee_mois, 15450);
});

test('isolation entre entreprises (multi-locataire)', async () => {
  const autre = client();
  await inscrire(autre, 'Concurrent', 'b@autre.sn');
  assert.deepEqual((await autre.get('/chantiers')).body.chantiers, []);
  assert.equal((await autre.get(`/chantiers/${ctx.ch1}`)).status, 404);
  assert.equal((await autre.get(`/chantiers/${ctx.ch1}/pointage`)).status, 404);
  assert.equal((await autre.get('/ouvriers')).body.length, 0);
  assert.equal((await autre.get('/etudes/1')).status, 404);
  assert.equal((await autre.patch(`/ouvriers/${ctx.o1}`, { taux_horaire: 1 })).status, 404);
  assert.equal((await autre.put(`/chantiers/${ctx.ch1}/ouvriers`, { ouvrier_ids: [] })).status, 404);
  assert.equal((await autre.patch(`/utilisateurs/${ctx.chef_chantier_id}`, { role: 'admin' })).status, 404);
  const tb = (await autre.get('/tableau-de-bord')).body;
  assert.equal(tb.chantiers.en_cours, 0);
  assert.equal(tb.pointage.presents_aujourdhui, 0);
  ctx.autre = autre;
});

test('logo par entreprise : formats contrôlés et isolation', async () => {
  const { admin } = ctx;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await admin.get('/organisation/logo')).status, 404);
  assert.equal((await admin.put('/organisation/logo', { image: 'data:image/png;base64,' + png })).status, 200);
  let r = await admin.get('/auth/moi');
  assert.equal(r.body.organisation.a_logo, true);
  assert.equal(r.body.organisation.logo, undefined, 'le binaire ne transite pas dans /auth/moi');
  r = await admin.get('/organisation/logo');
  assert.equal(r.headers.get('content-type'), 'image/png');

  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal((await admin.put('/organisation/logo', { image: 'data:image/png;base64,' + svg })).status, 400);
  assert.equal((await admin.put('/organisation/logo', { image: 'data:image/png;base64,' + Buffer.alloc(400 * 1024).toString('base64') })).status, 400);
  assert.equal((await ctx.direction.put('/organisation/logo', { image: 'data:image/png;base64,' + png })).status, 403);
  assert.equal((await ctx.autre.get('/organisation/logo')).status, 404);
  assert.equal((await admin.del('/organisation/logo')).status, 200);
  assert.equal((await admin.get('/organisation/logo')).status, 404);
});

test('fin d\'essai : lecture seule, puis abonnement payé par Wave', async () => {
  const { admin, direction } = ctx;
  let r = await admin.get('/abonnement');
  assert.equal(r.body.acces.statut, 'essai');
  assert.equal(r.body.prix_mensuel, PRIX);
  assert.equal(r.body.paiement_disponible, true);
  assert.equal((await direction.get('/abonnement')).body.paiements.length, 0, 'seul l\'admin voit les paiements');

  // L'essai se termine
  await db.run(`UPDATE organisations SET essai_fin = now() - interval '1 hour' WHERE id = (SELECT org_id FROM users WHERE email = 'admin@ea.sn')`);
  assert.equal((await admin.get('/auth/moi')).body.acces.statut, 'expire');
  assert.equal((await admin.get('/chantiers')).status, 200, 'les données restent consultables');
  r = await admin.post('/chantiers', { code: 'CH-003', nom: 'Bloqué' });
  assert.equal(r.status, 402);
  assert.equal(r.body.code, 'abonnement_requis');
  assert.equal((await ctx.chef_chantier.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o2, presence: 'present' }] })).status, 402);

  // Seul l'administrateur paie ; durée contrôlée
  assert.equal((await direction.post('/abonnement/paiements', { mois: 1 })).status, 403);
  assert.equal((await admin.post('/abonnement/paiements', { mois: 2 })).status, 400);
  r = await admin.post('/abonnement/paiements', { mois: 3 });
  assert.equal(r.status, 201);
  assert.match(r.body.wave_launch_url, /^https:\/\/pay\.wave\.com\//);
  const pid = r.body.id;
  const session = fauxWave.derniere;
  assert.equal(session.amount, String(PRIX * 3));
  assert.equal(session.currency, 'XOF');
  assert.equal(session.success_url, `http://app.test/paiement/retour?id=${pid}`);

  // Pas encore payé : rien n'est crédité
  r = await admin.post(`/abonnement/paiements/${pid}/verifier`);
  assert.equal(r.body.statut, 'en_attente');
  assert.equal(r.body.acces.statut, 'expire');

  // Webhook falsifié ou trop ancien : refusé
  const corps = JSON.stringify({ id: 'EV1', type: 'checkout.session.completed', data: { id: session.id } });
  const webhook = (sig, b = corps) => fetch(base + '/webhooks/wave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Wave-Signature': sig }, body: b });
  assert.equal((await webhook(signer(corps, 'mauvais-secret'))).status, 401);
  assert.equal((await webhook(signer(corps, WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600))).status, 401);
  // Webhook correctement signé mais session non payée chez Wave : pas de crédit
  assert.equal((await webhook(signer(corps))).status, 200);
  assert.equal((await admin.get('/auth/moi')).body.acces.statut, 'expire');

  // Paiement effectué chez Wave, notification signée : abonnement de 3 mois
  payer(session);
  assert.equal((await webhook(signer(corps))).status, 200);
  r = await admin.get('/auth/moi');
  assert.equal(r.body.acces.statut, 'abonne');
  const fin = Date.parse(r.body.acces.fin);
  const mois = (fin - Date.now()) / (30.44 * 86400000);
  assert.ok(mois > 2.9 && mois < 3.1, `${mois} mois`);

  // Notification rejouée et vérification manuelle : aucun double crédit
  assert.equal((await webhook(signer(corps))).status, 200);
  r = await admin.post(`/abonnement/paiements/${pid}/verifier`);
  assert.equal(r.body.statut, 'paye');
  assert.equal(Date.parse(r.body.acces.fin), fin);

  // L'écriture est de nouveau possible
  assert.equal((await admin.post('/chantiers', { code: 'CH-003', nom: 'Débloqué' })).status, 201);
  r = await admin.get('/abonnement');
  assert.equal(r.body.paiements[0].statut, 'paye');
  assert.equal(r.body.paiements[0].montant, PRIX * 3);
});

test('paiement : un montant modifié chez Wave n\'est pas crédité, un renouvellement s\'ajoute à la période en cours', async () => {
  const { admin } = ctx;
  const avant = Date.parse((await admin.get('/auth/moi')).body.acces.fin);
  let r = await admin.post('/abonnement/paiements', { mois: 1 });
  const s1 = fauxWave.derniere;
  payer(s1); s1.amount = '100'; // montant payé différent du montant attendu
  r = await admin.post(`/abonnement/paiements/${r.body.id}/verifier`);
  assert.equal(r.body.statut, 'en_attente');
  assert.equal(Date.parse(r.body.acces.fin), avant);

  r = await admin.post('/abonnement/paiements', { mois: 1 });
  payer(fauxWave.derniere);
  r = await admin.post(`/abonnement/paiements/${r.body.id}/verifier`);
  assert.equal(r.body.statut, 'paye');
  const jours = (Date.parse(r.body.acces.fin) - avant) / 86400000;
  assert.ok(jours >= 28 && jours <= 31, `${jours} jours ajoutés`);
  // Un autre client ne peut pas vérifier ce paiement
  assert.equal((await ctx.autre.post(`/abonnement/paiements/${r.body.id}/verifier`)).status, 404);
});

test('liens des e-mails et retour Wave redirigent vers l\'application', async () => {
  const racine = base.replace('/api', '');
  let r = await fetch(racine + '/confirmer?jeton=abc_DEF-123', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/#/confirmer?jeton=abc_DEF-123');
  r = await fetch(racine + '/reinitialiser?jeton=<script>', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/#/reinitialiser?jeton=script');
  r = await fetch(racine + '/paiement/retour?id=12&echec=1', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/#/abonnement?paiement=12&echec=1');
  assert.equal((await fetch(racine + '/sante')).status, 200);
});

test('configuration publique, CSRF et limitation des créations d\'espace', async () => {
  const c = await client().get('/config');
  assert.equal(c.body.inscription_ouverte, true);
  assert.equal(c.body.essai_heures, 24);
  const r = await fetch(base + '/chantiers', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(r.status, 415);
  // Tentatives déjà faites depuis cette adresse : 3 (dont une refusée). 2 passent encore, puis blocage.
  const statuts = [];
  for (let i = 0; i < 4; i++) {
    statuts.push((await client().post('/auth/inscription', { entreprise: `E${i}`, nom: 'N', email: `spam${i}@x.sn`, mot_de_passe: MDP })).status);
  }
  assert.deepEqual(statuts, [201, 201, 429, 429]);
  await ctx.admin.post('/auth/deconnexion');
  assert.equal((await ctx.admin.get('/auth/moi')).status, 401);
});
