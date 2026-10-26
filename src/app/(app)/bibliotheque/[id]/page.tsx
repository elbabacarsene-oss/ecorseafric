import { notFound } from "next/navigation";
import { Champ, Selection } from "@/components/Champs";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { debourseSecSousDetail } from "@/lib/devis-calculs";
import { formatXOF } from "@/lib/format";
import { CATEGORIES_OUVRAGE, TYPES_COMPOSANT, UNITES, UNITES_LONG } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { ajouterComposant, modifierOuvrage, supprimerComposant } from "../actions";
import { ChampsOuvrage } from "../ChampsOuvrage";

export const metadata = { title: "Ouvrage" };

const nb = (v: { toString(): string }) => Number(v.toString()).toLocaleString("fr-SN", { maximumFractionDigits: 4 });

export default async function PageOuvrage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("bibliotheque", "lire");
  const { id } = await params;
  const o = await db.ouvrage.findUnique({ where: { id }, include: { composants: { orderBy: { ordre: "asc" } } } });
  if (!o) notFound();
  const modifiable = peut(user.role, "bibliotheque", "modifier");
  const ds = debourseSecSousDetail(o.composants);

  return (
    <>
      <EnTetePage titre={`${o.code} · ${o.designation}`} sousTitre={`${CATEGORIES_OUVRAGE[o.categorie]} · unité : ${UNITES_LONG[o.unite]}${o.actif ? "" : " · inactif"}`} />
      <section className="carte mb-4">
        <h2 className="mb-1">Sous-détail de prix pour 1 {UNITES[o.unite]}</h2>
        <p className="mb-3 text-xs text-slate-500">Déboursé sec unitaire = Σ (quantité × prix unitaire). Les prix sont ceux saisis par l'entreprise.</p>
        {o.composants.length === 0 ? (
          <p className="mb-3 text-sm text-slate-500">Aucun composant : le déboursé sec devra être saisi directement dans chaque devis.</p>
        ) : (
          <div className="mb-3 overflow-x-auto">
            <table className="tableau">
              <thead><tr><th>Nature</th><th>Désignation</th><th>Unité</th><th className="text-right">Quantité</th><th className="text-right">Prix unitaire</th><th className="text-right">Montant</th>{modifiable && <th></th>}</tr></thead>
              <tbody>
                {o.composants.map((c) => (
                  <tr key={c.id}>
                    <td>{TYPES_COMPOSANT[c.type]}</td>
                    <td>{c.designation}</td>
                    <td>{UNITES[c.unite]}</td>
                    <td className="text-right">{nb(c.quantite)}</td>
                    <td className="whitespace-nowrap text-right">{formatXOF(c.prixUnitaire)}</td>
                    <td className="whitespace-nowrap text-right">{formatXOF(Number(c.quantite) * Number(c.prixUnitaire))}</td>
                    {modifiable && <td><FormulaireAction action={supprimerComposant.bind(null, c.id)} libelle="Retirer" classeBouton="btn-secondaire" className="space-y-1" /></td>}
                  </tr>
                ))}
                <tr className="font-semibold"><td colSpan={5}>Déboursé sec unitaire</td><td className="whitespace-nowrap text-right">{formatXOF(ds)}</td>{modifiable && <td></td>}</tr>
              </tbody>
            </table>
          </div>
        )}
        {modifiable && (
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">Ajouter un composant</summary>
            <FormulaireAction action={ajouterComposant.bind(null, o.id)} libelle="Ajouter" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <Selection nom="type" libelle="Nature" requis options={Object.entries(TYPES_COMPOSANT)} />
              <Champ nom="designation" libelle="Désignation" requis className="lg:col-span-2" placeholder="ex. Ciment CPJ 42,5" />
              <Selection nom="unite" libelle="Unité" requis options={Object.entries(UNITES_LONG)} />
              <Champ nom="quantite" libelle="Quantité" requis inputMode="decimal" placeholder="0,35" />
              <Champ nom="prixUnitaire" libelle="Prix unitaire (F CFA)" requis inputMode="decimal" />
            </FormulaireAction>
          </details>
        )}
      </section>
      {modifiable && (
        <section className="carte">
          <h2 className="mb-3">Caractéristiques</h2>
          <FormulaireAction action={modifierOuvrage.bind(null, o.id)}>
            <ChampsOuvrage o={o} />
          </FormulaireAction>
        </section>
      )}
    </>
  );
}
