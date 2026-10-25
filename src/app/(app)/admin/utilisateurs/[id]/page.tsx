import { notFound } from "next/navigation";
import { CaseACocher } from "@/components/Champs";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { modifierUtilisateur, reinitialiserMotDePasse } from "../../actions";
import { ChampsUtilisateur } from "../ChampsUtilisateur";

export const metadata = { title: "Modifier un utilisateur" };

export default async function PageUtilisateur({ params }: { params: Promise<{ id: string }> }) {
  await exigerPermission("utilisateurs", "modifier");
  const { id } = await params;
  const u = await db.utilisateur.findUnique({ where: { id } });
  if (!u) notFound();
  const fiches = await db.intervenant.findMany({
    where: { OR: [{ utilisateur: null }, { id: u.intervenantId ?? "" }] },
    orderBy: { nom: "asc" },
    select: { id: true, code: true, nom: true, prenom: true },
  });
  return (
    <>
      <EnTetePage titre={`${u.prenom} ${u.nom}`} sousTitre={u.email} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="carte lg:col-span-2">
          <FormulaireAction action={modifierUtilisateur.bind(null, u.id)} libelle="Enregistrer">
            <ChampsUtilisateur u={u} intervenants={fiches.map((i) => [i.id, `${i.nom}${i.prenom ? " " + i.prenom : ""} (${i.code})`])} />
            <CaseACocher nom="actif" libelle="Compte actif" defaut={u.actif} aide="Désactiver ferme immédiatement les sessions ouvertes." />
          </FormulaireAction>
        </div>
        <div className="carte">
          <h2 className="mb-2">Mot de passe</h2>
          <p className="mb-3 text-sm text-slate-500">Génère un nouveau mot de passe provisoire et ferme les sessions de l'utilisateur.</p>
          <FormulaireAction action={reinitialiserMotDePasse.bind(null, u.id)} libelle="Réinitialiser" classeBouton="btn-secondaire" confirmation="Réinitialiser le mot de passe de cet utilisateur ?" />
        </div>
      </div>
    </>
  );
}
