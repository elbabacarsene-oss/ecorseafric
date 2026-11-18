'use strict';
// Point d'entrée Vercel : toutes les routes dynamiques (/api/*, /sante, liens des e-mails, retour Wave)
// sont redirigées vers cette fonction par vercel.json. Les fichiers de public/ sont servis par le CDN de Vercel.
// L'application (connexion à PostgreSQL, vérification du schéma) est initialisée une fois par instance.
const { createApp } = require('../src/server');

let pret = null;

module.exports = async (req, res) => {
  if (!pret) {
    pret = createApp().then((r) => r.app).catch((e) => {
      pret = null; // nouvel essai à la requête suivante
      throw e;
    });
  }
  let app;
  try {
    app = await pret;
  } catch (e) {
    console.error('[démarrage] impossible d\'initialiser l\'application :', e.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Service momentanément indisponible. Réessayez dans un instant.' }));
    return;
  }
  return app(req, res);
};
