"use client";

import { useState } from "react";

type Opt = [string, string][];
type Ligne = Record<string, string>;
type Colonne = { nom: string; libelle: string; type?: "text" | "number" | "select"; options?: Opt; largeur?: string; placeholder?: string };

const UNITES: Opt = [["M", "m"], ["M2", "m²"], ["M3", "m³"], ["KG", "kg"], ["TONNE", "t"], ["U", "u"], ["FORFAIT", "ft"], ["HEURE", "h"], ["JOUR", "j"]];
const ETATS: Opt = [["UTILISE", "Utilisé"], ["DISPONIBLE", "Disponible, non utilisé"], ["EN_PANNE", "En panne"]];

/** Liste de lignes ajoutables (personnel, travaux, matériaux, matériel). Chaque champ est envoyé sous le nom prefixe.colonne. */
function Liste({ titre, prefixe, colonnes, initiales, ajout }: { titre: string; prefixe: string; colonnes: Colonne[]; initiales: Ligne[]; ajout: string }) {
  // Identifiant stable par ligne : retirer une ligne ne décale pas les valeurs saisies des suivantes.
  const [lignes, setLignes] = useState<{ cle: number; v: Ligne }[]>(() => initiales.map((v, i) => ({ cle: i, v })));
  const [suivant, setSuivant] = useState(initiales.length);
  return (
    <fieldset className="rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-sm font-semibold text-ecorse-bleu-800">{titre}</legend>
      {lignes.map(({ cle, v: l }) => (
        <div key={cle} className="mb-2 grid grid-cols-2 gap-2 border-b border-slate-100 pb-2 sm:flex sm:items-end sm:border-0 sm:pb-0">
          {colonnes.map((c) => (
            <label key={c.nom} className={`text-xs text-slate-600 ${c.largeur ?? "sm:flex-1"} ${c.nom === "designation" || c.nom === "specialite" ? "col-span-2" : ""}`}>
              {c.libelle}
              {c.type === "select" ? (
                <select name={`${prefixe}.${c.nom}`} defaultValue={l[c.nom] ?? ""} className="champ mt-0.5">
                  <option value="">—</option>
                  {c.options!.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              ) : (
                <input name={`${prefixe}.${c.nom}`} defaultValue={l[c.nom] ?? ""} inputMode={c.type === "number" ? "decimal" : undefined} placeholder={c.placeholder} className="champ mt-0.5" />
              )}
            </label>
          ))}
          <button type="button" onClick={() => setLignes(lignes.filter((x) => x.cle !== cle))} className="col-span-2 self-end rounded-md px-2 py-2 text-sm text-rose-600 hover:bg-rose-50 sm:col-span-1" aria-label="Retirer la ligne">Retirer</button>
        </div>
      ))}
      <button type="button" onClick={() => {
          setLignes([...lignes, { cle: suivant, v: {} }]);
          setSuivant(suivant + 1);
        }} className="btn-secondaire mt-1 w-full sm:w-auto">+ {ajout}</button>
    </fieldset>
  );
}

export type ValeursRapport = {
  personnel: Ligne[];
  travaux: Ligne[];
  consommes: Ligne[];
  livres: Ligne[];
  materiel: Ligne[];
};

export function ListesRapport({ taches, valeurs }: { taches: Opt; valeurs?: ValeursRapport }) {
  return (
    <div className="space-y-3">
      <Liste titre="Effectif présent par spécialité" prefixe="personnel" ajout="spécialité" initiales={valeurs?.personnel ?? [{ specialite: "", nombre: "", heures: "8" }]}
        colonnes={[
          { nom: "specialite", libelle: "Spécialité", placeholder: "ex. Maçons" },
          { nom: "nombre", libelle: "Nombre", type: "number", largeur: "sm:w-24" },
          { nom: "heures", libelle: "Heures / pers.", type: "number", largeur: "sm:w-28" },
        ]} />
      <Liste titre="Quantités exécutées et avancement" prefixe="travaux" ajout="ouvrage exécuté" initiales={valeurs?.travaux ?? []}
        colonnes={[
          { nom: "designation", libelle: "Ouvrage / travaux", placeholder: "ex. Élévation agglos de 15" },
          { nom: "unite", libelle: "Unité", type: "select", options: UNITES, largeur: "sm:w-24" },
          { nom: "quantite", libelle: "Quantité", type: "number", largeur: "sm:w-24" },
          ...(taches.length ? [
            { nom: "tacheId", libelle: "Tâche du planning", type: "select" as const, options: taches, largeur: "sm:w-56" },
            { nom: "avancement", libelle: "Avancement %", type: "number" as const, largeur: "sm:w-28" },
          ] : []),
        ]} />
      <Liste titre="Matériaux consommés" prefixe="consommes" ajout="matériau consommé" initiales={valeurs?.consommes ?? []}
        colonnes={[
          { nom: "designation", libelle: "Matériau", placeholder: "ex. Ciment CPJ 42,5" },
          { nom: "unite", libelle: "Unité", type: "select", options: UNITES, largeur: "sm:w-24" },
          { nom: "quantite", libelle: "Quantité", type: "number", largeur: "sm:w-24" },
        ]} />
      <Liste titre="Matériaux livrés" prefixe="livres" ajout="livraison" initiales={valeurs?.livres ?? []}
        colonnes={[
          { nom: "designation", libelle: "Matériau" },
          { nom: "unite", libelle: "Unité", type: "select", options: UNITES, largeur: "sm:w-24" },
          { nom: "quantite", libelle: "Quantité", type: "number", largeur: "sm:w-24" },
          { nom: "fournisseur", libelle: "Fournisseur / BL", largeur: "sm:w-48" },
        ]} />
      <Liste titre="Matériel et engins" prefixe="materiel" ajout="matériel" initiales={valeurs?.materiel ?? []}
        colonnes={[
          { nom: "designation", libelle: "Matériel / engin", placeholder: "ex. Bétonnière 350 L" },
          { nom: "heures", libelle: "Heures", type: "number", largeur: "sm:w-24" },
          { nom: "etat", libelle: "État", type: "select", options: ETATS, largeur: "sm:w-48" },
        ]} />
      {taches.length > 0 && <p className="text-xs text-slate-500">L'avancement saisi sur une tâche du planning y sera reporté lors de la validation du rapport.</p>}
    </div>
  );
}
