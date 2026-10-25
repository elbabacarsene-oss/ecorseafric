import type { CategorieIntervenant } from "@prisma/client";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { CATEGORIES } from "@/lib/libelles";
import { creerIntervenant } from "../actions";
import { ChampsIntervenant } from "../ChampsIntervenant";

export const metadata = { title: "Nouvel intervenant" };

export default async function PageNouvelIntervenant({ searchParams }: { searchParams: Promise<{ categorie?: string }> }) {
  await exigerPermission("intervenants", "creer");
  const { categorie } = await searchParams;
  return (
    <>
      <EnTetePage titre="Nouvel intervenant" sousTitre="Le code est attribué automatiquement selon la catégorie." />
      <div className="carte">
        <FormulaireAction action={creerIntervenant} libelle="Créer l'intervenant">
          <ChampsIntervenant categorie={categorie && categorie in CATEGORIES ? (categorie as CategorieIntervenant) : undefined} />
        </FormulaireAction>
      </div>
    </>
  );
}
