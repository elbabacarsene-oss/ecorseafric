// Calculs de planning (purs) : durées, chemin critique (méthode du chemin critique, liens fin → début),
// cycles, retards, écarts par rapport au planning de référence. Testés dans tests/unit/planning-calculs.test.ts.
//
// Convention : les dates sont des jours calendaires (minuit UTC = minuit à Dakar). Une tâche du 1er au 3 dure 3 jours ;
// un jalon dure 0 jour. Un successeur peut commencer le lendemain de la fin de son prédécesseur + décalage.
import type { TypeTache } from "@prisma/client";

const JOUR = 86_400_000;
export const jourNum = (d: Date) => Math.round(new Date(d).getTime() / JOUR);
export const depuisJourNum = (n: number) => new Date(n * JOUR);

export type TacheCalc = {
  id: string;
  type: TypeTache;
  debutPrevu: Date;
  finPrevue: Date;
  parentId?: string | null;
  avancement?: number;
  debutReel?: Date | null;
  finReelle?: Date | null;
  debutReference?: Date | null;
  finReference?: Date | null;
  importante?: boolean;
};
export type DependanceCalc = { predecesseurId: string; successeurId: string; decalageJours: number };

export function dureeJours(t: Pick<TacheCalc, "type" | "debutPrevu" | "finPrevue">): number {
  if (t.type === "JALON") return 0;
  return jourNum(t.finPrevue) - jourNum(t.debutPrevu) + 1;
}

/** Renvoie un cycle (liste d'identifiants) s'il existe, sinon null. */
export function trouverCycle(ids: string[], deps: DependanceCalc[]): string[] | null {
  const succ = new Map<string, string[]>(ids.map((i) => [i, []]));
  for (const d of deps) succ.get(d.predecesseurId)?.push(d.successeurId);
  const etat = new Map<string, 0 | 1 | 2>();
  const pile: string[] = [];
  const visiter = (n: string): string[] | null => {
    etat.set(n, 1);
    pile.push(n);
    for (const s of succ.get(n) ?? []) {
      if (etat.get(s) === 1) return [...pile.slice(pile.indexOf(s)), s];
      if (!etat.get(s)) {
        const c = visiter(s);
        if (c) return c;
      }
    }
    pile.pop();
    etat.set(n, 2);
    return null;
  };
  for (const i of ids) {
    if (!etat.get(i)) {
      const c = visiter(i);
      if (c) return c;
    }
  }
  return null;
}

export type ResultatCPM = {
  /** Dates au plus tôt (début, fin incluse) respectant les dépendances, sans jamais avancer une tâche. */
  dates: Map<string, { debut: Date; fin: Date }>;
  marge: Map<string, number>; // marge totale en jours
  critiques: Set<string>;
  finProjet: Date | null;
  /** Dépendances non respectées par les dates prévues actuelles. */
  conflits: { predecesseurId: string; successeurId: string; joursManquants: number }[];
};

/**
 * Méthode du chemin critique sur les tâches élémentaires (sans sous-tâches).
 * Début au plus tôt = max(début prévu, fin des prédécesseurs + 1 + décalage) ; marge = début au plus tard − au plus tôt.
 * Lève une erreur si les dépendances forment un cycle.
 */
