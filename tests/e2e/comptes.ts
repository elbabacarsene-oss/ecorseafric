import type { Role } from "@prisma/client";

export const MDP = "TestEcorse2026";
export const COMPTES = {
  admin: { email: "admin@test.sn", prenom: "Awa", nom: "Admin", role: "ADMIN" as Role },
  dt: { email: "dt@test.sn", prenom: "Moussa", nom: "Diop", role: "DIRECTEUR_TECHNIQUE" as Role },
  dg: { email: "dg@test.sn", prenom: "Fatou", nom: "Ndiaye", role: "DIRECTEUR_GENERAL" as Role },
  chef: { email: "chef@test.sn", prenom: "Ibrahima", nom: "Fall", role: "CHEF_CHANTIER" as Role },
  client: { email: "client@test.sn", prenom: "Cheikh", nom: "Sarr", role: "CLIENT" as Role },
  metreur: { email: "metreur@test.sn", prenom: "Aïssatou", nom: "Ba", role: "METREUR" as Role },
  conducteur: { email: "conducteur@test.sn", prenom: "Ousmane", nom: "Sy", role: "CONDUCTEUR_TRAVAUX" as Role },
};
