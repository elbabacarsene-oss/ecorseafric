import { describe, expect, it } from "vitest";
import { budgetDepuisDevis, coefficientVente, debourseSecSousDetail, montantLigne, prixUnitaireVente, totauxDevis, varianteSuivante } from "@/lib/devis-calculs";

const taux = { tauxFraisChantier: 10, tauxFraisGeneraux: 8, tauxMarge: 12, tauxTva: 18 };

describe("étude de prix", () => {
  it("coefficient de vente K = (1+FC)(1+FG)(1+marge)", () => {
    expect(coefficientVente(taux)).toBeCloseTo(1.1 * 1.08 * 1.12, 10);
    expect(coefficientVente({ tauxFraisChantier: 0, tauxFraisGeneraux: 0, tauxMarge: 0 })).toBe(1);
  });

  it("déboursé sec unitaire depuis le sous-détail", () => {
    // 1 m³ de béton dosé à 350 kg : 0,35 t de ciment à 85 000, 0,8 m³ de gravier à 15 000, 0,4 m³ de sable à 9 000, 6 h de main-d'œuvre à 1 500
    const sd = [
      { type: "MATERIAU" as const, quantite: 0.35, prixUnitaire: 85000 },
      { type: "MATERIAU" as const, quantite: 0.8, prixUnitaire: 15000 },
      { type: "MATERIAU" as const, quantite: 0.4, prixUnitaire: 9000 },
      { type: "MAIN_OEUVRE" as const, quantite: 6, prixUnitaire: 1500 },
    ];
    expect(debourseSecSousDetail(sd)).toBe(29750 + 12000 + 3600 + 9000);
  });

  it("prix unitaire de vente et montant de ligne, avec ou sans prix imposé", () => {
    const l = { lot: "Gros œuvre", quantite: 12.5, debourseSecUnitaire: 54350 };
    const pu = Math.round(54350 * coefficientVente(taux));
    expect(prixUnitaireVente(l, taux)).toBe(pu);
    expect(montantLigne(l, taux)).toBe(Math.round(12.5 * pu));
    expect(prixUnitaireVente({ ...l, prixUnitaireImpose: 70000 }, taux)).toBe(70000);
    expect(montantLigne({ ...l, prixUnitaireImpose: 70000 }, taux)).toBe(875000);
  });

  it("totaux : DS, frais, coût de revient, HT, marge, TVA 18 %, TTC", () => {
    const lignes = [
      { lot: "A", quantite: 10, debourseSecUnitaire: 10000, verifiee: true },
      { lot: "B", quantite: 2, debourseSecUnitaire: 50000, verifiee: false },
    ];
    const t = totauxDevis(lignes, taux);
    expect(t.debourseSec).toBe(200000);
    expect(t.fraisChantier).toBe(20000);
    expect(t.fraisGeneraux).toBe(Math.round(220000 * 0.08));
    expect(t.coutRevient).toBe(200000 + 20000 + 17600);
    const pu1 = Math.round(10000 * coefficientVente(taux));
    const pu2 = Math.round(50000 * coefficientVente(taux));
    expect(t.totalHT).toBe(10 * pu1 + 2 * pu2);
    expect(t.marge).toBe(t.totalHT - t.coutRevient);
    expect(t.tva).toBe(Math.round(t.totalHT * 0.18));
    expect(t.totalTTC).toBe(t.totalHT + t.tva);
    expect(t.lignesNonVerifiees).toBe(1);
    expect(t.parLot.map((x) => x.lot)).toEqual(["A", "B"]);
  });

  it("devis vide : aucun montant inventé", () => {
    const t = totauxDevis([], taux);
    expect(t.totalHT).toBe(0);
    expect(t.tauxMargeEffectif).toBeNull();
  });

  it("le budget issu du devis est égal au coût de revient et ventilé par nature", () => {
    const lignes = [
      {
        lot: "Gros œuvre", quantite: 3, debourseSecUnitaire: 54350,
        sousDetail: [
          { type: "MATERIAU" as const, quantite: 1, prixUnitaire: 45350 },
          { type: "MAIN_OEUVRE" as const, quantite: 6, prixUnitaire: 1500 },
        ],
      },
      { lot: "Peinture", quantite: 100.333, debourseSecUnitaire: 1777 },
    ];
    const b = budgetDepuisDevis(lignes, taux);
    const t = totauxDevis(lignes, taux);
    expect(b.reduce((s, x) => s + x.montant, 0)).toBe(t.coutRevient);
    expect(b.find((x) => x.poste === "MAIN_OEUVRE")!.montant).toBe(27000);
    expect(b.find((x) => x.poste === "AUTRE")!.lot).toBe("Peinture");
    expect(b.find((x) => x.poste === "FRAIS_CHANTIER")!.montant).toBe(t.fraisChantier);
  });

  it("variantes A, B, … Z, AA", () => {
    expect(varianteSuivante(["A"])).toBe("B");
    expect(varianteSuivante(["A", "C"])).toBe("B");
    expect(varianteSuivante("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""))).toBe("AA");
  });
});
