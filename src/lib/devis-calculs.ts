// Calculs d'étude de prix (purs, sans accès base) : testés dans tests/unit/devis-calculs.test.ts.
//
// Méthode retenue (affichée dans l'application) :
//   Déboursé sec (DS) = Σ quantité × déboursé sec unitaire ; DS unitaire = Σ sous-détail (quantité × prix) s'il existe.
//   Frais de chantier (FC) = DS × taux FC
//   Frais généraux (FG)   = (DS + FC) × taux FG
//   Coût de revient (CR)  = DS + FC + FG
//   Coefficient de vente K = (1 + FC%) × (1 + FG%) × (1 + marge%)
//   Prix unitaire de vente = arrondi(DS unitaire × K), sauf prix imposé (bordereau du client)
//   Montant de la ligne    = arrondi(quantité × prix unitaire de vente)
//   Total HT = Σ montants des lignes ; marge = total HT − coût de revient ; TVA = arrondi(HT × taux TVA)
import type { PosteBudget, TypeComposant } from "@prisma/client";
import { toNumber } from "./format";

type N = number | string | { toString(): string } | null | undefined;

export type TauxDevis = { tauxFraisChantier: N; tauxFraisGeneraux: N; tauxMarge: N; tauxTva?: N };
export type SousDetailCalc = { type: TypeComposant; quantite: N; prixUnitaire: N };
export type LigneCalc = {
  lot: string;
  quantite: N;
  debourseSecUnitaire: N;
  prixUnitaireImpose?: N;
  verifiee?: boolean;
  sousDetail?: SousDetailCalc[];
};

const arrondi2 = (x: number) => Math.round(x * 100) / 100;

export function coefficientVente(t: TauxDevis): number {
  return (1 + toNumber(t.tauxFraisChantier) / 100) * (1 + toNumber(t.tauxFraisGeneraux) / 100) * (1 + toNumber(t.tauxMarge) / 100);
}

/** DS unitaire à partir du sous-détail (quantités pour une unité d'ouvrage). */
export function debourseSecSousDetail(sd: SousDetailCalc[]): number {
  return arrondi2(sd.reduce((s, c) => s + toNumber(c.quantite) * toNumber(c.prixUnitaire), 0));
}

export function prixUnitaireVente(l: LigneCalc, t: TauxDevis): number {
  if (l.prixUnitaireImpose !== null && l.prixUnitaireImpose !== undefined && String(l.prixUnitaireImpose) !== "") {
    return Math.round(toNumber(l.prixUnitaireImpose));
  }
  return Math.round(toNumber(l.debourseSecUnitaire) * coefficientVente(t));
}

export function montantLigne(l: LigneCalc, t: TauxDevis): number {
  return Math.round(toNumber(l.quantite) * prixUnitaireVente(l, t));
}

export function debourseSecLigne(l: LigneCalc): number {
  return toNumber(l.quantite) * toNumber(l.debourseSecUnitaire);
}

export type TotauxDevis = {
  debourseSec: number;
  fraisChantier: number;
  fraisGeneraux: number;
  coutRevient: number;
  totalHT: number;
  marge: number;
  tauxMargeEffectif: number | null; // marge / total HT
  tva: number;
  totalTTC: number;
  coefficient: number;
  lignesNonVerifiees: number;
  lignesSansPrix: number;
  parLot: { lot: string; debourseSec: number; totalHT: number; nbLignes: number }[];
};

