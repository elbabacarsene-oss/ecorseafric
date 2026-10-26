import type {
  CategorieDocument, CategorieOuvrage, Meteo, OrigineLigne, PosteBudget, StatutBudget, StatutDevis, StatutRapport,
  StatutVersion, TypeComposant, Unite,
  CategorieIntervenant,
  Region,
  Role,
  StatutAvenant,
  StatutChantier,
  TypeIntervenant,
  TypeProjet,
} from "@prisma/client";

export const ROLES: Record<Role, string> = {
  ADMIN: "Administrateur système",
  DIRECTEUR_GENERAL: "Directeur général",
  DIRECTEUR_TECHNIQUE: "Directeur technique",
  DIRECTEUR_FINANCIER: "Directeur financier",
  CHEF_PROJET: "Chef de projet",
  CONDUCTEUR_TRAVAUX: "Conducteur de travaux",
  CHEF_CHANTIER: "Chef de chantier",
  METREUR: "Métreur",
  COMPTABLE: "Comptable",
  MAGASINIER: "Magasinier",
  RESPONSABLE_QHSE: "Responsable QHSE",
  ACHETEUR: "Acheteur",
  CLIENT: "Client (portail)",
  ARCHITECTE: "Architecte (portail)",
  BUREAU_ETUDES: "Bureau d'études (portail)",
  BUREAU_CONTROLE: "Bureau de contrôle (portail)",
  SOUS_TRAITANT: "Sous-traitant (portail)",
  FOURNISSEUR: "Fournisseur (portail)",
};

export const ROLES_EXTERNES: Role[] = ["CLIENT", "ARCHITECTE", "BUREAU_ETUDES", "BUREAU_CONTROLE", "SOUS_TRAITANT", "FOURNISSEUR"];
export const estExterne = (r: Role) => ROLES_EXTERNES.includes(r);

export const CATEGORIES: Record<CategorieIntervenant, string> = {
  MAITRISE_OUVRAGE: "Maîtrise d'ouvrage",
  MAITRISE_OEUVRE: "Maîtrise d'œuvre",
  PERSONNEL_INTERNE: "Personnel interne",
  INTERVENANT_EXTERNE: "Intervenants externes",
};

export const TYPES_PAR_CATEGORIE: Record<CategorieIntervenant, TypeIntervenant[]> = {
  MAITRISE_OUVRAGE: ["CLIENT_PARTICULIER", "PROMOTEUR", "ENTREPRISE", "ADMINISTRATION", "INVESTISSEUR"],
  MAITRISE_OEUVRE: ["ARCHITECTE", "INGENIEUR", "BUREAU_ETUDES", "ECONOMISTE", "GEOMETRE", "LABORATOIRE", "BUREAU_CONTROLE"],
  PERSONNEL_INTERNE: [
    "DIRECTEUR", "DIRECTEUR_TECHNIQUE", "DIRECTEUR_FINANCIER", "CONDUCTEUR_TRAVAUX", "CHEF_PROJET", "CHEF_CHANTIER",
    "METREUR", "COMPTABLE", "MAGASINIER", "RESPONSABLE_QHSE", "ACHETEUR", "OUVRIER",
  ],
  INTERVENANT_EXTERNE: ["SOUS_TRAITANT", "FOURNISSEUR", "LOUEUR_MATERIEL", "TRANSPORTEUR", "CONSULTANT", "ASSUREUR", "BANQUE", "ORGANISME_CONTROLE"],
};

export const TYPES_INTERVENANT: Record<TypeIntervenant, string> = {
  CLIENT_PARTICULIER: "Client particulier",
  PROMOTEUR: "Promoteur",
  ENTREPRISE: "Entreprise",
  ADMINISTRATION: "Administration",
  INVESTISSEUR: "Investisseur",
  ARCHITECTE: "Architecte",
  INGENIEUR: "Ingénieur",
  BUREAU_ETUDES: "Bureau d'études",
  ECONOMISTE: "Économiste",
  GEOMETRE: "Géomètre",
  LABORATOIRE: "Laboratoire",
  BUREAU_CONTROLE: "Bureau de contrôle",
  DIRECTEUR: "Directeur",
  DIRECTEUR_TECHNIQUE: "Directeur technique",
  DIRECTEUR_FINANCIER: "Directeur financier",
  CONDUCTEUR_TRAVAUX: "Conducteur de travaux",
  CHEF_PROJET: "Chef de projet",
  CHEF_CHANTIER: "Chef de chantier",
  METREUR: "Métreur",
  COMPTABLE: "Comptable",
  MAGASINIER: "Magasinier",
  RESPONSABLE_QHSE: "Responsable QHSE",
  ACHETEUR: "Acheteur",
  OUVRIER: "Ouvrier",
  SOUS_TRAITANT: "Sous-traitant",
  FOURNISSEUR: "Fournisseur",
  LOUEUR_MATERIEL: "Loueur de matériel",
  TRANSPORTEUR: "Transporteur",
  CONSULTANT: "Consultant",
  ASSUREUR: "Assureur",
  BANQUE: "Banque",
  ORGANISME_CONTROLE: "Organisme de contrôle",
};

