// Matrice des permissions — source unique de vérité.
// Elle est appliquée côté serveur (pages, actions serveur, requêtes) et affichée telle quelle
// dans Administration › Matrice des permissions.
import type { Role } from "@prisma/client";

export type Module =
  | "tableau_de_bord"
  | "entreprise"
  | "utilisateurs"
  | "journal"
  | "intervenants"
  | "chantiers"
  | "chantiers_marche" // montant du marché et avenants approuvés
  | "chantiers_budget" // budgets, marges : données internes confidentielles
  | "affectations"
  | "avenants"
  // Étape 2
  | "devis"
  | "devis_couts" // déboursés secs, frais, marges des devis : données internes confidentielles
  | "bibliotheque"
  | "budgets"
  | "planning"
  | "rapports"
  | "documents";

export type Action = "lire" | "creer" | "modifier" | "supprimer" | "approuver";

/** « tous » : tous les enregistrements ; « affectes » : seulement les chantiers où l'utilisateur est affecté. */
export type Portee = "tous" | "affectes";

type Droits = Partial<Record<Module, Partial<Record<Action, Portee>>>>;

export const MODULES: Record<Module, string> = {
  tableau_de_bord: "Tableau de bord",
  entreprise: "Paramètres de l'entreprise",
  utilisateurs: "Utilisateurs et rôles",
  journal: "Journal d'audit",
  intervenants: "Parties prenantes",
  chantiers: "Chantiers",
  chantiers_marche: "Montants du marché",
  chantiers_budget: "Budgets et marges",
  affectations: "Affectations aux chantiers",
  avenants: "Avenants",
  devis: "Devis",
  devis_couts: "Déboursés et marges des devis",
  bibliotheque: "Bibliothèque d'ouvrages",
  budgets: "Budgets détaillés",
  planning: "Planning",
  rapports: "Rapports journaliers",
  documents: "Documents",
};

export const ACTIONS: Record<Action, string> = {
  lire: "Consulter",
  creer: "Créer",
  modifier: "Modifier",
  supprimer: "Supprimer / désactiver",
  approuver: "Approuver",
};

const T = "tous" as const;
const A = "affectes" as const;
const tout = (p: Portee) => ({ lire: p, creer: p, modifier: p, supprimer: p });
const toutEtApprouver = (p: Portee) => ({ ...tout(p), approuver: p });
const lcm = (p: Portee) => ({ lire: p, creer: p, modifier: p });

