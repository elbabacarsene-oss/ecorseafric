# Bilan — Étape 2 (devis, budgets, planning, rapports journaliers, documents)

Date : 26/10/2026

## Fonctionnalités opérationnelles

- **Bibliothèque d'ouvrages** : code, catégorie, unité, sous-détail par composant (matériaux, main-d'œuvre, matériel,
  sous-traitance, transport, divers) ; déboursé sec unitaire calculé ; recherche et filtres ; désactivation.
- **Devis** (numérotation `DV-AAAA-NNN`) :
  - DQE/BPU par lot : lignes issues de la bibliothèque (le sous-détail est recopié), saisies librement, ou **importées**
    depuis un tableau de quantités CSV ou Excel ; chaque quantité importée doit être **vérifiée par une personne**
    avant que le devis puisse être soumis ;
  - sous-détail modifiable ligne par ligne, prix imposé possible ;
  - frais de chantier, frais généraux, marge, coefficient de vente, coût de revient, total HT, TVA (18 % par défaut), TTC,
    sous-totaux par lot ;
  - circuit : brouillon → soumis → validé en interne (**par une autre personne que le préparateur**) → envoyé →
    accepté ou refusé ; nouvelle **version** (l'ancienne devient « remplacée », lecture seule) et **variantes** A, B… ;
  - **export PDF** pour le client (sans coûts internes, montant en lettres, filigrane « projet » tant que non validé)
    et **export Excel** avec formules (coûts visibles seulement pour les rôles autorisés) ;
  - plans et documents rattachés au devis.
- **Transformation d'un devis accepté en chantier** : création du chantier (marché = total HT, fin contractuelle selon
  le délai, client affecté) ou rattachement à un chantier existant ; les lignes, prix, conditions et documents du
  devis sont conservés et le budget détaillé est initialisé avec le coût de revient.
- **Budgets** : budget détaillé par lot et par poste ; soumission puis validation par la direction (séparation des
  tâches) ; après validation, le budget initial est **figé** et toute révision exige un **motif** tracé dans
  l'historique du chantier ; écarts, alertes de dépassement, graphique par poste, vue consolidée tous chantiers.
- **Planning** :
  - tâches, sous-tâches (dates du parent calculées), jalons, lot, corps d'état, équipe, responsable interne,
    exécutant externe, tâches « importantes » ;
  - dépendances fin → début avec décalage, refus des boucles, détection des enchaînements non respectés et
    recalcul automatique sur demande ;
  - **chemin critique** et marge de chaque tâche ;
  - **planning de référence** figé, comparé au planning actuel (écarts en jours, barres grises sur le Gantt) ;
  - **Gantt** interactif (jours / semaines / mois, chemin critique seul, filtres par lot, corps d'état, équipe,
    intervenant), ligne « aujourd'hui » et fin contractuelle ;
  - retards et tâches non démarrées signalés ; les tâches importantes en retard remontent dans les actions urgentes
    du tableau de bord.
