# Mise en production sur Vercel

L'application est déployée sur **Vercel** (fonction Node.js `api/index.js` + fichiers de `public/` servis par le CDN), avec une base **PostgreSQL Neon** branchée depuis le Marketplace Vercel. Région : **Paris (cdg1)**, la plus proche de Dakar.

## Ce qu'il faut avant de commencer
| Élément | Où l'obtenir | Variable |
|---|---|---|
| Compte Vercel **Pro** (le plan Hobby gratuit est réservé à un usage non commercial) | vercel.com → Settings → Billing | — |
| Le domaine **www.bati.com** (accès à sa zone DNS chez le registrar) | Registrar du domaine | `APP_URL` |
| Base PostgreSQL **Neon** | Vercel → Storage → Marketplace → Neon | `DATABASE_URL` (créée automatiquement) |
| Compte **Wave Business** + clé API Checkout | Portail Wave Business → Développeurs | `WAVE_API_KEY` |
| Secret de webhook Wave | Même portail, URL `https://www.bati.com/api/webhooks/wave` | `WAVE_WEBHOOK_SECRET` |
| Compte **Brevo** + clé API + expéditeur `no-reply@bati.com` | brevo.com → SMTP & API ; Expéditeurs & domaines | `BREVO_API_KEY`, `EMAIL_EXPEDITEUR` |

Le tarif (**15 000 F CFA/mois**) et l'essai (**24 h**) sont les valeurs par défaut : rien à configurer.

## 1. Le projet Vercel
Le projet est relié au dépôt GitHub : chaque envoi sur `main` met la production à jour, chaque autre branche produit un déploiement de prévisualisation. La configuration est dans `vercel.json` (aucune commande de build, sortie `public/`, réécritures vers `api/index.js`, en-têtes de sécurité, région `cdg1`). `.vercelignore` exclut les tests, la documentation et le cahier des charges.

## 2. La base de données (Neon)
1. Projet Vercel → **Storage → Create Database → Neon** (Marketplace), région **Europe (Frankfurt)**.
2. Connecter la base au projet pour **Production** et **Preview** : Vercel crée `DATABASE_URL` (connexion « poolée », chiffrée).
3. Rien d'autre : les tables sont créées automatiquement à la première requête, puis seulement quand le schéma change.

Conseil : utiliser une **branche Neon séparée** pour les prévisualisations, afin que les tests ne touchent pas les données des clients.

## 3. Variables d'environnement (Project → Settings → Environment Variables)
| Variable | Valeur | Environnements |
|---|---|---|
| `NODEJS_HELPERS` | `0` (laisse Express lire lui-même les requêtes, nécessaire au webhook Wave) | Production, Preview |
| `COOKIE_SECURE` | `1` | Production, Preview |
| `APP_URL` | `https://www.bati.com` | Production uniquement (les prévisualisations utilisent leur propre adresse) |
| `EMAIL_EXPEDITEUR` | `no-reply@bati.com` | Production, Preview |
| `BREVO_API_KEY` | clé Brevo (type « Sensitive ») | Production, Preview |
| `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET` | clés Wave (type « Sensitive ») | Production uniquement |

Après toute modification de variable, **redéployer** (Deployments → … → Redeploy).

## 4. Le domaine www.bati.com
1. Project → Settings → **Domains** → ajouter `www.bati.com` et `bati.com` (Vercel propose de rediriger l'un vers l'autre).
2. Chez le registrar, créer les enregistrements DNS **exactement tels que Vercel les affiche** (en général `CNAME www → cname.vercel-dns.com` et un enregistrement `A` pour `bati.com`).
3. Le certificat HTTPS est automatique une fois le DNS validé.

## 5. Brevo et Wave
- **Brevo** : ajouter le domaine `bati.com` (enregistrements DKIM/DMARC fournis par Brevo), créer l'expéditeur `no-reply@bati.com`, puis une clé API.
- **Wave Business** : créer la clé API Checkout et déclarer le webhook `https://www.bati.com/api/webhooks/wave`.

## Vérifications après la mise en ligne
1. `https://www.bati.com/sante` répond `{"ok":true}`.
2. Créer un espace test : l'e-mail de confirmation arrive (vérifier les indésirables).
3. « Mot de passe oublié » : l'e-mail arrive, le lien fonctionne.
4. Sur un téléphone : installer l'application, couper le réseau, pointer, rallumer le réseau : la saisie part.
5. Abonnement : faire un **vrai paiement d'un mois** avec Wave ; le statut passe à « Abonnement actif ». Dans le portail Wave, vérifier que le webhook est livré (code 200).

## Particularités de Vercel prises en compte dans le code
- **Plusieurs instances en parallèle** : les limites anti-abus (connexions, inscriptions, mots de passe oubliés) sont stockées dans PostgreSQL, pas en mémoire.
- **Pooler de connexions Neon** : le schéma est appliqué sous verrou *de transaction* ; 3 connexions par instance.
- **Adresse IP des visiteurs** : lue dans `X-Forwarded-For`, que Vercel réécrit (pas de falsification possible).
- **Démarrage à froid** : l'application s'initialise une fois par instance ; si la base est injoignable, la réponse est un 503 explicite et l'initialisation est retentée à la requête suivante.

## Autre option : serveur avec Docker
`Dockerfile` et `docker-compose.yml` (application + PostgreSQL) restent disponibles pour un serveur classique : `cp .env.example .env`, compléter, puis `docker compose up -d --build`, avec un proxy HTTPS (Caddy) devant le port 3000.
