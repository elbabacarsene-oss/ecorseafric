# Mise en ligne : Supabase (base de données) + Vercel (application)

Vous créez les comptes et saisissez vous-même les secrets : ils ne transitent jamais par le code ni par la conversation.

## 1. Supabase (base PostgreSQL)
1. Créer un compte sur https://supabase.com puis **New project** : nom `ecorse-btp`, région la plus proche
   (ex. *West EU (Paris)* ou *Frankfurt*), mot de passe de base **fort** à conserver dans un coffre.
2. Projet › **Connect** : copier deux chaînes de connexion :
   - *Transaction pooler* (port **6543**) → `DATABASE_URL`, en ajoutant `?pgbouncer=true&connection_limit=1` ;
   - *Session pooler* (port **5432**) → `DIRECT_URL`.
3. Plan payant recommandé en production : sauvegardes quotidiennes et restauration à un instant donné (PITR).

L'application n'utilise pas l'API publique Supabase ni la clé `anon` : tout passe par le serveur.
Par précaution, laisser la RLS activée sur les tables (Supabase la propose) sans créer de politique,
ce qui ferme l'accès via l'API publique ; Prisma se connecte avec le rôle propriétaire et n'est pas concerné.

## 2. Vercel (application)
1. Créer un compte sur https://vercel.com avec votre compte GitHub.
2. **Add New › Project** : importer le dépôt GitHub du projet. Framework détecté : Next.js.
3. **Environment Variables** : ajouter `DATABASE_URL` et `DIRECT_URL` (valeurs de l'étape 1).
4. **Deploy**. Le script `vercel-build` applique automatiquement les migrations puis construit l'application.
5. Région des fonctions (Settings › Functions) : la même que Supabase.

## 3. Premier administrateur
Depuis un ordinateur avec Node.js, une seule fois :
```bash
DATABASE_URL="<DIRECT_URL>" DIRECT_URL="<DIRECT_URL>" npm run creer-admin -- admin@ecorse-afric.sn "Prénom" "Nom"
```
Le mot de passe provisoire s'affiche ; il devra être changé à la première connexion.

## 4. Domaine
Vercel › Settings › Domains : ajouter par exemple `erp.ecorse-afric.sn` et suivre les instructions DNS. HTTPS est automatique.
