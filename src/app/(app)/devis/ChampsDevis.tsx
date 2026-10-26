import type { Devis } from "@prisma/client";
import { Champ, Selection, ZoneTexte } from "@/components/Champs";
import { toInputDate } from "@/lib/format";
import { TYPES_PROJET } from "@/lib/libelles";

type Opt = [string, string][];
const pct = (v: { toString(): string } | null | undefined, defaut: string) => (v === null || v === undefined ? defaut : Number(v.toString()).toString().replace(".", ","));

export function ChampsDevis({ d, clients, chantiers, voirCouts }: { d?: Devis; clients: Opt; chantiers: Opt; voirCouts: boolean }) {
  return (
    <div className="space-y-5">
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Identification</legend>
        <Champ nom="objet" libelle="Objet" requis defaut={d?.objet} className="sm:col-span-2" placeholder="ex. Construction d'une villa R+1" />
        <Selection nom="typeProjet" libelle="Type de projet" options={Object.entries(TYPES_PROJET)} defaut={d?.typeProjet} />
        <Selection nom="clientId" libelle="Client" requis options={clients} defaut={d?.clientId} aide="Fiche de la maîtrise d'ouvrage (Parties prenantes)." />
        <Selection nom="chantierId" libelle="Chantier existant (facultatif)" options={chantiers} defaut={d?.chantierId} vide="— Aucun (nouveau projet) —" />
        <Champ nom="lieu" libelle="Lieu des travaux" defaut={d?.lieu} />
        <Champ nom="dateDevis" libelle="Date du devis" type="date" defaut={toInputDate(d?.dateDevis ?? new Date())} />
        <Champ nom="dateValidite" libelle="Valable jusqu'au" type="date" defaut={toInputDate(d?.dateValidite)} />
        <Champ nom="delaiExecutionJours" libelle="Délai d'exécution (jours)" type="number" min={1} defaut={d?.delaiExecutionJours} />
        <ZoneTexte nom="conditions" libelle="Conditions (paiement, validité, exclusions…)" defaut={d?.conditions} className="sm:col-span-2 lg:col-span-3" lignes={3} />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Coefficients de prix</legend>
        {voirCouts ? (
          <>
            <Champ nom="tauxFraisChantier" libelle="Frais de chantier (% du DS)" inputMode="decimal" defaut={pct(d?.tauxFraisChantier, "0")} />
            <Champ nom="tauxFraisGeneraux" libelle="Frais généraux (%)" inputMode="decimal" defaut={pct(d?.tauxFraisGeneraux, "0")} />
            <Champ nom="tauxMarge" libelle="Marge (%)" inputMode="decimal" defaut={pct(d?.tauxMarge, "0")} />
          </>
        ) : (
          <>
            <input type="hidden" name="tauxFraisChantier" value={pct(d?.tauxFraisChantier, "0")} />
            <input type="hidden" name="tauxFraisGeneraux" value={pct(d?.tauxFraisGeneraux, "0")} />
            <input type="hidden" name="tauxMarge" value={pct(d?.tauxMarge, "0")} />
          </>
        )}
        <Champ nom="tauxTva" libelle="TVA (%)" inputMode="decimal" defaut={pct(d?.tauxTva, "18")} aide="18 % au Sénégal ; 0 si exonéré." />
        <ZoneTexte nom="notesInternes" libelle="Notes internes (non imprimées)" defaut={d?.notesInternes} className="sm:col-span-2 lg:col-span-4" lignes={2} />
      </fieldset>
    </div>
  );
}
