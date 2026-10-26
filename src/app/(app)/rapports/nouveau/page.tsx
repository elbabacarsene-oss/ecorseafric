import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, EtatVide } from "@/components/ui";
import { chantierAccessible, filtreChantiers } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { creerRapport } from "../actions";
import { ChampsRapportJournalier } from "../FormulaireRapport";
import { tachesDuChantier } from "../options";

export const metadata = { title: "Nouveau rapport journalier" };

export default async function PageNouveauRapport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("rapports", "creer");
  const sp = await searchParams;
  const chantiers = await db.chantier.findMany({
    where: { AND: [filtreChantiers(user, "creer", "rapports")!, { statut: { in: ["EN_PREPARATION", "EN_COURS", "SUSPENDU", "RECEPTION_PROVISOIRE"] } }] },
    select: { id: true, code: true, nom: true },
    orderBy: { code: "desc" },
  });
  const chantierId = sp.chantier && (await chantierAccessible(user, sp.chantier, "creer", "rapports")) ? sp.chantier : chantiers.length === 1 ? chantiers[0].id : undefined;
  const taches = chantierId ? await tachesDuChantier(chantierId) : [];
  return (
    <>
      <EnTetePage titre="Rapport journalier" sousTitre="Un rapport par chantier et par jour. Les photos s'ajoutent après l'enregistrement." />
      {chantiers.length === 0 ? (
        <EtatVide message="Aucun chantier en cours ne vous est affecté." />
      ) : (
        <div className="carte">
          {!chantierId && chantiers.length > 1 && (
            <form method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
              <label className="flex-1 text-sm">Choisir le chantier pour proposer ses tâches de planning
                <select name="chantier" className="champ mt-1" defaultValue="">
                  <option value="">— Choisir —</option>
                  {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
                </select>
              </label>
              <button className="btn-secondaire">Continuer</button>
            </form>
          )}
          <FormulaireAction action={creerRapport} libelle="Enregistrer le rapport" className="space-y-4">
            <ChampsRapportJournalier chantiers={chantiers.map((c) => [c.id, `${c.code} · ${c.nom}`])} chantierId={chantierId} taches={taches} />
          </FormulaireAction>
        </div>
      )}
    </>
  );
}
