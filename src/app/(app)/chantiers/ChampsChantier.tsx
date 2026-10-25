import type { Chantier, Intervenant, TypeIntervenant } from "@prisma/client";
import { Champ, ChampMontant, Selection, ZoneTexte } from "@/components/Champs";
import { toInputDate } from "@/lib/format";
import { REGIONS, STATUTS_CHANTIER, TYPES_PROJET } from "@/lib/libelles";
import { ROLES_CLES } from "@/lib/roles-cles";

type Option = Pick<Intervenant, "id" | "nom" | "prenom" | "code" | "categorie" | "type">;

export function ChampsChantier({
  c, intervenants, peutMarche, peutBudget,
}: {
  c?: Chantier | null;
  intervenants: Option[];
  peutMarche: boolean;
  peutBudget: boolean;
}) {
  const optionsPour = (r: (typeof ROLES_CLES)[number]) =>
    intervenants
      .filter((i) => (r.categorie ? i.categorie === r.categorie : true) && (r.types ? (r.types as readonly TypeIntervenant[]).includes(i.type) : true))
      .map((i) => [i.id, `${i.nom}${i.prenom ? " " + i.prenom : ""} (${i.code})`] as [string, string]);

  return (
    <div className="space-y-6">
      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Identification</legend>
        <Champ nom="code" libelle="Code chantier" defaut={c?.code} disabled={!!c} aide={c ? "Le code ne peut pas être modifié." : "Laisser vide pour une numérotation automatique (CH-AAAA-NNN)."} />
        <Champ nom="nom" libelle="Nom du chantier" requis defaut={c?.nom} className="lg:col-span-2" />
        <Selection nom="typeProjet" libelle="Type de projet" requis options={Object.entries(TYPES_PROJET)} defaut={c?.typeProjet} />
        <Selection nom="statut" libelle="Statut" requis options={Object.entries(STATUTS_CHANTIER)} defaut={c?.statut ?? "EN_PREPARATION"} vide={false} />
        <ZoneTexte nom="description" libelle="Description / objet des travaux" defaut={c?.description} className="sm:col-span-2 lg:col-span-3" />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Intervenants clés</legend>
        {ROLES_CLES.map((r) => (
          <Selection
            key={r.champ}
            nom={r.champ}
            libelle={r.libelle}
            requis={r.champ === "clientId"}
            options={optionsPour(r)}
            defaut={c?.[r.champ as keyof Chantier] as string | null}
            vide={r.champ === "clientId" ? "— Choisir —" : "— Aucun —"}
          />
        ))}
        <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
          Les listes proposent les intervenants de la catégorie attendue. Créez-les d'abord dans Parties prenantes si besoin.
        </p>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Localisation</legend>
        <Champ nom="adresse" libelle="Adresse" defaut={c?.adresse} className="lg:col-span-2" />
        <Champ nom="ville" libelle="Ville" defaut={c?.ville} />
        <Selection nom="region" libelle="Région" options={Object.entries(REGIONS)} defaut={c?.region} />
        <Champ nom="latitude" libelle="Latitude GPS (facultatif)" defaut={c?.latitude?.toString()} inputMode="decimal" placeholder="14.716677" />
        <Champ nom="longitude" libelle="Longitude GPS (facultatif)" defaut={c?.longitude?.toString()} inputMode="decimal" placeholder="-17.467686" />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Délais</legend>
        <Champ nom="dateDemarrage" libelle="Date de démarrage" type="date" defaut={toInputDate(c?.dateDemarrage)} />
        <Champ nom="dateFinContractuelle" libelle="Date contractuelle de fin" type="date" defaut={toInputDate(c?.dateFinContractuelle)} />
        <Champ nom="dateFinReelle" libelle="Date de fin réelle" type="date" defaut={toInputDate(c?.dateFinReelle)} />
      </fieldset>

      {(peutMarche || peutBudget) && (
        <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-ecorse-bleu-800">Montants (F CFA)</legend>
          {peutMarche && <ChampMontant nom="montantMarche" libelle="Montant du marché (initial)" defaut={c?.montantMarche?.toString()} aide="Hors avenants. Les avenants approuvés s'y ajoutent automatiquement." />}
          {peutBudget && <ChampMontant nom="budgetInitial" libelle="Budget initial (coût prévisionnel)" defaut={c?.budgetInitial?.toString()} />}
          {peutBudget && <ChampMontant nom="budgetActualise" libelle="Budget actualisé" defaut={c?.budgetActualise?.toString()} aide="Laisser vide tant qu'il n'y a pas de révision." />}
        </fieldset>
      )}
    </div>
  );
}
