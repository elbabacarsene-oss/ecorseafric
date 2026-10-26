// Contenu structuré des rapports journaliers : lecture/validation des listes saisies et empreinte de validation.
import { createHash } from "node:crypto";
import type { Unite } from "@prisma/client";
import { ErreurSaisie } from "./formulaire";
import { UNITES } from "./libelles";

export type LignePersonnel = { specialite: string; nombre: number; heures: number };
export type LigneTravaux = { designation: string; unite: Unite | null; quantite: number | null; tacheId: string | null; avancement: number | null };
export type LigneMateriau = { designation: string; unite: Unite; quantite: number; fournisseur: string | null };
export type EtatMateriel = "UTILISE" | "DISPONIBLE" | "EN_PANNE";
export type LigneMateriel = { designation: string; heures: number | null; etat: EtatMateriel };

export const ETATS_MATERIEL: Record<EtatMateriel, string> = { UTILISE: "Utilisé", DISPONIBLE: "Disponible, non utilisé", EN_PANNE: "En panne" };

const MAX_LIGNES = 60;

/** Colonnes d'une liste envoyée sous la forme prefixe.champ[] (même nombre de valeurs par colonne). */
function colonnes(fd: FormData, prefixe: string, champs: string[]) {
  const cols = Object.fromEntries(champs.map((c) => [c, fd.getAll(`${prefixe}.${c}`).map((v) => String(v).trim())]));
  const n = Math.max(0, ...Object.values(cols).map((c) => c.length));
  if (n > MAX_LIGNES) throw new ErreurSaisie(`Trop de lignes (${MAX_LIGNES} au maximum).`);
  return Array.from({ length: n }, (_, i) => Object.fromEntries(champs.map((c) => [c, cols[c][i] ?? ""])) as Record<string, string>);
}

const num = (s: string, libelle: string, min = 0, max = 1e9): number | null => {
  if (s === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) throw new ErreurSaisie(`Valeur invalide : ${libelle}.`);
  return n;
};
const unite = (s: string, libelle: string): Unite | null => {
  if (s === "") return null;
  if (!(s in UNITES)) throw new ErreurSaisie(`Unité invalide : ${libelle}.`);
  return s as Unite;
};
const court = (s: string, max = 300) => s.slice(0, max);

export function lirePersonnel(fd: FormData): LignePersonnel[] {
  return colonnes(fd, "personnel", ["specialite", "nombre", "heures"])
    .filter((l) => l.specialite)
    .map((l) => ({
      specialite: court(l.specialite, 100),
      nombre: num(l.nombre, `effectif « ${l.specialite} »`, 0, 10_000) ?? 0,
      heures: num(l.heures, `heures « ${l.specialite} »`, 0, 24) ?? 0,
    }))
    .map((l) => {
      if (!Number.isInteger(l.nombre)) throw new ErreurSaisie(`L'effectif « ${l.specialite} » doit être un nombre entier.`);
      return l;
    });
}

export function lireTravaux(fd: FormData, tachesAutorisees: Set<string>): LigneTravaux[] {
  return colonnes(fd, "travaux", ["designation", "unite", "quantite", "tacheId", "avancement"])
    .filter((l) => l.designation || l.tacheId)
    .map((l) => {
      if (l.tacheId && !tachesAutorisees.has(l.tacheId)) throw new ErreurSaisie("Tâche de planning inconnue pour ce chantier.");
      const avancement = num(l.avancement, "avancement", 0, 100);
      if (avancement !== null && !l.tacheId) throw new ErreurSaisie("Un avancement en % doit être rattaché à une tâche du planning.");
      return {
        designation: court(l.designation || "(tâche du planning)"),
        unite: unite(l.unite, l.designation),
        quantite: num(l.quantite, `quantité « ${l.designation} »`),
        tacheId: l.tacheId || null,
        avancement: avancement === null ? null : Math.round(avancement),
      };
    });
}

export function lireMateriaux(fd: FormData, prefixe: "consommes" | "livres"): LigneMateriau[] {
  return colonnes(fd, prefixe, ["designation", "unite", "quantite", "fournisseur"])
    .filter((l) => l.designation)
    .map((l) => {
      const u = unite(l.unite, l.designation);
      const q = num(l.quantite, `quantité « ${l.designation} »`);
      if (!u || q === null) throw new ErreurSaisie(`Indiquez l'unité et la quantité pour « ${l.designation} ».`);
      return { designation: court(l.designation), unite: u, quantite: q, fournisseur: l.fournisseur ? court(l.fournisseur, 150) : null };
    });
}

export function lireMateriel(fd: FormData): LigneMateriel[] {
  return colonnes(fd, "materiel", ["designation", "heures", "etat"])
    .filter((l) => l.designation)
    .map((l) => {
      if (!(l.etat in ETATS_MATERIEL)) throw new ErreurSaisie(`État invalide pour « ${l.designation} ».`);
      return { designation: court(l.designation, 150), heures: num(l.heures, `heures « ${l.designation} »`, 0, 24), etat: l.etat as EtatMateriel };
    });
}

export function totauxPersonnel(p: LignePersonnel[]) {
  return { effectif: p.reduce((s, l) => s + l.nombre, 0), heures: Math.round(p.reduce((s, l) => s + l.nombre * l.heures, 0) * 100) / 100 };
}

/** Empreinte SHA-256 du contenu validé (clés triées) : toute modification ultérieure en base serait détectable. */
export function empreinteContenu(contenu: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v instanceof Date ? v.toISOString()
    : v;
  return createHash("sha256").update(JSON.stringify(canon(contenu))).digest("hex");
}
