import { Prisma } from "@prisma/client";
import { AccesRefuse } from "./auth";
import { parseMontant } from "./format";
import type { EtatAction } from "@/components/FormulaireAction";

export class ErreurSaisie extends Error {}

export function texte(fd: FormData, nom: string, opts: { requis?: boolean; max?: number; libelle?: string } = {}): string | null {
  const v = String(fd.get(nom) ?? "").trim();
  if (!v) {
    if (opts.requis) throw new ErreurSaisie(`Le champ « ${opts.libelle ?? nom} » est obligatoire.`);
    return null;
  }
  if (v.length > (opts.max ?? 500)) throw new ErreurSaisie(`Le champ « ${opts.libelle ?? nom} » est trop long.`);
  return v;
}

export function choix<T extends string>(fd: FormData, nom: string, valeurs: readonly T[] | Record<T, string>, opts: { requis?: boolean; libelle?: string } = {}): T | null {
  const v = texte(fd, nom, opts);
  if (v === null) return null;
  const liste = Array.isArray(valeurs) ? valeurs : Object.keys(valeurs);
  if (!liste.includes(v)) throw new ErreurSaisie(`Valeur invalide pour « ${opts.libelle ?? nom} ».`);
  return v as T;
}

export function date(fd: FormData, nom: string, opts: { requis?: boolean; libelle?: string } = {}): Date | null {
  const v = texte(fd, nom, opts);
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErreurSaisie(`Date invalide pour « ${opts.libelle ?? nom} ».`);
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ErreurSaisie(`Date invalide pour « ${opts.libelle ?? nom} ».`);
  return d;
}

export function montant(fd: FormData, nom: string, opts: { requis?: boolean; libelle?: string; negatifAutorise?: boolean } = {}): number | null {
  const brut = texte(fd, nom, opts);
  if (brut === null) return null;
  const n = parseMontant(brut);
  if (n === null) throw new ErreurSaisie(`Montant invalide pour « ${opts.libelle ?? nom} ». Exemple : 15 000 000`);
  if (n < 0 && !opts.negatifAutorise) throw new ErreurSaisie(`Le montant « ${opts.libelle ?? nom} » ne peut pas être négatif.`);
  if (Math.abs(n) > 1e15) throw new ErreurSaisie(`Montant hors limites pour « ${opts.libelle ?? nom} ».`);
  return n;
}

export function entier(fd: FormData, nom: string, opts: { libelle?: string; min?: number } = {}): number {
  const v = texte(fd, nom, opts);
  if (v === null) return 0;
  if (!/^-?\d+$/.test(v)) throw new ErreurSaisie(`Nombre entier attendu pour « ${opts.libelle ?? nom} ».`);
  const n = Number(v);
  if (opts.min !== undefined && n < opts.min) throw new ErreurSaisie(`« ${opts.libelle ?? nom} » doit être supérieur ou égal à ${opts.min}.`);
  return n;
}

export function decimal(fd: FormData, nom: string, opts: { libelle?: string; min: number; max: number }): number | null {
  const v = texte(fd, nom, opts);
  if (v === null) return null;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n) || n < opts.min || n > opts.max) throw new ErreurSaisie(`Valeur invalide pour « ${opts.libelle ?? nom} ».`);
  return n;
}

export const coche = (fd: FormData, nom: string) => fd.get(nom) === "on";

export function email(fd: FormData, nom: string, opts: { requis?: boolean; libelle?: string } = {}): string | null {
  const v = texte(fd, nom, opts);
  if (v === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ErreurSaisie(`Adresse e-mail invalide pour « ${opts.libelle ?? nom} ».`);
  return v.toLowerCase();
}

/**
 * Exécute une action serveur et convertit les erreurs attendues en message affiché.
 * Les redirections Next (NEXT_REDIRECT) sont relancées.
 */
export async function executer(fn: () => Promise<EtatAction | void>): Promise<EtatAction> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    if (e instanceof ErreurSaisie || e instanceof AccesRefuse) return { erreur: e.message };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { erreur: "Un enregistrement avec la même valeur unique existe déjà (code, e-mail ou numéro)." };
    }
    throw e;
  }
}
