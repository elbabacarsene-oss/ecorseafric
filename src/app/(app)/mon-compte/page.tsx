import { Champ } from "@/components/Champs";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, Info } from "@/components/ui";
import { exigerUtilisateur, LONGUEUR_MIN_MDP } from "@/lib/auth";
import { ROLES } from "@/lib/libelles";
import { actionChangerMotDePasse } from "../../actions-session";

export const metadata = { title: "Mon compte" };

export default async function MonCompte() {
  const u = await exigerUtilisateur();
  return (
    <>
      <EnTetePage titre="Mon compte" />
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="carte">
          <dl className="space-y-3">
            <Info libelle="Nom">{u.prenom} {u.nom}</Info>
            <Info libelle="E-mail">{u.email}</Info>
            <Info libelle="Rôle">{ROLES[u.role]}</Info>
          </dl>
        </section>
        <section className="carte">
          <h2 className="mb-3">Changer mon mot de passe</h2>
          <FormulaireAction action={actionChangerMotDePasse} libelle="Changer le mot de passe" reinitialiser>
            <Champ nom="actuel" libelle="Mot de passe actuel" type="password" requis autoComplete="current-password" />
            <Champ nom="nouveau" libelle="Nouveau mot de passe" type="password" requis minLength={LONGUEUR_MIN_MDP} autoComplete="new-password" />
            <Champ nom="confirmation" libelle="Confirmation" type="password" requis autoComplete="new-password" />
          </FormulaireAction>
        </section>
      </div>
    </>
  );
}
