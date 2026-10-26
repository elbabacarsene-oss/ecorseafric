// Calculs métier purs (sans accès base) : testés unitairement dans tests/unit.
import type { StatutAvenant, StatutChantier } from "@prisma/client";
import { ajouterJours, toNumber } from "./format";

type Montant = number | string | { toString(): string };

export type AvenantCalc = { statut: StatutAvenant; montant: Montant; delaiSupplementaireJours: number };

export type ChantierCalc = {
  statut: StatutChantier;
  montantMarche: Montant;
  budgetInitial: Montant;
  budgetActualise: Montant | null;
  dateFinContractuelle: Date | null;
  dateFinReelle?: Date | null;
  avenants: AvenantCalc[];
};

/** Statuts considérés comme « chantier actif » (travaux en cours ou suspendus temporairement). */
export const STATUTS_ACTIFS: StatutChantier[] = ["EN_COURS", "SUSPENDU"];

const approuves = (a: AvenantCalc[]) => a.filter((x) => x.statut === "APPROUVE");

export function totalAvenantsApprouves(avenants: AvenantCalc[]): number {
  return approuves(avenants).reduce((s, a) => s + toNumber(a.montant), 0);
}

/** Montant du marché + avenants approuvés (seuls les avenants approuvés modifient le marché). */
export function montantMarcheActualise(c: Pick<ChantierCalc, "montantMarche" | "avenants">): number {
  return toNumber(c.montantMarche) + totalAvenantsApprouves(c.avenants);
}

export function delaiAvenantsApprouves(avenants: AvenantCalc[]): number {
  return approuves(avenants).reduce((s, a) => s + (a.delaiSupplementaireJours || 0), 0);
}

/** Date contractuelle de fin prolongée des délais accordés par avenants approuvés. */
export function dateFinActualisee(c: Pick<ChantierCalc, "dateFinContractuelle" | "avenants">): Date | null {
  if (!c.dateFinContractuelle) return null;
  return ajouterJours(new Date(c.dateFinContractuelle), delaiAvenantsApprouves(c.avenants));
}

/** Budget de référence : budget actualisé s'il a été saisi, sinon budget initial. */
export function budgetReference(c: Pick<ChantierCalc, "budgetInitial" | "budgetActualise">): number {
  return c.budgetActualise !== null && c.budgetActualise !== undefined ? toNumber(c.budgetActualise) : toNumber(c.budgetInitial);
}

/**
 * Marge prévisionnelle = montant du marché actualisé − budget de référence (coût prévisionnel).
 * Renvoie null si aucun budget n'est saisi : on n'invente pas de marge.
 */
export function margePrevisionnelle(c: ChantierCalc): number | null {
  const budget = budgetReference(c);
  if (budget <= 0) return null;
  return montantMarcheActualise(c) - budget;
}

export function tauxMarge(c: ChantierCalc): number | null {
  const marge = margePrevisionnelle(c);
  const ca = montantMarcheActualise(c);
  if (marge === null || ca <= 0) return null;
  return marge / ca;
}

/** Un chantier actif est en retard si la date de fin actualisée est dépassée. */
export function estEnRetard(c: ChantierCalc, aujourdhui: Date): boolean {
  if (!STATUTS_ACTIFS.includes(c.statut)) return false;
  const fin = dateFinActualisee(c);
  return fin !== null && fin.getTime() < aujourdhui.getTime();
}

export function joursDeRetard(c: ChantierCalc, aujourdhui: Date): number {
  if (!estEnRetard(c, aujourdhui)) return 0;
  return Math.round((aujourdhui.getTime() - dateFinActualisee(c)!.getTime()) / 86_400_000);
}

export function dureePrevueJours(debut: Date | null, fin: Date | null): number | null {
  if (!debut || !fin) return null;
  return Math.round((new Date(fin).getTime() - new Date(debut).getTime()) / 86_400_000);
}
