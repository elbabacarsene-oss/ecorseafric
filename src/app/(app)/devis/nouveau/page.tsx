import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, EtatVide } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { peut } from "@/lib/permissions";
import { creerDevis } from "../actions";
import { ChampsDevis } from "../ChampsDevis";
import { optionsDevis } from "../options";

export const metadata = { title: "Nouveau devis" };

export default async function PageNouveauDevis() {
  const { user } = await exigerPermission("devis", "creer");
  const { clients, chantiers } = await optionsDevis(user);
  return (
    <>
      <EnTetePage titre="Nouveau devis" sousTitre="Numérotation automatique DV-AAAA-NNN. Les lignes se saisissent ou s'importent après la création." />
      {clients.length === 0 ? (
        <EtatVide message="Aucun client enregistré : créez d'abord la fiche du client (maîtrise d'ouvrage)." action={{ href: "/intervenants/nouveau", libelle: "Créer un client" }} />
      ) : (
        <div className="carte">
          <FormulaireAction action={creerDevis} libelle="Créer le devis">
            <ChampsDevis clients={clients} chantiers={chantiers} voirCouts={peut(user.role, "devis_couts", "lire")} />
          </FormulaireAction>
        </div>
      )}
    </>
  );
}
