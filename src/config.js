'use strict';
// Configuration lue dans les variables d'environnement (voir .env.example).
// createApp() accepte les mêmes clés pour les surcharger (utilisé par les tests).
function lireConfig(surcharges = {}) {
  const e = process.env;
  const c = {
    databaseUrl: e.DATABASE_URL || 'postgres://btp:btp@localhost:5432/btp',
    appUrl: (e.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    secureCookies: e.COOKIE_SECURE === '1',
    inscriptionOuverte: e.INSCRIPTION_OUVERTE !== '0',
    nomProduit: e.NOM_PRODUIT || 'BTP Manager 360',
    essaiHeures: Number(e.ESSAI_HEURES || 24),
    prixMensuel: e.ABONNEMENT_PRIX_MENSUEL_XOF ? Number(e.ABONNEMENT_PRIX_MENSUEL_XOF) : null,
    email: {
      brevoApiKey: e.BREVO_API_KEY || null,
      brevoApiUrl: e.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email',
      expediteur: e.EMAIL_EXPEDITEUR || null,
      expediteurNom: e.EMAIL_EXPEDITEUR_NOM || e.NOM_PRODUIT || 'BTP Manager 360',
    },
    wave: {
      apiKey: e.WAVE_API_KEY || null,
      apiUrl: (e.WAVE_API_URL || 'https://api.wave.com').replace(/\/$/, ''),
      webhookSecret: e.WAVE_WEBHOOK_SECRET || null,
    },
  };
  for (const [k, v] of Object.entries(surcharges)) {
    c[k] = v && typeof v === 'object' && !Array.isArray(v) && c[k] && typeof c[k] === 'object' ? { ...c[k], ...v } : v;
  }
  return c;
}
module.exports = { lireConfig };
