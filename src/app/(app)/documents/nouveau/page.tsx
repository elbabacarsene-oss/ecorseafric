import { ChampsDepot } from "@/components/Documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { filtreChantiers } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { creerDocument } from "../actions";

export const metadata = { title: "Déposer un document" };

export default async function PageNouveauDocument({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, portee } = await exigerPermission("documents", "creer");
  const sp = await searchParams;
  const chantiers = await db.chantier.findMany({ where: filtreChantiers(user, "creer", "documents") ?? { id: "__aucun__" }, select: { id: true, code: true, nom: true }, orderBy: { code: "desc" } });
  return (
    <>
      <EnTetePage titre="Déposer un document" />
      <div className="carte">
        <FormulaireAction action={creerDocument} libelle="Déposer" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-4">
            <label htmlFor="chantierId" className="etiquette">Chantier</label>
            <select id="chantierId" name="chantierId" className="champ" defaultValue={sp.chantier ?? ""} required={portee !== "tous"}>
              {portee === "tous" && <option value="">— Document de l'entreprise (sans chantier) —</option>}
              {portee !== "tous" && <option value="">— Choisir —</option>}
              {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
            </select>
          </div>
          <ChampsDepot cible={{}} partage rediriger />
        </FormulaireAction>
      </div>
    </>
  );
}
