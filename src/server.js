'use strict';
const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { sessionMiddleware } = require('./auth');
const { HttpError } = require('./util');

function createApp({ dbFile = path.join(__dirname, '..', 'data', 'btp.db'), secureCookies = false, inscriptionOuverte = true, nomProduit = 'BTP Manager 360' } = {}) {
  const db = openDb(dbFile);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // En-têtes de sécurité
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    next();
  });

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

  // Configuration publique (affichée avant connexion)
  app.get('/api/config', (_req, res) => res.json({ nom_produit: nomProduit, inscription_ouverte: inscriptionOuverte }));
  app.use('/api', require('./routes/auth')(db, { secureCookies, inscriptionOuverte }));
  app.use('/api', require('./routes/dashboard')(db));
  app.use('/api', require('./routes/chantiers')(db));
  app.use('/api', require('./routes/pointage')(db));
  app.use('/api', require('./routes/debourse')(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // Gestion centralisée des erreurs
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide.' });
    if (/UNIQUE constraint/.test(err.message)) return res.status(409).json({ error: 'Cet enregistrement existe déjà.' });
    if (/CHECK constraint/.test(err.message)) return res.status(400).json({ error: 'Valeur hors limites.' });
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return { app, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { app } = createApp({
    dbFile: process.env.DB_FILE || undefined,
    secureCookies: process.env.COOKIE_SECURE === '1',
    inscriptionOuverte: process.env.INSCRIPTION_OUVERTE !== '0',
    nomProduit: process.env.NOM_PRODUIT || undefined,
  });
  app.listen(port, () => console.log(`BTP Manager 360 — serveur démarré sur http://localhost:${port}`));
}

module.exports = { createApp };
