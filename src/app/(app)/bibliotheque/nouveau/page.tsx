import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { creerOuvrage } from "../actions";
import { ChampsOuvrage } from "../ChampsOuvrage";

export const metadata = { title: "Nouvel ouvrage" };

export default async function PageNouvelOuvrage() {
  await exigerPermission("bibliotheque", "creer");
  return (
    <>
      <EnTetePage titre="Nouvel ouvrage" sousTitre="Le sous-détail de prix (matériaux, main-d'œuvre, matériel…) se saisit après la création." />
      <div className="carte">
        <FormulaireAction action={creerOuvrage} libelle="Créer l'ouvrage">
          <ChampsOuvrage />
        </FormulaireAction>
      </div>
    </>
  );
}