export const MATRICE: Record<Role, Droits> = {
  ADMIN: {
    tableau_de_bord: { lire: T },
    entreprise: { lire: T, modifier: T },
    utilisateurs: tout(T),
    journal: { lire: T },
    intervenants: tout(T),
    chantiers: tout(T),
    chantiers_marche: { lire: T, modifier: T },
    chantiers_budget: { lire: T, modifier: T },
    affectations: tout(T),
    avenants: { lire: T },
    devis: tout(T),
    devis_couts: { lire: T },
    bibliotheque: tout(T),
    budgets: lcm(T),
    planning: tout(T),
    rapports: { lire: T },
    documents: tout(T),
  },
  DIRECTEUR_GENERAL: {
    tableau_de_bord: { lire: T },
    entreprise: { lire: T, modifier: T },
    utilisateurs: { lire: T },
    journal: { lire: T },
    intervenants: tout(T),
    chantiers: tout(T),
    chantiers_marche: { lire: T, modifier: T },
    chantiers_budget: { lire: T, modifier: T },
    affectations: tout(T),
    avenants: { lire: T, creer: T, modifier: T, approuver: T },
    devis: toutEtApprouver(T),
    devis_couts: { lire: T },
    bibliotheque: tout(T),
    budgets: { ...lcm(T), approuver: T },
    planning: tout(T),
    rapports: { lire: T, approuver: T },
    documents: toutEtApprouver(T),
  },
  DIRECTEUR_TECHNIQUE: {
    tableau_de_bord: { lire: T },
    entreprise: { lire: T },
    intervenants: { lire: T, creer: T, modifier: T },
    chantiers: { lire: T, creer: T, modifier: T },
    chantiers_marche: { lire: T, modifier: T },
    chantiers_budget: { lire: T, modifier: T },
    affectations: tout(T),
    avenants: { lire: T, creer: T, modifier: T, approuver: T },
    devis: toutEtApprouver(T),
    devis_couts: { lire: T },
    bibliotheque: tout(T),
    budgets: { ...lcm(T), approuver: T },
    planning: tout(T),
    rapports: { lire: T, creer: T, modifier: T, approuver: T },
    documents: toutEtApprouver(T),
  },
  DIRECTEUR_FINANCIER: {
    tableau_de_bord: { lire: T },
    entreprise: { lire: T },
    journal: { lire: T },
    intervenants: { lire: T, creer: T, modifier: T },
    chantiers: { lire: T },
    chantiers_marche: { lire: T, modifier: T },
    chantiers_budget: { lire: T, modifier: T },
    affectations: { lire: T },
    avenants: { lire: T, approuver: T },
    devis: { lire: T, approuver: T },
    devis_couts: { lire: T },
    bibliotheque: { lire: T },
    budgets: { lire: T, approuver: T },
    planning: { lire: T },
    rapports: { lire: T },
    documents: { lire: T, creer: T, modifier: T },
  },
  CHEF_PROJET: {
    tableau_de_bord: { lire: A },
    entreprise: { lire: T },
    intervenants: { lire: T, creer: T, modifier: T },
    chantiers: { lire: A, modifier: A },
    chantiers_marche: { lire: A },
    chantiers_budget: { lire: A },
    affectations: { lire: A, creer: A, supprimer: A },
    avenants: { lire: A, creer: A, modifier: A },
    devis: lcm(A),
    devis_couts: { lire: A },
    bibliotheque: { lire: T },
    budgets: lcm(A),
    planning: tout(A),
    rapports: { ...lcm(A), approuver: A },
    documents: { ...lcm(A), approuver: A },
  },
  CONDUCTEUR_TRAVAUX: {
    tableau_de_bord: { lire: A },
    entreprise: { lire: T },
    intervenants: { lire: T, creer: T },
    chantiers: { lire: A, modifier: A },
    chantiers_marche: { lire: A },
    chantiers_budget: { lire: A },
    affectations: { lire: A, creer: A },
    avenants: { lire: A, creer: A, modifier: A },
    devis: { lire: A },
    devis_couts: { lire: A },
    bibliotheque: { lire: T },
    budgets: lcm(A),
    planning: tout(A),
    rapports: { ...lcm(A), approuver: A },
    documents: lcm(A),
  },
  CHEF_CHANTIER: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: A },
    affectations: { lire: A },
    planning: { lire: A },
    rapports: lcm(A),
    documents: { lire: A, creer: A },
  },
  METREUR: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: A },
    chantiers_marche: { lire: A },
    chantiers_budget: { lire: A },
    affectations: { lire: A },
    avenants: { lire: A, creer: A, modifier: A },
    devis: lcm(T),
    devis_couts: { lire: T },
    bibliotheque: tout(T),
    budgets: lcm(A),
    planning: { lire: A },
    rapports: { lire: A },
    documents: { lire: A, creer: A },
  },
  COMPTABLE: {
    tableau_de_bord: { lire: T },
    entreprise: { lire: T },
    intervenants: { lire: T, creer: T, modifier: T },
    chantiers: { lire: T },
    chantiers_marche: { lire: T },
    chantiers_budget: { lire: T },
    affectations: { lire: T },
    avenants: { lire: T },
    devis: { lire: T },
    devis_couts: { lire: T },
    budgets: { lire: T },
    documents: { lire: T, creer: T },
  },
  MAGASINIER: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: A },
    affectations: { lire: A },
    planning: { lire: A },
    rapports: { lire: A },
    documents: { lire: A },
  },
  RESPONSABLE_QHSE: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: T },
    affectations: { lire: T },
    planning: { lire: T },
    rapports: { lire: T },
    documents: { lire: T, creer: T },
  },
  ACHETEUR: {
    entreprise: { lire: T },
    intervenants: { lire: T, creer: T, modifier: T },
    chantiers: { lire: A },
    affectations: { lire: A },
    bibliotheque: { lire: T },
    planning: { lire: A },
    documents: { lire: A, creer: A },
  },
  // Portail : uniquement les chantiers où un accès portail a été explicitement accordé.
  // Documents : uniquement ceux explicitement partagés avec leur rôle, dans leur version en vigueur.
  CLIENT: { chantiers: { lire: A }, chantiers_marche: { lire: A }, avenants: { lire: A }, documents: { lire: A } },
  ARCHITECTE: { chantiers: { lire: A }, documents: { lire: A } },
  BUREAU_ETUDES: { chantiers: { lire: A }, documents: { lire: A } },
  BUREAU_CONTROLE: { chantiers: { lire: A }, documents: { lire: A } },
  SOUS_TRAITANT: { chantiers: { lire: A }, documents: { lire: A } },
  FOURNISSEUR: { chantiers: { lire: A }, documents: { lire: A } },
};

export function portee(role: Role, module: Module, action: Action): Portee | null {
  return MATRICE[role]?.[module]?.[action] ?? null;
}

export function peut(role: Role, module: Module, action: Action): boolean {
  return portee(role, module, action) !== null;
}
