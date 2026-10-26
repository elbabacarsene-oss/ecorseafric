import { describe, expect, it } from "vitest";
import {
  budgetReference, dateFinActualisee, estEnRetard, joursDeRetard, margePrevisionnelle, montantMarcheActualise, tauxMarge, totalAvenantsApprouves,
  type ChantierCalc,
} from "@/lib/calculs";

const base = (x: Partial<ChantierCalc> = {}): ChantierCalc => ({
  statut: "EN_COURS",
  montantMarche: "100000000",
  budgetInitial: "80000000",
  budgetActualise: null,
  dateFinContractuelle: new Date("2026-06-30T00:00:00Z"),
  avenants: [],
  ...x,
});

describe("avenants", () => {
  it("seuls les avenants approuvés modifient le marché et les délais", () => {
    const c = base({
      avenants: [
        { statut: "APPROUVE", montant: "10000000", delaiSupplementaireJours: 30 },
        { statut: "SOUMIS", montant: "50000000", delaiSupplementaireJours: 90 },
        { statut: "REJETE", montant: "7000000", delaiSupplementaireJours: 10 },
        { statut: "APPROUVE", montant: "-2000000", delaiSupplementaireJours: 0 },
      ],
    });
    expect(totalAvenantsApprouves(c.avenants)).toBe(8_000_000);
    expect(montantMarcheActualise(c)).toBe(108_000_000);
    expect(dateFinActualisee(c)?.toISOString().slice(0, 10)).toBe("2026-07-30");
  });
});

describe("marge prévisionnelle", () => {
  it("utilise le budget actualisé s'il existe, sinon le budget initial", () => {
    expect(budgetReference(base())).toBe(80_000_000);
    expect(budgetReference(base({ budgetActualise: "90000000" }))).toBe(90_000_000);
    expect(margePrevisionnelle(base())).toBe(20_000_000);
    expect(margePrevisionnelle(base({ budgetActualise: "90000000" }))).toBe(10_000_000);
    expect(tauxMarge(base())).toBeCloseTo(0.2);
  });
  it("n'invente pas de marge quand aucun budget n'est saisi", () => {
    expect(margePrevisionnelle(base({ budgetInitial: "0" }))).toBeNull();
    expect(tauxMarge(base({ budgetInitial: "0" }))).toBeNull();
  });
  it("peut être négative (chantier déficitaire)", () => {
    expect(margePrevisionnelle(base({ budgetActualise: "120000000" }))).toBe(-20_000_000);
  });
});

describe("retard", () => {
  const auj = new Date("2026-10-25T00:00:00Z");
  it("un chantier en cours dont la fin actualisée est dépassée est en retard", () => {
    expect(estEnRetard(base(), auj)).toBe(true);
    expect(joursDeRetard(base(), auj)).toBe(117);
  });
  it("un avenant approuvé de délai peut supprimer le retard", () => {
    expect(estEnRetard(base({ avenants: [{ statut: "APPROUVE", montant: 0, delaiSupplementaireJours: 200 }] }), auj)).toBe(false);
  });
  it("un chantier réceptionné, en préparation ou sans date de fin n'est pas en retard", () => {
    expect(estEnRetard(base({ statut: "RECEPTION_PROVISOIRE" }), auj)).toBe(false);
    expect(estEnRetard(base({ statut: "EN_PREPARATION" }), auj)).toBe(false);
    expect(estEnRetard(base({ dateFinContractuelle: null }), auj)).toBe(false);
  });
});
