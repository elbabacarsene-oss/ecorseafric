'use strict';
const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { lireConfig } = require('./config');
const { sessionMiddleware, etatAcces } = require('./auth');
const { HttpError } = require('./util');
const { creerEmetteur } = require('./email');
const { creerClientWave } = require('./wave');
const { abonnementRoutes, webhookWave } = require('./routes/abonnement');

async function createApp(options = {}) {
  const cfg = lireConfig(options);
  const db = await openDb(cfg.databaseUrl, { reinitialiser: !!options.reinitialiserBase, ssl: cfg.databaseSsl, max: cfg.pgPoolMax });
  const emetteur = creerEmetteur(cfg.email);
  const wave = creerClientWave(cfg.wave);
  const app = express();
  app.disable('x-powered-by');
  // Derrière un proxy (hébergeur, Caddy/Nginx) : nombre de proxys ou plages d'adresses de confiance
  app.set('trust proxy', cfg.trustProxy === 'true' ? true : /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);

  // En-têtes de sécurité
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    if (cfg.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.get('/sante', async (_req, res) => { await db.get('SELECT 1'); res.json({ ok: true }); });

  // Webhook Wave : corps brut nécessaire pour vérifier la signature (déclaré avant le parseur JSON)
  app.post('/api/webhooks/wave', express.raw({ type: '*/*', limit: '200kb' }), webhookWave(db, cfg, wave));

  app.use('/api', express.json({ limit: '1mb' }));
  // Protection CSRF : en plus du cookie SameSite=Strict, toute requête d'écriture doit être en JSON
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type application/json requis.' });
    }
    next();
  });
  app.use('/api', sessionMiddleware(db));
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Contrôle d'accès lié au compte et à l'abonnement :
  //  - e-mail non confirmé : seules les routes /auth/* répondent ;
  //  - essai terminé sans abonnement : l'espace passe en lecture seule (les données restent consultables).
  app.use('/api', (req, res, next) => {
    const u = req.user;
    if (!u) return next();
    const libre = req.path.startsWith('/auth/') || req.path === '/config';
    if (!u.email_verifie && !libre) {
      return res.status(403).json({ error: 'Confirmez votre adresse e-mail pour accéder à votre espace.', code: 'email_non_verifie' });
    }
    if (!['GET', 'HEAD'].includes(req.method) && !libre && !req.path.startsWith('/abonnement')) {
      const etat = etatAcces(u);
      if (etat.statut === 'expire' || etat.statut === 'non_demarre') {
        return res.status(402).json({ error: 'Votre période d\'essai ou votre abonnement est terminé : l\'espace est en lecture seule. Renouvelez l\'abonnement pour continuer la saisie.', code: 'abonnement_requis' });
      }
    }
    next();
  });

  app.get('/api/config', (_req, res) => res.json({ nom_produit: cfg.nomProduit, inscription_ouverte: cfg.inscriptionOuverte, essai_heures: cfg.essaiHeures }));
  app.use('/api', require('./routes/auth')(db, cfg, emetteur));
  app.use('/api', abonnementRoutes(db, cfg, wave));
  app.use('/api', require('./routes/dashboard')(db));
  app.use('/api', require('./routes/chantiers')(db));
  app.use('/api', require('./routes/pointage')(db));
  app.use('/api', require('./routes/debourse')(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

  // Liens reçus par e-mail ou retour de Wave : redirection vers l'écran correspondant de l'application
  const jetonSur = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
  app.get('/confirmer', (req, res) => res.redirect(`/#/confirmer?jeton=${jetonSur(req.query.jeton)}`));
  app.get('/reinitialiser', (req, res) => res.redirect(`/#/reinitialiser?jeton=${jetonSur(req.query.jeton)}`));
  app.get('/paiement/retour', (req, res) => {
    const pid = Number(req.query.id) || 0;
    res.redirect(`/#/abonnement?paiement=${pid}${req.query.echec ? '&echec=1' : ''}`);
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // Gestion centralisée des erreurs (codes d'erreur PostgreSQL traduits)
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
    if (err.code === '23505') return res.status(409).json({ error: 'Cet enregistrement existe déjà.' });
    if (err.code === '23514' || err.code === '22P02' || err.code === '22003') return res.status(400).json({ error: 'Valeur invalide ou hors limites.' });
    if (err.code === '23503') return res.status(409).json({ error: 'Opération impossible : cet élément est utilisé ailleurs.' });
    if (err.status === 502) return res.status(502).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return { app, db, cfg };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().then(({ app, db, cfg }) => {
    if (!cfg.wave.apiKey) console.warn('[abonnement] WAVE_API_KEY absent : le paiement en ligne est désactivé.');
    if (cfg.wave.apiKey && !cfg.wave.webhookSecret) console.warn('[abonnement] WAVE_WEBHOOK_SECRET absent : les notifications Wave seront refusées (les paiements restent vérifiés au retour du client).');
    if (cfg.appUrl.startsWith('http://localhost')) console.warn('[config] APP_URL pointe sur localhost : les liens des e-mails et le retour de Wave ne fonctionneront pas en production.');
    const server = app.listen(port, () => console.log(`${cfg.nomProduit} — serveur démarré sur le port ${port}`));
    const arret = () => server.close(() => db.close().then(() => process.exit(0)));
    process.on('SIGTERM', arret);
    process.on('SIGINT', arret);
  }).catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
}

module.exports = { createApp };