export const categorieDuType = (t: TypeIntervenant): CategorieIntervenant =>
  (Object.keys(TYPES_PAR_CATEGORIE) as CategorieIntervenant[]).find((c) => TYPES_PAR_CATEGORIE[c].includes(t))!;

export const PREFIXE_CODE: Record<CategorieIntervenant, string> = {
  MAITRISE_OUVRAGE: "MOA",
  MAITRISE_OEUVRE: "MOE",
  PERSONNEL_INTERNE: "INT",
  INTERVENANT_EXTERNE: "EXT",
};

export const TYPES_PROJET: Record<TypeProjet, string> = {
  BATIMENT: "Bâtiment",
  IMMEUBLE: "Immeuble",
  MAISON: "Maison",
  ROUTE: "Route",
  TERRASSEMENT: "Terrassement",
  ASSAINISSEMENT: "Assainissement",
  VRD: "VRD",
  CLOTURE: "Clôture",
  REHABILITATION: "Réhabilitation",
  DEMOLITION: "Démolition",
  GENIE_CIVIL: "Génie civil",
  AMENAGEMENT_EXTERIEUR: "Aménagements extérieurs",
};

export const STATUTS_CHANTIER: Record<StatutChantier, string> = {
  EN_PREPARATION: "En préparation",
  EN_COURS: "En cours",
  SUSPENDU: "Suspendu",
  RECEPTION_PROVISOIRE: "Réception provisoire",
  RECEPTION_DEFINITIVE: "Réception définitive",
  CLOTURE: "Clôturé",
  ANNULE: "Annulé",
};

export const COULEUR_STATUT: Record<StatutChantier, string> = {
  EN_PREPARATION: "bg-sky-100 text-sky-800",
  EN_COURS: "bg-emerald-100 text-emerald-800",
  SUSPENDU: "bg-amber-100 text-amber-800",
  RECEPTION_PROVISOIRE: "bg-indigo-100 text-indigo-800",
  RECEPTION_DEFINITIVE: "bg-violet-100 text-violet-800",
  CLOTURE: "bg-slate-200 text-slate-700",
  ANNULE: "bg-rose-100 text-rose-800",
};

export const STATUTS_AVENANT: Record<StatutAvenant, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis à approbation",
  APPROUVE: "Approuvé",
  REJETE: "Rejeté",
};

export const REGIONS: Record<Region, string> = {
  DAKAR: "Dakar",
  DIOURBEL: "Diourbel",
  FATICK: "Fatick",
  KAFFRINE: "Kaffrine",
  KAOLACK: "Kaolack",
  KEDOUGOU: "Kédougou",
  KOLDA: "Kolda",
  LOUGA: "Louga",
  MATAM: "Matam",
  SAINT_LOUIS: "Saint-Louis",
  SEDHIOU: "Sédhiou",
  TAMBACOUNDA: "Tambacounda",
  THIES: "Thiès",
  ZIGUINCHOR: "Ziguinchor",
};

// ═════════════ Étape 2 ═════════════

export const UNITES: Record<Unite, string> = {
  M: "m", M2: "m²", M3: "m³", KG: "kg", TONNE: "t", U: "u", FORFAIT: "ft", HEURE: "h", JOUR: "j",
};
export const UNITES_LONG: Record<Unite, string> = {
  M: "mètre (m)", M2: "mètre carré (m²)", M3: "mètre cube (m³)", KG: "kilogramme (kg)", TONNE: "tonne (t)",
  U: "unité (u)", FORFAIT: "forfait (ft)", HEURE: "heure (h)", JOUR: "jour (j)",
};

export const CATEGORIES_OUVRAGE: Record<CategorieOuvrage, string> = {
  TERRASSEMENT: "Terrassement",
  FONDATIONS: "Fondations",
  BETON_ARME: "Béton armé",
  MACONNERIE: "Maçonnerie",
  ETANCHEITE: "Étanchéité",
  CHARPENTE: "Charpente",
  COUVERTURE: "Couverture",
  ELECTRICITE: "Électricité",
  PLOMBERIE: "Plomberie",
  CLIMATISATION: "Climatisation",
  MENUISERIE: "Menuiserie",
  REVETEMENTS: "Revêtements",
  PEINTURE: "Peinture",
  VRD: "VRD",
  ASSAINISSEMENT: "Assainissement",
  AMENAGEMENTS_EXTERIEURS: "Aménagements extérieurs",
};

export const TYPES_COMPOSANT: Record<TypeComposant, string> = {
  MATERIAU: "Matériau",
  MAIN_OEUVRE: "Main-d'œuvre",
  MATERIEL: "Matériel",
  SOUS_TRAITANCE: "Sous-traitance",
  AUTRE: "Autre",
};

