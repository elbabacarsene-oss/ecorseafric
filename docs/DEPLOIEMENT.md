# Mise en production

## Ce qu'il faut avant de commencer
| Élément | Où l'obtenir | Variable |
|---|---|---|
| Un nom de domaine (ex. `app.mondomaine.sn`) | Registrar (.sn : NIC Sénégal, ou .com) | `APP_URL` |
| Un hébergement avec PostgreSQL | Voir options ci-dessous | `DATABASE_URL` ou `POSTGRES_PASSWORD` |
| Compte **Wave Business** + clé API Checkout | Portail Wave Business → Développeurs | `WAVE_API_KEY` |
| Secret de webhook Wave | Même portail, en déclarant l'URL `https://VOTRE_DOMAINE/api/webhooks/wave` | `WAVE_WEBHOOK_SECRET` |
| Compte **Brevo** + clé API + expéditeur vérifié | brevo.com → SMTP & API → Clés API ; Expéditeurs & domaines | `BREVO_API_KEY`, `EMAIL_EXPEDITEUR` |
| Le tarif mensuel en F CFA | Votre décision | `ABONNEMENT_PRIX_MENSUEL_XOF` |

Pour Brevo, authentifiez votre domaine (enregistrements DKIM/SPF fournis par Brevo) : sans cela, les e-mails de confirmation risquent d'arriver en courrier indésirable.

## Option A — Un serveur VPS avec Docker (recommandé, coût maîtrisé)
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

## Option B — Plateforme gérée (Render, Railway, Scalingo, Clever Cloud…)
1. Créer une base PostgreSQL gérée et copier son URL de connexion dans `DATABASE_URL`.
2. Créer un service web depuis ce dépôt (Dockerfile détecté automatiquement).
3. Renseigner les variables de `.env.example` dans le tableau de bord.
4. Brancher le nom de domaine ; le HTTPS est fourni par la plateforme.
Les sauvegardes de la base sont généralement incluses ; vérifiez leur fréquence et leur durée de conservation.

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
