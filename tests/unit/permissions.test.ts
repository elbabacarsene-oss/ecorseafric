import type { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ROLES, ROLES_EXTERNES } from "@/lib/libelles";
import { MATRICE, peut, portee } from "@/lib/permissions";

const tousLesRoles = Object.keys(ROLES) as Role[];

describe("matrice des permissions", () => {
  it("définit une ligne pour chaque rôle", () => {
    for (const r of tousLesRoles) expect(MATRICE[r]).toBeDefined();
  });
  it("les comptes externes ne voient que leurs chantiers, en lecture seule", () => {
    for (const r of ROLES_EXTERNES) {
      expect(portee(r, "chantiers", "lire")).toBe("affectes");
      for (const a of ["creer", "modifier", "supprimer", "approuver"] as const) expect(peut(r, "chantiers", a)).toBe(false);
      expect(peut(r, "intervenants", "lire")).toBe(false);
      expect(peut(r, "chantiers_budget", "lire")).toBe(false);
      expect(peut(r, "utilisateurs", "lire")).toBe(false);
      expect(peut(r, "journal", "lire")).toBe(false);
      expect(peut(r, "tableau_de_bord", "lire")).toBe(false);
      expect(peut(r, "affectations", "lire")).toBe(false);
    }
  });
  it("seul le client voit le montant de son marché parmi les externes", () => {
    expect(portee("CLIENT", "chantiers_marche", "lire")).toBe("affectes");
    for (const r of ROLES_EXTERNES.filter((x) => x !== "CLIENT")) expect(peut(r, "chantiers_marche", "lire")).toBe(false);
  });
  it("l'approbation des avenants est réservée à la direction", () => {
    const approbateurs = tousLesRoles.filter((r) => peut(r, "avenants", "approuver"));
    expect(approbateurs.sort()).toEqual(["DIRECTEUR_FINANCIER", "DIRECTEUR_GENERAL", "DIRECTEUR_TECHNIQUE"]);
  });
  it("la gestion des comptes est réservée à l'administrateur", () => {
    expect(tousLesRoles.filter((r) => peut(r, "utilisateurs", "creer"))).toEqual(["ADMIN"]);
  });
  it("les rôles de terrain sont limités aux chantiers affectés", () => {
    for (const r of ["CHEF_CHANTIER", "CONDUCTEUR_TRAVAUX", "CHEF_PROJET", "METREUR", "MAGASINIER", "ACHETEUR"] as Role[]) {
      expect(portee(r, "chantiers", "lire")).toBe("affectes");
    }
  });
});
