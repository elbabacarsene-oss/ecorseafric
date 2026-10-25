import type { CategorieIntervenant, Intervenant } from "@prisma/client";
import { CaseACocher, Champ, Selection, ZoneTexte } from "@/components/Champs";
import { CATEGORIES, REGIONS, TYPES_INTERVENANT, TYPES_PAR_CATEGORIE } from "@/lib/libelles";

export function ChampsIntervenant({ i, categorie }: { i?: Intervenant | null; categorie?: CategorieIntervenant }) {
  const typeDefaut = i?.type ?? (categorie ? TYPES_PAR_CATEGORIE[categorie][0] : "");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label htmlFor="type" className="etiquette">
          Catégorie et type <span className="text-rose-600">*</span>
        </label>
        <select id="type" name="type" required defaultValue={typeDefaut} className="champ">
          <option value="">— Choisir —</option>
          {(Object.keys(TYPES_PAR_CATEGORIE) as CategorieIntervenant[]).map((c) => (
            <optgroup key={c} label={CATEGORIES[c]}>
              {TYPES_PAR_CATEGORIE[c].map((t) => (
                <option key={t} value={t}>{TYPES_INTERVENANT[t]}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="flex items-end pb-2">
        <CaseACocher nom="personneMorale" libelle="Personne morale (société, administration…)" defaut={i?.personneMorale} />
      </div>
      <Champ nom="nom" libelle="Nom ou raison sociale" requis defaut={i?.nom} />
      <Champ nom="prenom" libelle="Prénom (personne physique)" defaut={i?.prenom} />
      <Champ nom="fonction" libelle="Fonction" defaut={i?.fonction} />
      <Champ nom="entreprise" libelle="Entreprise / organisme de rattachement" defaut={i?.entreprise} />
      <Champ nom="telephone" libelle="Téléphone" type="tel" defaut={i?.telephone} placeholder="+221 77 000 00 00" />
      <Champ nom="telephone2" libelle="Téléphone secondaire" type="tel" defaut={i?.telephone2} />
      <Champ nom="email" libelle="E-mail" type="email" defaut={i?.email} />
      <Champ nom="ville" libelle="Ville" defaut={i?.ville} />
      <Champ nom="adresse" libelle="Adresse" defaut={i?.adresse} className="sm:col-span-2" />
      <Selection nom="region" libelle="Région" options={Object.entries(REGIONS)} defaut={i?.region} />
      <div className="grid grid-cols-2 gap-4">
        <Champ nom="ninea" libelle="NINEA" defaut={i?.ninea} />
        <Champ nom="rccm" libelle="RCCM" defaut={i?.rccm} />
      </div>
      <ZoneTexte nom="notes" libelle="Notes" defaut={i?.notes} className="sm:col-span-2" />
    </div>
  );
}
