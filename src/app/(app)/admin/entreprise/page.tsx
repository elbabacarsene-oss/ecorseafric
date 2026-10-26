import { Champ } from "@/components/Champs";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, Info } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { peut } from "@/lib/permissions";
import { modifierEntreprise } from "../actions";

export const metadata = { title: "Entreprise" };

export default async function PageEntreprise() {
  const { user } = await exigerPermission("entreprise", "lire");
  const e = await db.entreprise.findUnique({ where: { id: 1 } });
  const modifiable = peut(user.role, "entreprise", "modifier");
  return (
    <>
      <EnTetePage titre="Paramètres de l'entreprise" sousTitre="Devise : franc CFA (XOF) · Fuseau horaire : Africa/Dakar · Langue : français" />
      <div className="carte">
        {modifiable ? (
          <FormulaireAction action={modifierEntreprise}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Champ nom="raisonSociale" libelle="Raison sociale" requis defaut={e?.raisonSociale ?? "ECORSE AFRIC"} />
              <Champ nom="formeJuridique" libelle="Forme juridique" defaut={e?.formeJuridique} placeholder="SARL, SA, SUARL…" />
              <Champ nom="ninea" libelle="NINEA" defaut={e?.ninea} />
              <Champ nom="rccm" libelle="RCCM" defaut={e?.rccm} />
              <Champ nom="adresse" libelle="Adresse" defaut={e?.adresse} />
              <Champ nom="ville" libelle="Ville" defaut={e?.ville ?? "Dakar"} />
              <Champ nom="telephone" libelle="Téléphone" defaut={e?.telephone} />
              <Champ nom="email" libelle="E-mail" type="email" defaut={e?.email} />
              <Champ nom="siteWeb" libelle="Site web" defaut={e?.siteWeb} />
              <div>
                <label htmlFor="logo" className="etiquette">Logo officiel (PNG, JPEG ou WebP, 1 Mo max.)</label>
                <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="champ" />
                {e?.logoMime && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/logo?v=${e.updatedAt.getTime()}`} alt="Logo actuel" className="mt-2 h-14 rounded border bg-white object-contain p-1" />
                )}
              </div>
            </div>
          </FormulaireAction>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Info libelle="Raison sociale">{e?.raisonSociale ?? "ECORSE AFRIC"}</Info>
            <Info libelle="NINEA">{e?.ninea}</Info>
            <Info libelle="RCCM">{e?.rccm}</Info>
            <Info libelle="Adresse">{[e?.adresse, e?.ville].filter(Boolean).join(", ") || null}</Info>
            <Info libelle="Téléphone">{e?.telephone}</Info>
            <Info libelle="E-mail">{e?.email}</Info>
          </dl>
        )}
      </div>
    </>
  );
}
