import { notFound } from "next/navigation";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { modifierIntervenant } from "../../actions";
import { ChampsIntervenant } from "../../ChampsIntervenant";

export const metadata = { title: "Modifier un intervenant" };

export default async function PageModifierIntervenant({ params }: { params: Promise<{ id: string }> }) {
  await exigerPermission("intervenants", "modifier");
  const { id } = await params;
  const i = await db.intervenant.findUnique({ where: { id } });
  if (!i) notFound();
  return (
    <>
      <EnTetePage titre={`Modifier ${i.nom}`} sousTitre={`Code ${i.code}`} />
      <div className="carte">
        <FormulaireAction action={modifierIntervenant.bind(null, i.id)} libelle="Enregistrer les modifications">
          <ChampsIntervenant i={i} />
        </FormulaireAction>
      </div>
    </>
  );
}
