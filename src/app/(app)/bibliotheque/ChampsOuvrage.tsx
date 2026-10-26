import type { Ouvrage } from "@prisma/client";
import { CaseACocher, Champ, Selection, ZoneTexte } from "@/components/Champs";
import { CATEGORIES_OUVRAGE, UNITES_LONG } from "@/lib/libelles";

export function ChampsOuvrage({ o }: { o?: Ouvrage }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Champ nom="code" libelle="Code" requis defaut={o?.code} disabled={!!o} placeholder="ex. BA-350" />
      <Selection nom="categorie" libelle="Catégorie" requis options={Object.entries(CATEGORIES_OUVRAGE)} defaut={o?.categorie} />
      <Champ nom="designation" libelle="Désignation" requis defaut={o?.designation} className="sm:col-span-2" placeholder="ex. Béton armé dosé à 350 kg/m³ pour poteaux" />
      <Selection nom="unite" libelle="Unité" requis options={Object.entries(UNITES_LONG)} defaut={o?.unite} />
      <ZoneTexte nom="description" libelle="Description / prescriptions" defaut={o?.description} className="sm:col-span-2 lg:col-span-3" lignes={2} />
      {o && <CaseACocher nom="actif" libelle="Ouvrage actif" defaut={o.actif} aide="Un ouvrage inactif n'est plus proposé dans les devis." />}
    </div>
  );
}
