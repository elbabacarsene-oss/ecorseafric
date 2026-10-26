import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { peut } from "@/lib/permissions";
import { creerChantier } from "../actions";
import { ChampsChantier } from "../ChampsChantier";

export const metadata = { title: "Nouveau chantier" };

export default async function PageNouveauChantier() {
  const { user } = await exigerPermission("chantiers", "creer");
  const intervenants = await db.intervenant.findMany({
    where: { actif: true },
    select: { id: true, nom: true, prenom: true, code: true, categorie: true, type: true },
    orderBy: { nom: "asc" },
  });
  return (
    <>
      <EnTetePage titre="Nouveau chantier" />
      <div className="carte">
        <FormulaireAction action={creerChantier} libelle="Créer le chantier">
          <ChampsChantier intervenants={intervenants} peutMarche={peut(user.role, "chantiers_marche", "modifier")} peutBudget={peut(user.role, "chantiers_budget", "modifier")} />
        </FormulaireAction>
      </div>
    </>
  );
}
