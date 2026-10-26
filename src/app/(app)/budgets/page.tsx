import Link from "next/link";
import { EnTetePage, EtatVide } from "@/components/ui";
import { filtreChantiers } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { totauxBudget } from "@/lib/budget-calculs";
import { montantMarcheActualise } from "@/lib/calculs";
import { db } from "@/lib/db";
import { formatXOF } from "@/lib/format";
import { STATUTS_BUDGET } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Budgets" };

export default async function PageBudgets() {
  const { user } = await exigerPermission("budgets", "lire");
  const voirMarche = peut(user.role, "chantiers_marche", "lire");
  const chantiers = await db.chantier.findMany({
    where: { AND: [filtreChantiers(user, "lire", "budgets")!, { statut: { notIn: ["ANNULE"] } }] },
    include: { lignesBudget: true, avenants: { select: { statut: true, montant: true, delaiSupplementaireJours: true } } },
    orderBy: { code: "desc" },
  });
  return (
    <>
      <EnTetePage titre="Budgets des chantiers" sousTitre="Budget initial validé, budget actualisé et marge prévisionnelle. Les dépenses réelles seront comparées à l'étape 4." />
      {chantiers.length === 0 ? <EtatVide message="Aucun chantier." /> : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead><tr><th>Chantier</th><th>Statut du budget</th><th className="text-right">Initial</th><th className="text-right">Actualisé</th><th className="text-right">Écart</th>{voirMarche && <th className="text-right">Marché actualisé</th>}{voirMarche && <th className="text-right">Marge prévisionnelle</th>}</tr></thead>
            <tbody>
              {chantiers.map((c) => {
                const t = totauxBudget(c.lignesBudget);
                const detaille = c.lignesBudget.length > 0;
                const budget = detaille ? t.actualise : Number(c.budgetActualise ?? c.budgetInitial);
                const marche = montantMarcheActualise(c);
                return (
                  <tr key={c.id}>
                    <td><Link className="lien" href={`/chantiers/${c.id}/budget`}>{c.code}</Link> <span className="text-xs text-slate-500">{c.nom}</span></td>
                    <td>{STATUTS_BUDGET[c.budgetStatut]}{!detaille && Number(c.budgetInitial) > 0 && <span className="block text-xs text-slate-500">montant global saisi sur la fiche</span>}</td>
                    <td className="whitespace-nowrap text-right">{detaille ? formatXOF(t.initial) : Number(c.budgetInitial) > 0 ? formatXOF(c.budgetInitial) : "—"}</td>
                    <td className="whitespace-nowrap text-right">{detaille ? formatXOF(t.actualise) : c.budgetActualise !== null ? formatXOF(c.budgetActualise) : "—"}</td>
                    <td className={`whitespace-nowrap text-right ${t.ecart > 0 ? "text-rose-700" : ""}`}>{detaille ? formatXOF(t.ecart) : "—"}</td>
                    {voirMarche && <td className="whitespace-nowrap text-right">{formatXOF(marche)}</td>}
                    {voirMarche && <td className={`whitespace-nowrap text-right ${marche - budget < 0 ? "text-rose-700" : ""}`}>{budget > 0 && marche > 0 ? formatXOF(marche - budget) : "Non calculable"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
