// Calculs du budget détaillé d'un chantier (purs).
import type { PosteBudget } from "@prisma/client";
import { toNumber } from "./format";

type N = number | string | { toString(): string } | null | undefined;
export type LigneBudgetCalc = { lot: string; poste: PosteBudget; montantInitial: N; montantActualise: N };

const actualise = (l: LigneBudgetCalc) =>
  l.montantActualise !== null && l.montantActualise !== undefined ? toNumber(l.montantActualise) : toNumber(l.montantInitial);

export function totauxBudget(lignes: LigneBudgetCalc[]) {
  const initial = lignes.reduce((s, l) => s + toNumber(l.montantInitial), 0);
  const revise = lignes.some((l) => l.montantActualise !== null && l.montantActualise !== undefined);
  const totalActualise = lignes.reduce((s, l) => s + actualise(l), 0);
  const parPoste = new Map<PosteBudget, { initial: number; actualise: number }>();
  const parLot = new Map<string, { initial: number; actualise: number }>();
  for (const l of lignes) {
    for (const [m, k] of [[parPoste, l.poste], [parLot, l.lot]] as const) {
      const x = (m as Map<string, { initial: number; actualise: number }>).get(k) ?? { initial: 0, actualise: 0 };
      x.initial += toNumber(l.montantInitial);
      x.actualise += actualise(l);
      (m as Map<string, { initial: number; actualise: number }>).set(k, x);
    }
  }
  return {
    initial,
    actualise: totalActualise,
    revise,
    ecart: totalActualise - initial,
    parPoste: [...parPoste.entries()].map(([poste, v]) => ({ poste, ...v })),
    parLot: [...parLot.entries()].map(([lot, v]) => ({ lot, ...v })),
  };
}

/** Valeurs à reporter sur la fiche chantier (budget initial / actualisé) à partir du budget détaillé. */
export function montantsChantierDepuisBudget(lignes: LigneBudgetCalc[]): { budgetInitial: number; budgetActualise: number | null } {
  const t = totauxBudget(lignes);
  return { budgetInitial: t.initial, budgetActualise: t.revise ? t.actualise : null };
}

export type AlerteBudget = { niveau: "info" | "alerte" | "critique"; message: string };

/** Alertes de cohérence budget / marché (les dépenses réelles arrivent à l'étape 4). */
export function alertesBudget(lignes: LigneBudgetCalc[], marcheActualise: number): AlerteBudget[] {
  const t = totauxBudget(lignes);
  const res: AlerteBudget[] = [];
  if (lignes.length === 0) return res;
  if (t.ecart > 0) res.push({ niveau: "alerte", message: `Le budget actualisé dépasse le budget initial de ${Math.round(t.ecart).toLocaleString("fr-SN")} F CFA.` });
  if (marcheActualise > 0 && t.actualise > marcheActualise) {
    res.push({ niveau: "critique", message: "Le budget actualisé dépasse le montant du marché actualisé : marge prévisionnelle négative." });
  }
  if (marcheActualise <= 0) res.push({ niveau: "info", message: "Montant du marché non saisi : la marge ne peut pas être calculée." });
  return res;
}
