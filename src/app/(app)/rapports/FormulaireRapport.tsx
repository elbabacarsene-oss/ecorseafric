import type { RapportJournalier } from "@prisma/client";
import { CaseACocher, Champ, Selection, ZoneTexte } from "@/components/Champs";
import { aujourdhuiDakar, toInputDate } from "@/lib/format";
import { METEOS } from "@/lib/libelles";
import type { LigneMateriau, LigneMateriel, LignePersonnel, LigneTravaux } from "@/lib/rapports";
import { ListesRapport, type ValeursRapport } from "./ChampsRapport";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

export function valeursDe(r: RapportJournalier): ValeursRapport {
  return {
    personnel: (r.personnel as LignePersonnel[]).map((l) => ({ specialite: l.specialite, nombre: s(l.nombre), heures: s(l.heures) })),
    travaux: (r.travaux as LigneTravaux[]).map((l) => ({ designation: l.designation, unite: l.unite ?? "", quantite: s(l.quantite), tacheId: l.tacheId ?? "", avancement: s(l.avancement) })),
    consommes: (r.materiauxConsommes as LigneMateriau[]).map((l) => ({ designation: l.designation, unite: l.unite, quantite: s(l.quantite) })),
    livres: (r.materiauxLivres as LigneMateriau[]).map((l) => ({ designation: l.designation, unite: l.unite, quantite: s(l.quantite), fournisseur: l.fournisseur ?? "" })),
    materiel: (r.materiel as LigneMateriel[]).map((l) => ({ designation: l.designation, heures: s(l.heures), etat: l.etat })),
  };
}

/** Champs du rapport journalier : une colonne sur smartphone, saisie rapide sur le chantier. */
export function ChampsRapportJournalier({ r, chantiers, chantierId, taches }: { r?: RapportJournalier; chantiers?: [string, string][]; chantierId?: string; taches: [string, string][] }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {chantiers ? (
          <Selection nom="chantierId" libelle="Chantier" requis options={chantiers} defaut={chantierId} className="sm:col-span-2" />
        ) : null}
        <Champ nom="date" libelle="Date" type="date" requis defaut={toInputDate(r?.date ?? aujourdhuiDakar())} max={toInputDate(aujourdhuiDakar())} />
        <Selection nom="meteo" libelle="Météo" options={Object.entries(METEOS)} defaut={r?.meteo} />
        <Champ nom="meteoDetails" libelle="Précisions météo" defaut={r?.meteoDetails} placeholder="ex. pluie l'après-midi, arrêt 2 h" className="sm:col-span-2" />
      </div>
      <ListesRapport taches={taches} valeurs={r ? valeursDe(r) : undefined} />
      <div className="grid gap-3 sm:grid-cols-2">
        <ZoneTexte nom="travauxRealises" libelle="Travaux réalisés (description)" defaut={r?.travauxRealises} lignes={3} className="sm:col-span-2" />
        <ZoneTexte nom="incidents" libelle="Incidents (sécurité, accidents, dégâts)" defaut={r?.incidents} lignes={2} />
        <ZoneTexte nom="difficultes" libelle="Difficultés" defaut={r?.difficultes} lignes={2} />
        <ZoneTexte nom="instructions" libelle="Instructions reçues ou données" defaut={r?.instructions} lignes={2} />
        <ZoneTexte nom="observations" libelle="Observations" defaut={r?.observations} lignes={2} />
      </div>
      <CaseACocher nom="soumettre" libelle="Soumettre à validation dès l'enregistrement" aide="Sinon le rapport reste en brouillon : les photos peuvent être ajoutées ensuite depuis le rapport." />
    </div>
  );
}