export function totauxDevis(lignes: LigneCalc[], t: TauxDevis): TotauxDevis {
  const debourseSec = Math.round(lignes.reduce((s, l) => s + debourseSecLigne(l), 0));
  const fraisChantier = Math.round(debourseSec * (toNumber(t.tauxFraisChantier) / 100));
  const fraisGeneraux = Math.round((debourseSec + fraisChantier) * (toNumber(t.tauxFraisGeneraux) / 100));
  const coutRevient = debourseSec + fraisChantier + fraisGeneraux;
  const totalHT = lignes.reduce((s, l) => s + montantLigne(l, t), 0);
  const marge = totalHT - coutRevient;
  const tva = Math.round(totalHT * (toNumber(t.tauxTva) / 100));
  const lots = new Map<string, { lot: string; debourseSec: number; totalHT: number; nbLignes: number }>();
  for (const l of lignes) {
    const x = lots.get(l.lot) ?? { lot: l.lot, debourseSec: 0, totalHT: 0, nbLignes: 0 };
    x.debourseSec += debourseSecLigne(l);
    x.totalHT += montantLigne(l, t);
    x.nbLignes += 1;
    lots.set(l.lot, x);
  }
  return {
    debourseSec,
    fraisChantier,
    fraisGeneraux,
    coutRevient,
    totalHT,
    marge,
    tauxMargeEffectif: totalHT > 0 ? marge / totalHT : null,
    tva,
    totalTTC: totalHT + tva,
    coefficient: coefficientVente(t),
    lignesNonVerifiees: lignes.filter((l) => l.verifiee === false).length,
    lignesSansPrix: lignes.filter((l) => prixUnitaireVente(l, t) <= 0).length,
    parLot: [...lots.values()].map((x) => ({ ...x, debourseSec: Math.round(x.debourseSec) })),
  };
}

const POSTE: Record<TypeComposant, PosteBudget> = {
  MATERIAU: "MATERIAUX",
  MAIN_OEUVRE: "MAIN_OEUVRE",
  MATERIEL: "MATERIEL",
  SOUS_TRAITANCE: "SOUS_TRAITANCE",
  AUTRE: "AUTRE",
};

export type LigneBudgetCalc = { lot: string; poste: PosteBudget; montant: number };

/**
 * Budget prévisionnel issu d'un devis : déboursé sec réparti par lot et par nature (sous-détail),
 * plus les frais de chantier et frais généraux. Le total est le coût de revient du devis.
 */
export function budgetDepuisDevis(lignes: LigneCalc[], t: TauxDevis): LigneBudgetCalc[] {
  const cumul = new Map<string, LigneBudgetCalc>();
  const ajouter = (lot: string, poste: PosteBudget, m: number) => {
    const k = `${lot}\u0000${poste}`;
    const x = cumul.get(k) ?? { lot, poste, montant: 0 };
    x.montant += m;
    cumul.set(k, x);
  };
  for (const l of lignes) {
    const q = toNumber(l.quantite);
    if (l.sousDetail && l.sousDetail.length > 0) {
      for (const c of l.sousDetail) ajouter(l.lot, POSTE[c.type], q * toNumber(c.quantite) * toNumber(c.prixUnitaire));
    } else {
      ajouter(l.lot, "AUTRE", debourseSecLigne(l));
    }
  }
  const res = [...cumul.values()].map((x) => ({ ...x, montant: Math.round(x.montant) })).filter((x) => x.montant !== 0);
  const tot = totauxDevis(lignes, t);
  // L'arrondi par ligne peut s'écarter de quelques francs du DS total : on reporte l'écart sur la plus grosse ligne.
  const ecart = tot.debourseSec - res.reduce((s, x) => s + x.montant, 0);
  if (ecart !== 0 && res.length) res.reduce((a, b) => (b.montant > a.montant ? b : a)).montant += ecart;
  if (tot.fraisChantier) res.push({ lot: "Frais", poste: "FRAIS_CHANTIER", montant: tot.fraisChantier });
  if (tot.fraisGeneraux) res.push({ lot: "Frais", poste: "FRAIS_GENERAUX", montant: tot.fraisGeneraux });
  return res;
}

/** Lettre de la variante suivante : A → B → … → Z → AA. */
export function varianteSuivante(existantes: string[]): string {
  const lettres = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : lettres(Math.floor(n / 26) - 1) + lettres(n % 26));
  for (let i = 0; i < 702; i++) {
    const v = lettres(i);
    if (!existantes.includes(v)) return v;
  }
  throw new Error("Trop de variantes");
}
