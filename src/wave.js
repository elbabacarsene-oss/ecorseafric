'use strict';
// Client Wave Checkout (paiement mobile, Sénégal / Côte d'Ivoire).
// Règle de sécurité : un paiement n'est crédité qu'après lecture de la session
// directement auprès de l'API Wave (jamais sur la seule foi d'une redirection ou d'un webhook).
const crypto = require('node:crypto');

function creerClientWave(cfg) {
  const appel = async (method, chemin, body, idempotence) => {
    const headers = { Authorization: `Bearer ${cfg.apiKey}`, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    if (idempotence) headers['Idempotency-Key'] = idempotence;
    const res = await fetch(cfg.apiUrl + chemin, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Wave a refusé la requête (${res.status}) : ${data.message || data.code || 'erreur inconnue'}`);
      err.status = 502;
      throw err;
    }
    return data;
  };
  return {
    actif: !!cfg.apiKey,
    // amount : chaîne sans décimales pour le franc CFA
    creerSession: ({ montant, reference, successUrl, errorUrl, idempotence }) => appel('POST', '/v1/checkout/sessions', {
      amount: String(Math.round(montant)), currency: 'XOF', client_reference: reference, success_url: successUrl, error_url: errorUrl,
    }, idempotence),
    lireSession: (id) => appel('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
  };
}

// Vérifie l'en-tête « Wave-Signature: t=<horodatage>,v1=<hmac>[,v1=…] » :
// HMAC-SHA256(secret, horodatage + corps brut), en hexadécimal. Tolérance : 5 minutes.
function verifierSignatureWave(corpsBrut, entete, secret, maintenant = Date.now()) {
  if (!entete || !secret) return false;
  const parts = String(entete).split(',').map((p) => p.trim().split('='));
  const t = (parts.find(([k]) => k === 't') || [])[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !signatures.length) return false;
  if (Math.abs(maintenant / 1000 - Number(t)) > 300) return false;
  const attendu = crypto.createHmac('sha256', secret).update(t + corpsBrut).digest('hex');
  return signatures.some((s) => s.length === attendu.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(attendu)));
}

// Une session est payée si Wave la déclare complète ET réussie, pour le bon montant en XOF
function sessionPayee(session, montantAttendu) {
  return session && session.checkout_status === 'complete' && session.payment_status === 'succeeded'
    && session.currency === 'XOF' && Number(session.amount) === Number(montantAttendu);
}

module.exports = { creerClientWave, verifierSignatureWave, sessionPayee };
