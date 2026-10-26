// Formats professionnels sénégalais : français, franc CFA (XOF), fuseau Africa/Dakar.
export const FUSEAU = "Africa/Dakar";
export const LOCALE = "fr-SN";

type Num = number | string | bigint | { toString(): string } | null | undefined;

export function toNumber(v: Num): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v.toString());
  return Number.isFinite(n) ? n : 0;
}

const fcfa = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

/** « 12 500 000 F CFA » */
export function formatXOF(v: Num): string {
  return `${fcfa.format(Math.round(toNumber(v)))} F CFA`;
}

export function formatNombre(v: Num): string {
  return fcfa.format(toNumber(v));
}

/** « 25/10/2026 » */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat(LOCALE, { timeZone: FUSEAU, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
}

/** « 25/10/2026 à 14:32 » */
export function formatDateHeure(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = new Date(d);
  const date = formatDate(x);
  const heure = new Intl.DateTimeFormat(LOCALE, { timeZone: FUSEAU, hour: "2-digit", minute: "2-digit" }).format(x);
  return `${date} à ${heure}`;
}

/** Date du jour à Dakar, à minuit UTC (Dakar = UTC+0, sans heure d'été). */
export function aujourdhuiDakar(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/** Valeur pour <input type="date"> */
export function toInputDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

/** Accepte « 1 500 000 », « 1500000 », « 1.500.000 », « -250 000 ». Renvoie null si invalide. */
export function parseMontant(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[\s  .]/g, "").replace(/F?CFA$/i, "").replace(",", ".");
  if (t === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.round(Number(t));
}

export function joursEntre(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function ajouterJours(d: Date, jours: number): Date {
  return new Date(d.getTime() + jours * 86_400_000);
}