export function cheminCritique(taches: TacheCalc[], deps: DependanceCalc[]): ResultatCPM {
  const ids = taches.map((t) => t.id);
  const parId = new Map(taches.map((t) => [t.id, t]));
  const utiles = deps.filter((d) => parId.has(d.predecesseurId) && parId.has(d.successeurId));
  const cycle = trouverCycle(ids, utiles);
  if (cycle) throw new Error("Les dépendances forment une boucle : " + cycle.join(" → "));

  const preds = new Map<string, DependanceCalc[]>(ids.map((i) => [i, []]));
  const succs = new Map<string, DependanceCalc[]>(ids.map((i) => [i, []]));
  for (const d of utiles) {
    preds.get(d.successeurId)!.push(d);
    succs.get(d.predecesseurId)!.push(d);
  }
  // Ordre topologique (Kahn)
  const degre = new Map(ids.map((i) => [i, preds.get(i)!.length]));
  const file = ids.filter((i) => degre.get(i) === 0);
  const ordre: string[] = [];
  while (file.length) {
    const n = file.shift()!;
    ordre.push(n);
    for (const d of succs.get(n)!) {
      degre.set(d.successeurId, degre.get(d.successeurId)! - 1);
      if (degre.get(d.successeurId) === 0) file.push(d.successeurId);
    }
  }

  // Modèle « fin exclusive » : ES, EF = ES + durée. Un jalon est placé en fin de sa journée (début = jour + 1).
  const ES = new Map<string, number>();
  const EF = new Map<string, number>();
  const dur = (id: string) => dureeJours(parId.get(id)!);
  const debutNum = (id: string) => { const t = parId.get(id)!; return jourNum(t.debutPrevu) + (t.type === "JALON" ? 1 : 0); };
  const conflits: ResultatCPM["conflits"] = [];
  for (const id of ordre) {
    const t = parId.get(id)!;
    let es = debutNum(id);
    for (const d of preds.get(id)!) {
      const requis = EF.get(d.predecesseurId)! + d.decalageJours;
      const prevuPred = debutNum(d.predecesseurId) + dur(d.predecesseurId) + d.decalageJours;
      if (debutNum(id) < prevuPred) conflits.push({ predecesseurId: d.predecesseurId, successeurId: id, joursManquants: prevuPred - debutNum(id) });
      es = Math.max(es, requis);
    }
    ES.set(id, es);
    EF.set(id, es + dur(id));
  }
  const finProjetNum = ordre.length ? Math.max(...ordre.map((i) => EF.get(i)!)) : null;
  const LS = new Map<string, number>();
  for (const id of [...ordre].reverse()) {
    let lf = finProjetNum!;
    for (const d of succs.get(id)!) lf = Math.min(lf, LS.get(d.successeurId)! - d.decalageJours);
    LS.set(id, lf - dur(id));
  }
  const dates = new Map<string, { debut: Date; fin: Date }>();
  const marge = new Map<string, number>();
  const critiques = new Set<string>();
  for (const id of ordre) {
    const es = ES.get(id)!;
    const d = dur(id);
    dates.set(id, d === 0 ? { debut: depuisJourNum(es - 1), fin: depuisJourNum(es - 1) } : { debut: depuisJourNum(es), fin: depuisJourNum(es + d - 1) });
    const m = LS.get(id)! - es;
    marge.set(id, m);
    if (m <= 0) critiques.add(id);
  }
  return {
    dates,
    marge,
    critiques,
    finProjet: finProjetNum === null ? null : depuisJourNum(finProjetNum - 1),
    conflits,
  };
}

export type EtatRetard = { enRetard: boolean; joursRetard: number; demarrageEnRetard: boolean; avancementAttendu: number };

/** Avancement attendu (linéaire) et retard d'une tâche à une date donnée. */
export function etatTache(t: TacheCalc, aujourdhui: Date): EtatRetard {
  const auj = jourNum(aujourdhui);
  const debut = jourNum(t.debutPrevu);
  const fin = jourNum(t.finPrevue);
  const terminee = (t.avancement ?? 0) >= 100 || !!t.finReelle;
  const duree = Math.max(1, fin - debut + 1);
  const attendu = auj < debut ? 0 : auj >= fin ? 100 : Math.round(((auj - debut + 1) / duree) * 100);
  const enRetard = !terminee && fin < auj;
  return {
    enRetard,
    joursRetard: enRetard ? auj - fin : 0,
    demarrageEnRetard: !terminee && !t.debutReel && (t.avancement ?? 0) === 0 && debut < auj,
    avancementAttendu: attendu,
  };
}

/** Écart (en jours) de la fin prévue actuelle par rapport au planning de référence ; null sans référence. */
export function ecartReference(t: Pick<TacheCalc, "finPrevue" | "finReference">): number | null {
  if (!t.finReference) return null;
  return jourNum(t.finPrevue) - jourNum(t.finReference);
}

/** Enveloppe des dates des sous-tâches (pour une tâche récapitulative). */
export function enveloppe(enfants: Pick<TacheCalc, "debutPrevu" | "finPrevue">[]): { debut: Date; fin: Date } | null {
  if (!enfants.length) return null;
  return {
    debut: depuisJourNum(Math.min(...enfants.map((e) => jourNum(e.debutPrevu)))),
    fin: depuisJourNum(Math.max(...enfants.map((e) => jourNum(e.finPrevue)))),
  };
}

/** Avancement global pondéré par la durée des tâches élémentaires (jalons exclus). */
export function avancementGlobal(taches: TacheCalc[]): number | null {
  const parents = new Set(taches.map((t) => t.parentId).filter(Boolean));
  const feuilles = taches.filter((t) => !parents.has(t.id) && t.type === "TACHE");
  const total = feuilles.reduce((s, t) => s + dureeJours(t), 0);
  if (total === 0) return null;
  return Math.round(feuilles.reduce((s, t) => s + dureeJours(t) * (t.avancement ?? 0), 0) / total);
}
