'use strict';
/* Service worker : l'application s'ouvre sans réseau, et les données nécessaires au pointage
 * (profil, chantiers, feuilles déjà consultées, ouvriers affectés) restent consultables.
 * Stratégie « réseau d'abord » : avec du réseau, on obtient toujours la version à jour. */
const COQUILLE = 'coquille-v1';
const DONNEES = 'donnees-v1';
const FICHIERS = ['/', '/index.html', '/app.js', '/hors-ligne.js', '/style.css', '/logo.svg', '/manifest.webmanifest', '/icone-192.png', '/icone-512.png'];
// Réponses d'API conservées pour le mode hors ligne (lecture seule)
const API_CONSERVEES = [/^\/api\/auth\/moi$/, /^\/api\/config$/, /^\/api\/chantiers$/, /^\/api\/chantiers\/\d+\/pointage$/, /^\/api\/chantiers\/\d+\/ouvriers$/, /^\/api\/organisation\/logo$/];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(COQUILLE).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((cles) => Promise.all(cles.filter((k) => k !== COQUILLE && k !== DONNEES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Déconnexion : les données de l'utilisateur sont effacées de l'appareil
self.addEventListener('message', (e) => {
  if (e.data === 'vider-donnees') e.waitUntil(caches.delete(DONNEES));
});

const horsLigneJson = () => new Response(JSON.stringify({ error: 'Pas de connexion internet : cette information n\'est pas disponible sur l\'appareil.', code: 'hors_ligne' }),
  { status: 503, headers: { 'Content-Type': 'application/json' } });

// Réseau avec délai maximal : sur un réseau très lent, on se rabat sur la copie locale
function reseau(requete, delaiMs) {
  return new Promise((ok, ko) => {
    const minuteur = setTimeout(() => ko(new Error('délai')), delaiMs);
    fetch(requete).then((r) => { clearTimeout(minuteur); ok(r); }, (e) => { clearTimeout(minuteur); ko(e); });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    if (!API_CONSERVEES.some((re) => re.test(url.pathname))) {
      e.respondWith(fetch(req).catch(horsLigneJson));
      return;
    }
    e.respondWith((async () => {
      try {
        const r = await reseau(req, 8000);
        if (r.ok) { const copie = r.clone(); caches.open(DONNEES).then((c) => c.put(req, copie)); }
        // Session terminée : on ne garde plus de données de cet utilisateur
        if (r.status === 401) caches.delete(DONNEES);
        return r;
      } catch {
        return (await caches.match(req, { cacheName: DONNEES })) || horsLigneJson();
      }
    })());
    return;
  }

  // Fichiers de l'application ; toute navigation renvoie l'application (routage par #)
  e.respondWith((async () => {
    try {
      const r = await reseau(req, 5000);
      if (r.ok && FICHIERS.includes(url.pathname)) { const copie = r.clone(); caches.open(COQUILLE).then((c) => c.put(req, copie)); }
      return r;
    } catch {
      const enCache = await caches.match(req, { cacheName: COQUILLE, ignoreSearch: true });
      if (enCache) return enCache;
      if (req.mode === 'navigate') return caches.match('/index.html', { cacheName: COQUILLE });
      return Response.error();
    }
  })());
});