export const STATUTS_DEVIS: Record<StatutDevis, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis à validation",
  VALIDE: "Validé en interne",
  ENVOYE: "Envoyé au client",
  ACCEPTE: "Accepté",
  REFUSE: "Refusé",
  REMPLACE: "Remplacé (version antérieure)",
};
export const COULEUR_DEVIS: Record<StatutDevis, string> = {
  BROUILLON: "bg-slate-100 text-slate-700",
  SOUMIS: "bg-amber-100 text-amber-800",
  VALIDE: "bg-sky-100 text-sky-800",
  ENVOYE: "bg-indigo-100 text-indigo-800",
  ACCEPTE: "bg-emerald-100 text-emerald-800",
  REFUSE: "bg-rose-100 text-rose-800",
  REMPLACE: "bg-slate-200 text-slate-500",
};

export const ORIGINES_LIGNE: Record<OrigineLigne, string> = {
  SAISIE: "Saisie",
  BIBLIOTHEQUE: "Bibliothèque",
  IMPORT: "Import",
};

export const STATUTS_BUDGET: Record<StatutBudget, string> = {
  NON_ETABLI: "Non établi",
  BROUILLON: "En préparation",
  SOUMIS: "Soumis à validation",
  VALIDE: "Validé",
};

export const POSTES_BUDGET: Record<PosteBudget, string> = {
  MATERIAUX: "Matériaux",
  MAIN_OEUVRE: "Main-d'œuvre",
  MATERIEL: "Matériel et engins",
  SOUS_TRAITANCE: "Sous-traitance",
  FRAIS_CHANTIER: "Frais de chantier",
  FRAIS_GENERAUX: "Frais généraux",
  AUTRE: "Autres / non détaillé",
};

export const POSTE_DU_COMPOSANT: Record<TypeComposant, PosteBudget> = {
  MATERIAU: "MATERIAUX",
  MAIN_OEUVRE: "MAIN_OEUVRE",
  MATERIEL: "MATERIEL",
  SOUS_TRAITANCE: "SOUS_TRAITANCE",
  AUTRE: "AUTRE",
};

export const METEOS: Record<Meteo, string> = {
  ENSOLEILLE: "Ensoleillé",
  NUAGEUX: "Nuageux",
  PLUIE: "Pluie",
  FORTE_PLUIE: "Forte pluie",
  VENT_FORT: "Vent fort",
  HARMATTAN: "Harmattan / poussière",
  CHALEUR_EXTREME: "Chaleur extrême",
};

export const STATUTS_RAPPORT: Record<StatutRapport, string> = {
  BROUILLON: "Brouillon",
  SOUMIS: "Soumis à validation",
  VALIDE: "Validé",
};
export const COULEUR_RAPPORT: Record<StatutRapport, string> = {
  BROUILLON: "bg-slate-100 text-slate-700",
  SOUMIS: "bg-amber-100 text-amber-800",
  VALIDE: "bg-emerald-100 text-emerald-800",
};

export const CATEGORIES_DOCUMENT: Record<CategorieDocument, string> = {
  CONTRAT: "Contrat",
  MARCHE: "Marché",
  PLAN: "Plan",
  DEVIS: "Devis",
  FACTURE: "Facture",
  BON_COMMANDE: "Bon de commande",
  BON_LIVRAISON: "Bon de livraison",
  RAPPORT: "Rapport",
  ATTACHEMENT: "Attachement",
  SITUATION: "Situation de travaux",
  PROCES_VERBAL: "Procès-verbal",
  ADMINISTRATIF: "Document administratif",
  QHSE: "Document QHSE",
  PHOTO: "Photo",
  DOSSIER_RECEPTION: "Dossier de réception",
  AUTRE: "Autre",
};

/** Catégories dont chaque nouvelle version doit être approuvée avant d'être en vigueur. */
export const CATEGORIES_A_APPROUVER: CategorieDocument[] = ["PLAN", "CONTRAT", "MARCHE", "PROCES_VERBAL"];

export const STATUTS_VERSION: Record<StatutVersion, string> = {
  EN_ATTENTE: "En attente d'approbation",
  APPROUVE: "Approuvée — en vigueur",
  EN_VIGUEUR: "En vigueur",
  REMPLACE: "Remplacée — ne plus utiliser",
  REJETE: "Rejetée",
};
export const COULEUR_VERSION: Record<StatutVersion, string> = {
  EN_ATTENTE: "bg-amber-100 text-amber-800",
  APPROUVE: "bg-emerald-100 text-emerald-800",
  EN_VIGUEUR: "bg-emerald-100 text-emerald-800",
  REMPLACE: "bg-slate-200 text-slate-600",
  REJETE: "bg-rose-100 text-rose-800",
};
export const VERSION_EN_VIGUEUR: StatutVersion[] = ["APPROUVE", "EN_VIGUEUR"];
