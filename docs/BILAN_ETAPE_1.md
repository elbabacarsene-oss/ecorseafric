# Bilan — Étape 1 (socle)

Date : 25/10/2026

## Fonctionnalités opérationnelles

- **Authentification** : connexion e-mail + mot de passe, sessions sécurisées en base (12 h max, 2 h d'inactivité),
  verrouillage après 5 échecs, mot de passe provisoire à changer à la première connexion, déconnexion, changement de mot de passe.
- **Utilisateurs et rôles** : 12 rôles internes + 6 rôles portail ; création, modification, désactivation,
  réinitialisation du mot de passe ; lien vers une fiche intervenant.
- **Matrice des permissions** : appliquée côté serveur, consultable dans l'application (générée depuis le même code).
- **Entreprise** : raison sociale, NINEA, RCCM, coordonnées, import du logo officiel (affiché dans le menu et à la connexion).
- **Parties prenantes / clients** : 4 catégories, 32 types, codes automatiques, fiche complète (coordonnées, fonction,
  entreprise, chantiers, autorisations), recherche et filtres, modification, désactivation, journalisation.
- **Chantiers** : création, modification, fiche détaillée, 12 types de projet, 7 statuts, 8 intervenants clés,
  14 régions, GPS, dates, montant du marché, budgets, liste filtrable (texte, statut, type, région, retard).
- **Avenants** : préparation, soumission, approbation ou rejet motivé par une autre personne habilitée ;
  impact automatique sur le marché et la date de fin.
- **Affectations** : équipe et intervenants par chantier, période, ouverture/fermeture de l'accès portail.
- **Historique** : chaque création, changement de statut, avenant, affectation, note est daté et attribué.
- **Tableau de bord** : chantiers actifs / en préparation / en retard, marchés, avenants approuvés, budget global,
  marge prévisionnelle, graphique interactif de comparaison des chantiers, actions urgentes. Les indicateurs des
  modules non encore livrés affichent explicitement « Aucune donnée : module prévu à l'étape N ».
- **Portail (base)** : un client voit uniquement les chantiers ouverts pour lui, avec le montant du marché et les avenants approuvés.
- **Journal d'audit** des opérations sensibles. **Version mobile** avec menu repliable.

## Tests effectués

- 17 tests unitaires : calculs (avenants, marge, retard), formats XOF/dates Dakar, invariants de la matrice.
- 14 tests de bout en bout (navigateur réel, base PostgreSQL dédiée) :
  redirection sans session ; mauvais mot de passe ; tableau de bord vide sans chiffres fictifs ;
  création/modification d'intervenants ; création de chantiers ; **persistance après actualisation et reconnexion** ;
  filtres ; avenant avec séparation préparateur/approbateur ; **chef de chantier qui modifie l'adresse vers un
  chantier non affecté → « Page introuvable »** ; **action serveur rejouée avec le compte d'un utilisateur non
  autorisé → refusée par le serveur, aucune écriture en base** ; portail client fermé puis ouvert, sans budget ni
  marge ni données des autres intervenants ; création de compte et changement obligatoire du mot de passe ;
  compte externe sans fiche refusé ; journal d'audit ; affichage mobile sans débordement horizontal.

## Limitations restantes

- Hébergement retenu : Supabase + Vercel (guide : docs/DEPLOIEMENT.md) ; pas encore de dépôt GitHub.
- Documents, photos, planning : étape 2. Contrats de personnel/sous-traitance : étape 3.
- Indicateurs financiers (dépenses, factures, trésorerie, marge actualisée), RH, achats, QHSE : étapes 3 à 5.
- Portail : seule la consultation de chantier existe ; les espaces spécifiques architecte / BET / sous-traitant /
  fournisseur (livrables, lots, commandes) viendront avec les modules concernés.
- Mot de passe oublié : réinitialisation par l'administrateur (pas d'envoi d'e-mail tant qu'un service d'e-mail n'est pas configuré).
- Pas de double authentification (prévue en option).
- Sauvegardes automatiques : dépendent de l'hébergeur retenu ; un script pg_dump est fourni.

## Prochaines étapes

1. Choisir l'hébergement, créer le dépôt GitHub, mettre en ligne une version de recette.
2. Étape 2 : devis (bibliothèque d'ouvrages, DQE, sous-détails), budgets, planning Gantt, rapports journaliers, gestion documentaire avec versions.
