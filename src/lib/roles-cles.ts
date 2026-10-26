/** Rôles clés d'un chantier : champ, libellé d'affectation et types d'intervenants admis. */
export const ROLES_CLES = [
  { champ: "clientId", libelle: "Client", types: null, categorie: "MAITRISE_OUVRAGE" },
  { champ: "maitreOuvrageId", libelle: "Maître d'ouvrage", types: null, categorie: "MAITRISE_OUVRAGE" },
  { champ: "architecteId", libelle: "Architecte", types: ["ARCHITECTE"], categorie: null },
  { champ: "bureauEtudesId", libelle: "Bureau d'études", types: ["BUREAU_ETUDES", "INGENIEUR"], categorie: null },
  { champ: "bureauControleId", libelle: "Bureau de contrôle", types: ["BUREAU_CONTROLE", "ORGANISME_CONTROLE", "LABORATOIRE"], categorie: null },
  { champ: "conducteurId", libelle: "Conducteur de travaux", types: null, categorie: "PERSONNEL_INTERNE" },
  { champ: "chefChantierId", libelle: "Chef de chantier", types: null, categorie: "PERSONNEL_INTERNE" },
  { champ: "responsableQhseId", libelle: "Responsable QHSE", types: null, categorie: "PERSONNEL_INTERNE" },
] as const;

export type ChampRole = (typeof ROLES_CLES)[number]["champ"];
