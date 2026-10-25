import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerChantier } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { peut } from "@/lib/permissions";
import { ROLES_CLES } from "@/lib/roles-cles";
import { modifierChantier } from "../../actions";
import { ChampsChantier } from "../../ChampsChantier";

export const metadata = { title: "Modifier un chantier" };

export default async function PageModifierChantier({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("chantiers", "modifier");
  const { id } = await params;
  await exigerChantier(user, id, "modifier");
  const c = await db.chantier.findUniqueOrThrow({ where: { id } });
  // Les intervenants déjà désignés restent proposés même s'ils ont été désactivés, pour ne pas les effacer sans le vouloir.
  const actuels = ROLES_CLES.map((r) => c[r.champ]).filter((x): x is string => !!x);
  const intervenants = await db.intervenant.findMany({
    where: { OR: [{ actif: true }, { id: { in: actuels } }] },
    select: { id: true, nom: true, prenom: true, code: true, categorie: true, type: true },
    orderBy: { nom: "asc" },
  });
  return (
    <>
      <EnTetePage titre={`Modifier ${c.code}`} sousTitre={c.nom} />
      <div className="carte">
        <FormulaireAction action={modifierChantier.bind(null, c.id)} libelle="Enregistrer les modifications">
          <ChampsChantier c={c} intervenants={intervenants} peutMarche={peut(user.role, "chantiers_marche", "modifier")} peutBudget={peut(user.role, "chantiers_budget", "modifier")} />
        </FormulaireAction>
      </div>
    </>
  );
}
