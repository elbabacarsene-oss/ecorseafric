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
  | "avenants";

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
  },
  CHEF_CHANTIER: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: A },
    affectations: { lire: A },
  },
  METREUR: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: A },
    chantiers_marche: { lire: A },
    chantiers_budget: { lire: A },
    affectations: { lire: A },
    avenants: { lire: A, creer: A, modifier: A },
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
  },
  MAGASINIER: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: A },
    affectations: { lire: A },
  },
  RESPONSABLE_QHSE: {
    entreprise: { lire: T },
    intervenants: { lire: T },
    chantiers: { lire: T },
    affectations: { lire: T },
  },
  ACHETEUR: {
    entreprise: { lire: T },
    intervenants: { lire: T, creer: T, modifier: T },
    chantiers: { lire: A },
    affectations: { lire: A },
  },
  // Portail : uniquement les chantiers où un accès portail a été explicitement accordé.
  CLIENT: { chantiers: { lire: A }, chantiers_marche: { lire: A }, avenants: { lire: A } },
  ARCHITECTE: { chantiers: { lire: A } },
  BUREAU_ETUDES: { chantiers: { lire: A } },
  BUREAU_CONTROLE: { chantiers: { lire: A } },
  SOUS_TRAITANT: { chantiers: { lire: A } },
  FOURNISSEUR: { chantiers: { lire: A } },
};

export function portee(role: Role, module: Module, action: Action): Portee | null {
  return MATRICE[role]?.[module]?.[action] ?? null;
}

export function peut(role: Role, module: Module, action: Action): boolean {
  return portee(role, module, action) !== null;
}
