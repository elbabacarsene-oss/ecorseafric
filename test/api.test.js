'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { aujourdhuiDakar } = require('../src/util');

let server, base;
test.before(async () => {
  const { app } = createApp({ dbFile: ':memory:' });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => server.close());

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
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u, {}) };
}

const MDP = 'MotDePasse2026';
const jour = aujourdhuiDakar();
const ctx = {};

test('inscription, connexion et persistance de session', async () => {
  const admin = client();
  let r = await admin.post('/auth/inscription', { entreprise: 'ECORSE AFRIC', nom: 'Admin EA', email: 'admin@ea.sn', mot_de_passe: MDP });
  assert.equal(r.status, 201);
  r = await admin.get('/auth/moi');
  assert.equal(r.status, 200);
  assert.equal(r.body.utilisateur.role, 'admin');
  assert.equal(r.body.organisation.devise, 'XOF');

  const anonyme = client();
  assert.equal((await anonyme.get('/chantiers')).status, 401);
  assert.equal((await anonyme.post('/auth/connexion', { email: 'admin@ea.sn', mot_de_passe: 'mauvais' })).status, 401);
  assert.equal((await anonyme.post('/auth/inscription', { entreprise: 'X', nom: 'Y', email: 'a@b.sn', mot_de_passe: 'court' })).status, 400);
  ctx.admin = admin;
});

