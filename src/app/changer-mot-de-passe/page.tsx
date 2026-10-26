import { FormulaireAction } from "@/components/FormulaireAction";
import { Champ } from "@/components/Champs";
import { exigerUtilisateur, LONGUEUR_MIN_MDP } from "@/lib/auth";
import { actionChangerMotDePasse } from "../actions-session";

export const metadata = { title: "Changer le mot de passe" };

export default async function PageChangerMdp() {
  const user = await exigerUtilisateur();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="carte w-full max-w-md">
        <h1 className="mb-1">Choisissez votre mot de passe</h1>
        <p className="mb-4 text-sm text-slate-500">
          {user.doitChangerMdp ? "Pour votre première connexion, remplacez le mot de passe provisoire. " : ""}
          Au moins {LONGUEUR_MIN_MDP} caractères, avec des lettres et des chiffres.
        </p>
        <FormulaireAction action={actionChangerMotDePasse} libelle="Valider">
          <Champ nom="actuel" libelle="Mot de passe actuel" type="password" requis autoComplete="current-password" />
          <Champ nom="nouveau" libelle="Nouveau mot de passe" type="password" requis autoComplete="new-password" minLength={LONGUEUR_MIN_MDP} />
          <Champ nom="confirmation" libelle="Confirmer le nouveau mot de passe" type="password" requis autoComplete="new-password" />
        </FormulaireAction>
      </div>
    </main>
  );
}
