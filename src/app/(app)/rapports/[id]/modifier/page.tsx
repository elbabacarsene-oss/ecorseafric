import { notFound, redirect } from "next/navigation";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { chantierAccessible } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { modifierRapport } from "../../actions";
import { ChampsRapportJournalier } from "../../FormulaireRapport";
import { tachesDuChantier } from "../../options";

export const metadata = { title: "Modifier le rapport" };

export default async function PageModifierRapport({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("rapports", "modifier");
  const { id } = await params;
  const r = await db.rapportJournalier.findUnique({ where: { id }, include: { chantier: { select: { code: true, nom: true } } } });
  if (!r || !(await chantierAccessible(user, r.chantierId, "modifier", "rapports"))) notFound();
  if (r.statut !== "BROUILLON") redirect(`/rapports/${id}`);
  return (
    <>
      <EnTetePage titre={`Rapport du ${formatDate(r.date)}`} sousTitre={`${r.chantier.code} · ${r.chantier.nom}`} />
      {r.motifRenvoi && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Renvoyé pour correction : {r.motifRenvoi}</p>}
      <div className="carte">
        <FormulaireAction action={modifierRapport.bind(null, id)} libelle="Enregistrer" className="space-y-4">
          <ChampsRapportJournalier r={r} taches={await tachesDuChantier(r.chantierId)} />
        </FormulaireAction>
      </div>
    </>
  );
}
