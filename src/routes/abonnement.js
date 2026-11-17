'use strict';
const express = require('express');
const { requireAuth, requirePerm, can, etatAcces } = require('../auth');
const { HttpError, id, audit } = require('../util');
const { verifierSignatureWave, sessionPayee } = require('../wave');

const DUREES = [1, 3, 6, 12]; // en mois

// Crédite un paiement confirmé : prolonge l'abonnement à partir de la plus tardive des dates
// (maintenant, fin d'abonnement en cours, fin d'essai). Idempotent : un paiement n'est crédité qu'une fois.
async function crediter(db, paiementId, session) {
  return db.tx(async (t) => {
    const p = await t.get('SELECT * FROM paiements WHERE id = ? FOR UPDATE', paiementId);
    if (!p || p.statut === 'paye') return false;
    const { debut } = await t.get(`SELECT GREATEST(now(), COALESCE(abonnement_fin, now()), COALESCE(essai_fin, now())) AS debut
      FROM organisations WHERE id = ? FOR UPDATE`, p.org_id);
    const { fin } = await t.get('SELECT ?::timestamptz + make_interval(months => ?) AS fin', debut, p.mois);
    await t.run('UPDATE organisations SET abonnement_fin = ? WHERE id = ?', fin, p.org_id);
    await t.run(`UPDATE paiements SET statut = 'paye', paye_le = now(), periode_debut = ?, periode_fin = ?, wave_transaction_id = ? WHERE id = ?`,
      debut, fin, session.transaction_id || null, p.id);
    await audit(t, { org_id: p.org_id, id: p.user_id }, 'paiement_confirme', 'paiement', p.id, { montant: p.montant, mois: p.mois, fin });
    return true;
  });
}

// Interroge Wave et met le paiement à jour. Seule source de vérité : la session lue chez Wave.
async function synchroniser(db, wave, p) {
  if (p.statut !== 'en_attente' || !p.wave_session_id) return p.statut;
  const session = await wave.lireSession(p.wave_session_id);
  if (sessionPayee(session, p.montant)) {
    await crediter(db, p.id, session);
    return 'paye';
  }
  if (session.checkout_status === 'expired' || session.payment_status === 'cancelled') {
    await db.run(`UPDATE paiements SET statut = 'echoue' WHERE id = ? AND statut = 'en_attente'`, p.id);
    return 'echoue';
  }
  return 'en_attente';
}

function abonnementRoutes(db, cfg, wave) {
  const r = express.Router();
  const paiementDisponible = () => !!(wave.actif && cfg.prixMensuel > 0);

  r.get('/abonnement', requireAuth, async (req, res) => {
    const org = await db.get('SELECT essai_fin, abonnement_fin FROM organisations WHERE id = ?', req.user.org_id);
    const voitPaiements = can(req.user, 'admin.parametres');
    res.json({
      acces: etatAcces(org), essai_heures: cfg.essaiHeures,
      prix_mensuel: cfg.prixMensuel, durees: DUREES, paiement_disponible: paiementDisponible(), peut_payer: voitPaiements,
      paiements: voitPaiements ? await db.all(`SELECT id, mois, montant, devise, statut, periode_debut, periode_fin, created_at, paye_le
        FROM paiements WHERE org_id = ? ORDER BY id DESC LIMIT 50`, req.user.org_id) : [],
    });
  });

  // Lance un paiement Wave : renvoie l'URL de la page de paiement Wave
  r.post('/abonnement/paiements', requirePerm('admin.parametres'), async (req, res) => {
    if (!paiementDisponible()) throw new HttpError(503, 'Le paiement en ligne n\'est pas encore configuré sur ce service.');
    const mois = Number(req.body.mois);
    if (!DUREES.includes(mois)) throw new HttpError(400, 'Durée invalide.');
    const montant = Math.round(cfg.prixMensuel * mois);
    const pid = await db.insert('INSERT INTO paiements (org_id, user_id, mois, montant) VALUES (?,?,?,?)', req.user.org_id, req.user.id, mois, montant);
    let session;
    try {
      session = await wave.creerSession({
        montant, reference: `paiement-${pid}`, idempotence: `paiement-${pid}`,
        successUrl: `${cfg.appUrl}/paiement/retour?id=${pid}`, errorUrl: `${cfg.appUrl}/paiement/retour?id=${pid}&echec=1`,
      });
    } catch (e) {
      await db.run(`UPDATE paiements SET statut = 'echoue' WHERE id = ?`, pid);
      throw e;
    }
    if (!session.id || !session.wave_launch_url) throw new HttpError(502, 'Réponse inattendue de Wave.');
    await db.run('UPDATE paiements SET wave_session_id = ?, wave_launch_url = ? WHERE id = ?', session.id, session.wave_launch_url, pid);
    await audit(db, req.user, 'paiement_initie', 'paiement', pid, { mois, montant });
    res.status(201).json({ id: pid, wave_launch_url: session.wave_launch_url });
  });

  // Appelé au retour de Wave (ou par le bouton « Vérifier ») : on interroge Wave, on ne fait pas confiance à la redirection
  r.post('/abonnement/paiements/:id/verifier', requireAuth, async (req, res) => {
    const p = await db.get('SELECT * FROM paiements WHERE id = ? AND org_id = ?', id(req.params.id, 'Paiement'), req.user.org_id);
    if (!p) throw new HttpError(404, 'Paiement introuvable.');
    const statut = p.statut === 'en_attente' && wave.actif ? await synchroniser(db, wave, p) : p.statut;
    const org = await db.get('SELECT essai_fin, abonnement_fin FROM organisations WHERE id = ?', req.user.org_id);
    res.json({ statut, acces: etatAcces(org) });
  });

  return r;
}

// Webhook Wave : signature vérifiée, puis session relue chez Wave avant tout crédit
function webhookWave(db, cfg, wave) {
  return async (req, res) => {
    const brut = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!verifierSignatureWave(brut, req.get('Wave-Signature'), cfg.wave.webhookSecret)) {
      return res.status(401).json({ error: 'Signature invalide.' });
    }
    let evt;
    try { evt = JSON.parse(brut); } catch { return res.status(400).json({ error: 'JSON invalide.' }); }
    const sessionId = evt && evt.data && evt.data.id;
    if (sessionId && /^checkout\.session\./.test(evt.type || '')) {
      const p = await db.get('SELECT * FROM paiements WHERE wave_session_id = ?', String(sessionId));
      if (p) await synchroniser(db, wave, p);
    }
    res.json({ ok: true });
  };
}

module.exports = { abonnementRoutes, webhookWave, crediter };
