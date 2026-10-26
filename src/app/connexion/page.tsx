import { redirect } from "next/navigation";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Champ } from "@/components/Champs";
import { utilisateurCourant } from "@/lib/auth";
import { db } from "@/lib/db";
import { actionConnexion } from "../actions-session";

export const metadata = { title: "Connexion" };

export default async function PageConnexion() {
  if (await utilisateurCourant()) redirect("/");
  const entreprise = await db.entreprise.findUnique({ where: { id: 1 }, select: { raisonSociale: true, logoMime: true } });
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ecorse-bleu-900 via-ecorse-bleu-800 to-ecorse-vert-700 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-6 text-center">
          {entreprise?.logoMime ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/logo" alt="Logo" className="mx-auto mb-3 h-16 object-contain" />
          ) : (
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-ecorse-vert-600 text-lg font-bold text-white">EA</div>
          )}
          <p className="text-lg font-bold text-ecorse-bleu-900">{entreprise?.raisonSociale ?? "ECORSE AFRIC"}</p>
          <p className="text-sm text-slate-500">BTP Manager 360</p>
        </div>
        <FormulaireAction action={actionConnexion} libelle="Se connecter" classeBouton="btn-primaire w-full">
          <Champ nom="email" libelle="Adresse e-mail" type="email" requis autoComplete="username" />
          <Champ nom="motDePasse" libelle="Mot de passe" type="password" requis autoComplete="current-password" />
        </FormulaireAction>
        <p className="mt-4 text-center text-xs text-slate-500">Les comptes sont créés par l'administrateur. Mot de passe oublié : contactez-le.</p>
      </div>
    </main>
  );
}
