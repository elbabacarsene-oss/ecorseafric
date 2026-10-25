import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { creerUtilisateur } from "../../actions";
import { ChampsUtilisateur } from "../ChampsUtilisateur";

export const metadata = { title: "Nouvel utilisateur" };

export default async function PageNouvelUtilisateur({ searchParams }: { searchParams: Promise<{ intervenant?: string }> }) {
  await exigerPermission("utilisateurs", "creer");
  const { intervenant } = await searchParams;
  const libres = await db.intervenant.findMany({ where: { utilisateur: null, actif: true }, orderBy: { nom: "asc" }, select: { id: true, code: true, nom: true, prenom: true } });
  return (
    <>
      <EnTetePage titre="Nouvel utilisateur" sousTitre="Un mot de passe provisoire sera généré et affiché une seule fois." />
      <div className="carte">
        <FormulaireAction action={creerUtilisateur} libelle="Créer le compte" reinitialiser>
          <ChampsUtilisateur intervenants={libres.map((i) => [i.id, `${i.nom}${i.prenom ? " " + i.prenom : ""} (${i.code})`])} intervenantDefaut={intervenant} />
        </FormulaireAction>
      </div>
    </>
  );
}
