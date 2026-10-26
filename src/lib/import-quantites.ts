// Import de tableaux de quantités (CSV ou Excel) vers les lignes d'un devis. Pur, testé unitairement.
// Colonnes reconnues (ordre libre, ligne d'en-tête obligatoire) :
//   Lot · Désignation · Unité · Quantité · [Déboursé sec unitaire] · [Prix unitaire]
import type { Unite } from "@prisma/client";

export type LigneImportee = {
  lot: string;
  designation: string;
  unite: Unite;
  quantite: number;
  debourseSecUnitaire: number | null;
  prixUnitaire: number | null;
};

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9²³]/g, "");

const ALIAS_UNITES: Record<string, Unite> = {
  m: "M", ml: "M", metre: "M", metres: "M",
  m2: "M2", "m²": "M2", metrecarre: "M2",
  m3: "M3", "m³": "M3", metrecube: "M3",
  kg: "KG", kilogramme: "KG",
  t: "TONNE", tonne: "TONNE", tonnes: "TONNE",
  u: "U", unite: "U", unites: "U", nombre: "U", nb: "U", pce: "U", piece: "U", pieces: "U", ens: "U", ensemble: "U",
  ft: "FORFAIT", forfait: "FORFAIT", ff: "FORFAIT",
  h: "HEURE", heure: "HEURE", heures: "HEURE",
  j: "JOUR", jour: "JOUR", jours: "JOUR",
};

export function lireUnite(s: string): Unite | null {
  return ALIAS_UNITES[sansAccents(s)] ?? null;
}

/** Nombre au format français ou anglais : « 1 250,5 », « 1250.5 », « 1.250,50 ». */
export function lireNombre(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  let t = s.replace(/[\s  ]/g, "").replace(/F?CFA$/i, "");
  if (t === "") return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Découpe un CSV (séparateur « ; » ou « , » détecté automatiquement, guillemets gérés). */
export function lireCsv(texte: string): string[][] {
  const t = texte.replace(/^﻿/, "");
  const premiere = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (premiere.match(/;/g)?.length ?? 0) >= (premiere.match(/,/g)?.length ?? 0) ? ";" : ",";
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      ligne.push(champ); champ = "";
      if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim() !== "")) lignes.push(ligne);
  return lignes;
}

const COLONNES: Record<keyof LigneImportee, string[]> = {
  lot: ["lot", "chapitre", "corpsdetat"],
  designation: ["designation", "libelle", "description", "ouvrage"],
  unite: ["unite", "u", "un"],
  quantite: ["quantite", "qte", "qt"],
  debourseSecUnitaire: ["debourssecunitaire", "debourssec", "deboursesecunitaire", "deboursesec", "ds", "dsu", "coutunitaire"],
  prixUnitaire: ["prixunitaire", "pu", "puht", "prixunitaireht", "prix"],
};

export function analyserTableau(lignes: (string | number | null)[][], lotParDefaut = "Lot unique"): { lignes: LigneImportee[]; erreurs: string[] } {
  const erreurs: string[] = [];
  const iEnTete = lignes.findIndex((l) => l.some((c) => COLONNES.designation.includes(sansAccents(String(c ?? "")))));
  if (iEnTete < 0) return { lignes: [], erreurs: ["Ligne d'en-tête introuvable : une colonne « Désignation » est obligatoire."] };
  const entete = lignes[iEnTete].map((c) => sansAccents(String(c ?? "")));
  const pos = {} as Record<keyof LigneImportee, number>;
  for (const k of Object.keys(COLONNES) as (keyof LigneImportee)[]) pos[k] = entete.findIndex((c) => COLONNES[k].includes(c));
  for (const k of ["unite", "quantite"] as const) if (pos[k] < 0) erreurs.push(`Colonne « ${k === "unite" ? "Unité" : "Quantité"} » introuvable.`);
  if (erreurs.length) return { lignes: [], erreurs };

  const res: LigneImportee[] = [];
  let lotCourant = lotParDefaut;
  lignes.slice(iEnTete + 1).forEach((l, i) => {
    const n = iEnTete + i + 2;
    const val = (k: keyof LigneImportee) => (pos[k] >= 0 ? String(l[pos[k]] ?? "").trim() : "");
    const designation = val("designation");
    if (!designation) return;
    if (val("lot")) lotCourant = val("lot");
    // Ligne de titre de lot (désignation sans unité ni quantité)
    if (!val("unite") && !val("quantite")) {
      if (pos.lot < 0) lotCourant = designation.slice(0, 150);
      return;
    }
    const unite = lireUnite(val("unite"));
    const quantite = lireNombre(pos.quantite >= 0 ? (l[pos.quantite] as string | number) : null);
    if (!unite) return erreurs.push(`Ligne ${n} : unité « ${val("unite")} » non reconnue (m, m², m³, kg, t, u, ft, h, j).`) && undefined;
    if (quantite === null || quantite < 0) return erreurs.push(`Ligne ${n} : quantité invalide.`) && undefined;
    const ds = pos.debourseSecUnitaire >= 0 ? lireNombre(l[pos.debourseSecUnitaire] as string | number) : null;
    const pu = pos.prixUnitaire >= 0 ? lireNombre(l[pos.prixUnitaire] as string | number) : null;
    res.push({ lot: lotCourant.slice(0, 150), designation: designation.slice(0, 500), unite, quantite, debourseSecUnitaire: ds, prixUnitaire: pu });
  });
  if (res.length === 0 && erreurs.length === 0) erreurs.push("Aucune ligne de quantité trouvée.");
  if (res.length > 2000) return { lignes: [], erreurs: ["Plus de 2 000 lignes : découpez le fichier."] };
  return { lignes: res, erreurs };
}
