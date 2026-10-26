import { describe, expect, it } from "vitest";
import { alertesBudget, montantsChantierDepuisBudget, totauxBudget } from "@/lib/budget-calculs";
import { analyserTableau, lireCsv, lireNombre, lireUnite } from "@/lib/import-quantites";
import { montantEnLettres, nombreEnLettres } from "@/lib/lettres";
import { texteWinAnsi } from "@/lib/pdf-texte";
import { detecterType, nomFichierSur } from "@/lib/types-fichiers";

describe("budget détaillé", () => {
  const lignes = [
    { lot: "GO", poste: "MATERIAUX" as const, montantInitial: 1_000_000, montantActualise: null },
    { lot: "GO", poste: "MAIN_OEUVRE" as const, montantInitial: 400_000, montantActualise: 450_000 },
  ];
  it("totaux initial / actualisé et report sur la fiche chantier", () => {
    const t = totauxBudget(lignes);
    expect(t).toMatchObject({ initial: 1_400_000, actualise: 1_450_000, revise: true, ecart: 50_000 });
    expect(montantsChantierDepuisBudget(lignes)).toEqual({ budgetInitial: 1_400_000, budgetActualise: 1_450_000 });
    expect(montantsChantierDepuisBudget([lignes[0]])).toEqual({ budgetInitial: 1_000_000, budgetActualise: null });
  });
  it("alertes de dépassement", () => {
    expect(alertesBudget(lignes, 1_420_000).map((a) => a.niveau)).toEqual(["alerte", "critique"]);
    expect(alertesBudget([], 0)).toEqual([]);
  });
});

describe("import de tableaux de quantités", () => {
  it("lit les nombres et unités usuels", () => {
    expect(lireNombre("1 250,5")).toBe(1250.5);
    expect(lireNombre("1.250,50")).toBe(1250.5);
    expect(lireNombre("1,250.50")).toBe(1250.5);
    expect(lireNombre("abc")).toBeNull();
    expect(lireUnite("m²")).toBe("M2");
    expect(lireUnite("M3")).toBe("M3");
    expect(lireUnite("Ens")).toBe("U");
    expect(lireUnite("ft")).toBe("FORFAIT");
  });
  it("analyse un CSV avec titres de lots et signale les erreurs", () => {
    const csv = 'Désignation;Unité;Quantité;P.U. HT\nTERRASSEMENT;;;\nFouilles en rigole;m3;"12,5";4 500\nRemblai;xx;3;\n';
    const { lignes, erreurs } = analyserTableau(lireCsv(csv));
    expect(lignes).toEqual([{ lot: "TERRASSEMENT", designation: "Fouilles en rigole", unite: "M3", quantite: 12.5, debourseSecUnitaire: null, prixUnitaire: 4500 }]);
    expect(erreurs).toEqual(["Ligne 4 : unité « xx » non reconnue (m, m², m³, kg, t, u, ft, h, j)."]);
  });
  it("exige une colonne Désignation", () => {
    expect(analyserTableau([["a", "b"]]).erreurs[0]).toMatch(/Désignation/);
  });
});

describe("montant en lettres", () => {
  it.each([
    [0, "zéro"], [21, "vingt et un"], [71, "soixante et onze"], [80, "quatre-vingts"], [91, "quatre-vingt-onze"],
    [200, "deux cents"], [201, "deux cent un"], [1000, "mille"], [80000, "quatre-vingt mille"], [200000, "deux cent mille"],
    [1_250_000, "un million deux cent cinquante mille"], [2_000_000_000, "deux milliards"],
  ])("%i → %s", (n, t) => expect(nombreEnLettres(n)).toBe(t));
  it("formule complète", () => expect(montantEnLettres(15_340_000)).toBe("Quinze millions trois cent quarante mille francs CFA"));
});

describe("fichiers et PDF", () => {
  const octets = (s: string | number[]) => (typeof s === "string" ? new TextEncoder().encode(s) : new Uint8Array(s));
  it("reconnaît les formats par leur signature, pas seulement par l'extension", () => {
    expect(detecterType(octets("%PDF-1.7 ..."), "plan.pdf")?.mime).toBe("application/pdf");
    expect(detecterType(octets([0xff, 0xd8, 0xff, 0xe0]), "photo.png")?.mime).toBe("image/jpeg");
    expect(detecterType(octets("<html><script>"), "plan.pdf")).toBeNull();
    expect(detecterType(octets("<svg onload=alert(1)>"), "logo.svg")).toBeNull();
    expect(detecterType(octets([0x50, 0x4b, 0x03, 0x04]), "metre.xlsx")?.ext).toBe("xlsx");
    expect(detecterType(octets([0x50, 0x4b, 0x03, 0x04]), "virus.jar")).toBeNull();
    expect(detecterType(octets("a;b\n1;2"), "qte.csv")?.mime).toBe("text/csv");
  });
  it("nettoie les noms de fichiers", () => {
    expect(nomFichierSur('../../etc/"passwd"')).toBe(".._.._etc__passwd_");
  });
  it("convertit le texte pour les polices PDF standard", () => {
    expect(texteWinAnsi("1 250 000 F CFA → œuvre m² été")).toBe("1 250 000 F CFA -> œuvre m² été");
    expect(texteWinAnsi("日本")).toBe("??");
  });
});
