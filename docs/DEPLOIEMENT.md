# Mise en production

## Ce qu'il faut avant de commencer
| Élément | Où l'obtenir | Variable |
|---|---|---|
| Le domaine **www.bati.com** (accès à sa zone DNS chez le registrar) | Registrar du domaine | `APP_URL` (déjà configuré) |
| Un compte **Render** | render.com | fourni par la plateforme |
| Compte **Wave Business** + clé API Checkout | Portail Wave Business → Développeurs | `WAVE_API_KEY` |
| Secret de webhook Wave | Même portail, en déclarant l'URL `https://VOTRE_DOMAINE/api/webhooks/wave` | `WAVE_WEBHOOK_SECRET` |
| Compte **Brevo** + clé API + expéditeur vérifié | brevo.com → SMTP & API → Clés API ; Expéditeurs & domaines | `BREVO_API_KEY`, `EMAIL_EXPEDITEUR` |
| Tarif mensuel : **15 000 F CFA** (déjà configuré) | — | `ABONNEMENT_PRIX_MENSUEL_XOF` |

Pour Brevo, authentifiez votre domaine (enregistrements DKIM/SPF fournis par Brevo) : sans cela, les e-mails de confirmation risquent d'arriver en courrier indésirable.

## Option retenue — Render, domaine www.bati.com
Le fichier `render.yaml` décrit tout : le service web (construit depuis le `Dockerfile`) et la base PostgreSQL, en région **Francfort**. L'adresse `https://www.bati.com`, l'expéditeur `no-reply@bati.com`, le tarif (15 000 F CFA/mois) et l'essai (24 h) sont déjà renseignés.

### 1. Déployer
1. Sur render.com, connecter le compte GitHub qui contient ce dépôt (Account Settings → GitHub).
2. **New → Blueprint**, choisir ce dépôt et la branche à déployer. Render lit `render.yaml`.
3. Render demande les 3 secrets : `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET`, `BREVO_API_KEY`. S'ils ne sont pas encore prêts, laisser vide et les ajouter plus tard (service → Environment) : l'application démarre quand même, sans paiement ni envoi d'e-mails.
4. Choisir les plans payants proposés (voir « Plans » ci-dessous) et valider. Render crée la base, construit l'image et démarre l'application ; les tables sont créées au premier démarrage.
5. Vérifier `https://btp-manager.onrender.com/sante` (le nom exact est affiché par Render) : réponse `{"ok":true}`.

### 2. Brancher www.bati.com
1. Dans le service `btp-manager` → **Settings → Custom Domains** → ajouter `www.bati.com` (et `bati.com`, pour que l'adresse sans « www » redirige vers le site).
2. Chez le registrar du domaine, créer les enregistrements DNS **exactement tels que Render les affiche** : en général un `CNAME` pour `www` vers l'adresse `….onrender.com`, et un enregistrement `A` (ou `ALIAS`) pour `bati.com`.
3. Attendre que Render affiche « Verified » et « Certificate issued » (de quelques minutes à quelques heures selon le DNS).
Tant que le domaine n'est pas actif, les liens des e-mails et le retour de Wave pointent vers www.bati.com et ne fonctionnent pas : faire les tests après cette étape.

### 3. E-mails (Brevo)
1. Créer le compte Brevo, puis **Expéditeurs, domaines et IP dédiées → Domaines → ajouter bati.com**.
2. Ajouter chez le registrar les enregistrements DNS donnés par Brevo (code Brevo, DKIM, DMARC) et attendre la validation.
3. Créer l'expéditeur `no-reply@bati.com`, puis une clé API (**SMTP & API → Clés API**) à coller dans `BREVO_API_KEY` sur Render.

### 4. Paiements (Wave)
1. Dans le portail **Wave Business → Développeurs**, créer une clé API Checkout → `WAVE_API_KEY` sur Render.
2. Déclarer le webhook `https://www.bati.com/api/webhooks/wave` (événements de session de paiement) et recopier son secret → `WAVE_WEBHOOK_SECRET`.

Plans : `render.yaml` utilise les plans payants d'entrée de gamme (`starter` pour l'application, `basic-256mb` pour la base). L'offre gratuite ne convient pas : l'application s'y met en veille (paiements et première visite très lents) et la base gratuite est supprimée au bout de quelques semaines. Si Render refuse un nom de plan à l'import, choisir l'équivalent dans la liste proposée. Les sauvegardes de la base sont incluses dans les plans payants (vérifier leur durée de conservation dans l'onglet de la base).

## Autres plateformes gérées
**Railway** (`railway.json`) : New Project → Deploy from GitHub repo ; ajouter un service **PostgreSQL** au projet ; dans les variables du service web, référencer la base (`DATABASE_URL=${{Postgres.DATABASE_URL}}`) et ajouter les variables de `.env.example`. Generate Domain (ou domaine personnalisé), puis renseigner `APP_URL`.

**Scalingo** (hébergeur français, `Procfile`) : créer l'application depuis le dépôt (buildpack Node.js détecté), ajouter l'addon **PostgreSQL** (il fournit `SCALINGO_POSTGRESQL_URL`, lu automatiquement), ajouter les variables de `.env.example`. Si la base exige une connexion chiffrée, ajouter `DATABASE_SSL=no-verify`.

Sur toutes les plateformes : `PORT` est fourni par l'hébergeur, ne pas le définir. La vraie adresse IP des visiteurs est lue derrière le proxy de l'hébergeur (réglage `TRUST_PROXY`, rien à changer).

## Option sur serveur dédié — VPS avec Docker
Tout fournisseur convient (Hetzner, OVHcloud, DigitalOcean…). 2 Go de RAM suffisent pour démarrer.

```bash
git clone <ce dépôt> && cd ecorseafric
cp .env.example .env && nano .env          # compléter toutes les valeurs
docker compose up -d --build
docker compose logs -f app                 # « serveur démarré » doit apparaître
```
L'application écoute sur `127.0.0.1:3000`. Mettez un proxy HTTPS devant, par exemple **Caddy** (certificat Let's Encrypt automatique) — fichier `/etc/caddy/Caddyfile` :
```
app.mondomaine.sn {
    reverse_proxy 127.0.0.1:3000
}
```

**Sauvegardes** (indispensable) — tâche planifiée quotidienne :
```bash
docker compose exec -T db pg_dump -U btp -Fc btp > sauvegarde_$(date +%F).dump
# Restauration : docker compose exec -T db pg_restore -U btp -d btp --clean < sauvegarde_AAAA-MM-JJ.dump
```
Copiez ces fichiers hors du serveur (stockage objet, autre machine).

## Après le premier déploiement — vérifications
1. `https://VOTRE_DOMAINE/sante` répond `{"ok":true}`.
2. Créer un espace test : l'e-mail de confirmation arrive (vérifier les indésirables).
3. « Mot de passe oublié » : l'e-mail arrive, le lien fonctionne.
4. Abonnement : faire un **vrai paiement d'un mois** avec Wave, vérifier le retour sur l'application et le statut « Abonnement actif ».
5. Dans le portail Wave, vérifier que le webhook est livré avec succès (code 200).

## Mises à jour
```bash
git pull && docker compose up -d --build
```
Le schéma de base est créé ou complété automatiquement au démarrage.