test('création des utilisateurs, chantiers et ouvriers', async () => {
  const { admin } = ctx;
  for (const [nom, role] of [['Chef', 'chef_chantier'], ['Conducteur', 'conducteur'], ['Metreur', 'metreur'], ['Directeur', 'direction']]) {
    const r = await admin.post('/utilisateurs', { nom, email: `${role}@ea.sn`, role, mot_de_passe: MDP });
    assert.equal(r.status, 201);
    ctx[role + '_id'] = r.body.id;
  }
  let r = await admin.post('/chantiers', { code: 'CH-001', nom: 'Immeuble R+4 Mermoz', type_projet: 'Immeuble', ville: 'Dakar', statut: 'en_cours', montant_marche: 250000000 });
  assert.equal(r.status, 201); ctx.ch1 = r.body.id;
  r = await admin.post('/chantiers', { code: 'CH-002', nom: 'Route Thiès', type_projet: 'Route', statut: 'en_cours' });
  ctx.ch2 = r.body.id;
  assert.equal((await admin.post('/chantiers', { code: 'CH-001', nom: 'doublon' })).status, 409);
  assert.equal((await admin.post('/chantiers', { code: 'X', nom: 'dates', date_debut: '2026-05-01', date_fin_prevue: '2026-01-01' })).status, 400);

  // Le chef et le conducteur n'ont accès qu'au chantier CH-001
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
  // Rôle insuffisant
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

  // ouvrier non affecté
  assert.equal((await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o3, presence: 'present' }] })).status, 400);
  // date future
  assert.equal((await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: '2999-01-01', lignes: [{ ouvrier_id: ctx.o1, presence: 'present' }] })).status, 400);

  r = await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [
    { ouvrier_id: ctx.o1, presence: 'present', heures_normales: 8, heures_sup: 2 },
    { ouvrier_id: ctx.o2, presence: 'absent', heures_normales: 8 },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.enregistrees, 2);

  // Plus de 24 h cumulées sur deux chantiers : refusé
  r = await ctx.admin.put(`/chantiers/${ctx.ch2}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o1, presence: 'present', heures_normales: 12, heures_sup: 4 }] });
  assert.equal(r.status, 400);

  // Le chef ne peut pas valider ; le conducteur oui
  assert.equal((await chef.post(`/chantiers/${ctx.ch1}/pointage/validation`, { date: jour, action: 'valider' })).status, 403);
  r = await conducteur.post(`/chantiers/${ctx.ch1}/pointage/validation`, { date: jour, action: 'valider' });
  assert.equal(r.body.traitees, 2);

  // Une ligne validée n'est plus modifiable
  r = await chef.put(`/chantiers/${ctx.ch1}/pointage`, { date: jour, lignes: [{ ouvrier_id: ctx.o1, presence: 'absent' }] });
  assert.equal(r.body.enregistrees, 0);
  assert.equal(r.body.ignorees.length, 1);

  // Le conducteur ne valide pas sa propre saisie
  const hier = new Date(Date.parse(jour) - 86400000).toISOString().slice(0, 10);
  await conducteur.put(`/chantiers/${ctx.ch1}/pointage`, { date: hier, lignes: [{ ouvrier_id: ctx.o2, presence: 'present' }] });
  r = await conducteur.post(`/chantiers/${ctx.ch1}/pointage/validation`, { date: hier, action: 'valider' });
  assert.equal(r.body.traitees, 0);
  assert.equal(r.body.ignorees.length, 1);

  // Coût MO validé : 8 × 1500 + 2 × 1500 × 1,15 = 15 450 (l'absente ne coûte rien)
  r = await ctx.direction.get('/couts/main-oeuvre?groupe=chantier');
  assert.equal(r.body.total, 15450);
  r = await ctx.direction.get('/couts/main-oeuvre?groupe=chantier&inclure_non_valides=1');
  assert.equal(r.body.total, 15450 + 8 * 1250);

  // Export CSV
  r = await ctx.direction.get('/pointages/export.csv');
  assert.equal(r.status, 200);
  assert.match(r.body, /Diop Moussa/);
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

  r = await metreur.post('/etudes', { reference: 'DEV-2026-001', objet: 'Gros œuvre', chantier_id: ctx.ch1, frais_chantier_pct: 10, frais_generaux_pct: 12, benefice_pct: 10 });
  assert.equal(r.status, 201);
  const et = r.body.id;
  assert.equal((await metreur.post(`/etudes/${et}/lignes`, { ouvrage_id: ouv, quantite: 10 })).status, 201);
  r = await metreur.get(`/etudes/${et}`);
  assert.equal(r.body.calcul.debourse_sec, 530000);
  assert.equal(r.body.calcul.ds_par_nature.main_oeuvre, 90000);
  assert.equal(r.body.calcul.tva, Math.round(r.body.calcul.total_ht * 0.18));

  // La ligne garde son DS même si le prix de la ressource change, jusqu'à actualisation
  await metreur.patch(`/ressources/${res.MAC}`, { prix_unitaire: 2000 });
  assert.equal((await metreur.get(`/etudes/${et}`)).body.calcul.debourse_sec, 530000);
  assert.equal((await metreur.post(`/etudes/${et}/actualiser`)).body.lignes_actualisees, 1);
  assert.equal((await metreur.get(`/etudes/${et}`)).body.calcul.debourse_sec, 560000);

  // Validation : pas par le rédacteur (métreur n'a de toute façon pas le droit), oui par la direction
  assert.equal((await metreur.post(`/etudes/${et}/statut`, { statut: 'valide' })).status, 403);
  assert.equal((await direction.post(`/etudes/${et}/statut`, { statut: 'valide' })).status, 200);
  assert.equal((await metreur.post(`/etudes/${et}/lignes`, { ouvrage_id: ouv, quantite: 1 })).status, 409);
  assert.equal((await direction.post(`/etudes/${et}/statut`, { statut: 'accepte' })).status, 200);

  // Synthèse : MO prévue 10 × 6 h × 2000 = 120 000 ; MO réelle validée 15 450
  r = await direction.get(`/chantiers/${ctx.ch1}/synthese`);
  assert.equal(r.body.prevision.ds_par_nature.main_oeuvre, 120000);
  assert.equal(r.body.pointage.cout_mo_valide, 15450);
  assert.equal(r.body.consommation_mo_pct, 12.9);
  // Le chef de chantier voit la synthèse sans les montants
  r = await chef.get(`/chantiers/${ctx.ch1}/synthese`);
  assert.equal(r.body.pointage.cout_mo_valide, undefined);
  assert.equal(r.body.prevision, null);

  r = await direction.get('/tableau-de-bord');
  assert.equal(r.body.chantiers.en_cours, 2);
  assert.equal(r.body.couts.par_chantier.find((c) => c.code === 'CH-001').mo_prevue, 120000);
});

test('isolation entre entreprises (multi-locataire)', async () => {
  const autre = client();
  await autre.post('/auth/inscription', { entreprise: 'Concurrent', nom: 'B', email: 'b@autre.sn', mot_de_passe: MDP });
  assert.deepEqual((await autre.get('/chantiers')).body.chantiers, []);
  assert.equal((await autre.get(`/chantiers/${ctx.ch1}`)).status, 404);
  assert.equal((await autre.get(`/chantiers/${ctx.ch1}/pointage`)).status, 404);
  assert.equal((await autre.get('/ouvriers')).body.length, 0);
  assert.equal((await autre.get('/etudes/1')).status, 404);
  assert.equal((await autre.patch(`/ouvriers/${ctx.o1}`, { taux_horaire: 1 })).status, 404);
  assert.equal((await autre.put(`/chantiers/${ctx.ch1}/ouvriers`, { ouvrier_ids: [] })).status, 404);
  const tb = (await autre.get('/tableau-de-bord')).body;
  assert.equal(tb.chantiers.en_cours, 0);
  assert.equal(tb.pointage.presents_aujourdhui, 0);
});

test('déconnexion et CSRF', async () => {
  const { admin } = ctx;
  const r = await fetch(base + '/chantiers', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(r.status, 415);
  await admin.post('/auth/deconnexion');
  assert.equal((await admin.get('/auth/moi')).status, 401);
});

test('logo par entreprise : formats contrôlés et isolation', async () => {
  const admin = client();
  await admin.post('/auth/connexion', { email: 'admin@ea.sn', mot_de_passe: MDP });
  // PNG 1×1 valide
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.equal((await admin.get('/organisation/logo')).status, 404);
  assert.equal((await admin.put('/organisation/logo', { image: 'data:image/png;base64,' + png })).status, 200);
  let r = await admin.get('/auth/moi');
  assert.equal(r.body.organisation.a_logo, 1);
  assert.equal(r.body.organisation.logo, undefined, 'le binaire ne transite pas dans /auth/moi');
  r = await fetch(base + '/organisation/logo', { headers: { Cookie: (await (async () => { const res = await fetch(base + '/auth/connexion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@ea.sn', mot_de_passe: MDP }) }); return res.headers.get('set-cookie').split(';')[0]; })()) } });
  assert.equal(r.headers.get('content-type'), 'image/png');

  // SVG (peut contenir du script) et faux PNG refusés, quel que soit le type déclaré
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal((await admin.put('/organisation/logo', { image: 'data:image/png;base64,' + svg })).status, 400);
  assert.equal((await admin.put('/organisation/logo', { image: 'data:image/png;base64,' + Buffer.alloc(400 * 1024).toString('base64') })).status, 400);
  // Seul l'administrateur modifie le logo
  assert.equal((await ctx.direction.put('/organisation/logo', { image: 'data:image/png;base64,' + png })).status, 403);
  // Une autre entreprise ne reçoit pas ce logo
  const autre = client();
  await autre.post('/auth/connexion', { email: 'b@autre.sn', mot_de_passe: MDP });
  assert.equal((await autre.get('/organisation/logo')).status, 404);
  assert.equal((await admin.del('/organisation/logo')).status, 200);
  assert.equal((await admin.get('/organisation/logo')).status, 404);
});

test('configuration publique et limitation des créations d\'espace', async () => {
  const anonyme = client();
  const c = await anonyme.get('/config');
  assert.equal(c.body.inscription_ouverte, true);
  assert.ok(c.body.nom_produit);
  // 3 tentatives déjà faites depuis cette adresse (dont une refusée) : 2 passent, puis blocage
  const statuts = [];
  for (let i = 0; i < 4; i++) {
    statuts.push((await client().post('/auth/inscription', { entreprise: `E${i}`, nom: 'N', email: `spam${i}@x.sn`, mot_de_passe: MDP })).status);
  }
  assert.deepEqual(statuts, [201, 201, 429, 429]);
});