- **Rapports journaliers** (un par chantier et par jour), formulaire pensé pour smartphone : météo, effectif par
  spécialité et heures, quantités exécutées avec avancement d'une tâche du planning, matériaux consommés et livrés,
  matériel, incidents, difficultés, instructions, observations, **photos** (compressées sur le téléphone avant envoi) ;
  soumission, validation par un autre responsable (l'avancement est alors **reporté sur le planning**, une empreinte
  SHA-256 scelle le contenu, le rapport n'est plus modifiable) ; **PDF** avec photos ; historique filtrable.
- **Documents** : dépôt rattaché à un chantier, un devis ou un rapport ; catégories ; **versions** avec indice et
  commentaire ; dates de validité (alerte d'expiration à 15 jours sur le tableau de bord) ; plans, contrats, marchés et
  PV à **approuver par une autre personne** ; un plan remplacé reste consultable mais son PDF est **tamponné
  « version remplacée — ne pas utiliser »** et son nom suffixé `_REMPLACE` ; jamais présenté comme approuvé ;
  partage sur le portail par rôle (client, architecte, BET…) limité à la version en vigueur ; contrôle du type réel des
  fichiers (un fichier HTML renommé en .pdf est refusé) ; 4 Mo par fichier ; chaque téléchargement est journalisé.
- **Intégration** : fiche chantier avec volets Budget, Planning, Rapports, documents et photos ; menu « Études et
  budgets » ; nouveaux indicateurs et actions urgentes sur le tableau de bord (devis, budgets, rapports, versions à
  valider ; tâches importantes en retard ; documents expirés ou expirant).
- **Correctif transverse** : quand le serveur refuse un formulaire (format de fichier, champ manquant…), la saisie
  est désormais **conservée** pour être corrigée, au lieu d'être effacée.

## Tests effectués

- **54 tests unitaires** : prix de vente, totaux de devis, budget issu d'un devis (arrondis), chemin critique, jalons,
  boucles, retards, écarts à la référence, lecture des tableaux de quantités (unités, nombres à la française),
  montants en lettres, détection des types de fichiers, matrice des permissions.
- **23 tests de bout en bout** (navigateur réel, base PostgreSQL dédiée) : les 14 du socle, plus un scénario complet :
  1. le DT crée un ouvrage de bibliothèque avec sous-détail : déboursé sec 54 350 F CFA/m³ ;
  2. le métreur crée un devis (ligne de bibliothèque, ligne libre, **import CSV**) ; la soumission est **refusée** tant
     que les quantités importées ne sont pas vérifiées ; les totaux affichés sont égaux à un calcul indépendant ;
     le métreur **ne peut pas valider** son devis, le DT le valide ;
  3. PDF (`%PDF`) et Excel téléchargés ; envoi, acceptation ; le métreur ne peut pas créer le chantier ;
  4. le DT transforme le devis en chantier : marché = total HT, budget = coût de revient, fin contractuelle correcte ;
     le DT ne peut pas valider le budget qu'il a préparé ;
  5. le DG valide le budget ; une révision motivée laisse le budget initial inchangé et apparaît dans l'historique ;
  6. le conducteur planifie : enchaînement non respecté détecté, recalcul (durée conservée), référence figée,
     chemin critique, retard de 10 jours ; la tâche importante en retard apparaît sur le tableau de bord du DT ;
  7. le chef de chantier saisit un rapport **sur smartphone** (sans débordement horizontal) avec photo ; un second
     rapport le même jour est refusé ; le conducteur valide : empreinte, rapport verrouillé, tâche passée à 100 %,
     retard levé, PDF généré ;
  8. documents : fichier HTML déguisé en PDF refusé (saisie conservée) ; fichier de plus de 4 Mo refusé avec message
     clair, fichier de 3,5 Mo accepté ; plan indice A approuvé par le DT seulement (le déposant ne peut pas) ;
     invisible du client tant qu'il n'est pas approuvé ; indice B approuvé → A « remplacée », téléchargée tamponnée
     avec le suffixe `_REMPLACE` ; le client n'obtient que l'indice B (A → 404) ;
  9. cloisonnement : un métreur non affecté obtient « Page introuvable » sur le planning et le budget d'un autre
     chantier ; le chef de chantier n'a pas accès aux budgets ; le journal d'audit trace import, vérification,
     transformation, révision et recalcul.
- Contrôle visuel des écrans principaux sur ordinateur et smartphone (captures).

## Limitations restantes

- **Alertes** : affichées dans l'application (tableau de bord, fiches) ; pas encore d'envoi par e-mail ni SMS (étape 6).
- **Fichiers** stockés dans la base de données, 4 Mo maximum (limite des requêtes sur Vercel). Pour des plans plus
  lourds, brancher un stockage objet (ex. Supabase Storage) : prévu comme évolution, la structure le permet.
- **Gantt** : modification par formulaire, pas de glisser-déposer des barres ; dépendances fin → début uniquement
  (pas de début → début ni fin → fin) ; durées en jours calendaires (pas de calendrier ouvré ni de jours fériés).
- **Import de quantités** : CSV et Excel. La lecture automatique de plans (PDF/DWG) n'est pas faite : l'analyse
  assistée par IA est prévue à l'étape 6 ; dans tous les cas, une personne vérifie chaque quantité.
- **Budgets** : comparaison au réel (dépenses engagées et payées) à l'étape 4 (module financier).
- Rapports journaliers : saisie en ligne ; pas de mode hors connexion.
- Toujours pas de dépôt GitHub ni de mise en ligne (voir docs/DEPLOIEMENT.md).

## Prochaines étapes

1. Créer le dépôt GitHub et une version de recette en ligne (Supabase + Vercel) pour essai par les équipes.
2. Saisir la bibliothèque d'ouvrages réelle de l'entreprise (ou fournir un fichier à importer).
3. Étape 3 : ressources humaines, contrats de personnel et de sous-traitance, achats (selon le cahier des charges).
