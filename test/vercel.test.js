'use strict';
// Le point d'entrée Vercel (api/index.js) appelé comme le fait Vercel : une fonction (req, res) par requête.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.DATABASE_URL = process.env.DATABASE_URL_TEST || 'postgres://btp:btp@localhost:5432/btp_test';
process.env.VERCEL = '1';
process.env.APP_URL = 'https://www.bati.com';
process.env.WAVE_WEBHOOK_SECRET = 'secret';
const handler = require('../api/index');

let server, base;
test.before(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('la fonction Vercel sert l\'API, les redirections et le webhook (corps brut)', async () => {
  // Premières requêtes simultanées : une seule initialisation de l'application
  const [a, b] = await Promise.all([fetch(base + '/api/config'), fetch(base + '/sante')]);
  assert.equal(a.status, 200);
  assert.equal((await a.json()).essai_heures, 24);
  assert.equal(b.status, 200);
  let r = await fetch(base + '/confirmer?jeton=abc', { redirect: 'manual' });
  assert.equal(r.headers.get('location'), '/#/confirmer?jeton=abc');
  assert.equal((await fetch(base + '/api/chantiers')).status, 401);
  // Le webhook lit le corps brut : une signature fausse est refusée, pas une erreur 500
  r = await fetch(base + '/api/webhooks/wave', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Wave-Signature': 't=1,v1=00' }, body: '{"type":"x"}' });
  assert.equal(r.status, 401);
  // IP du visiteur lue dans X-Forwarded-For (réécrit par Vercel) : les limites anti-abus s'appliquent par visiteur
  const inscrire = (ip, i) => fetch(base + '/api/auth/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ entreprise: 'E', nom: 'N', email: `v${ip}-${i}@x.sn`, mot_de_passe: 'court' }) }).then((x) => x.status);
  const statuts = [];
  for (let i = 0; i < 6; i++) statuts.push(await inscrire('196.207.1.1', i));
  assert.deepEqual(statuts, [400, 400, 400, 400, 400, 429]);
  assert.equal(await inscrire('41.82.3.3', 0), 400, 'un autre visiteur n\'est pas bloqué');
});
