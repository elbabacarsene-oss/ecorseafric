import Link from "next/link";
import { notFound } from "next/navigation";
import { FormulaireAction } from "@/components/FormulaireAction";
import { BadgeStatut, EnTetePage, Info } from "@/components/ui";
import { filtreChantiers } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatDateHeure } from "@/lib/format";
import { CATEGORIES, REGIONS, ROLES, TYPES_INTERVENANT } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { basculerActifIntervenant } from "../actions";

export const metadata = { title: "Fiche intervenant" };

export default async function FicheIntervenant({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("intervenants", "lire");
  const { id } = await params;
  // Seuls les chantiers que l'utilisateur peut lui-même consulter sont listés.
  const filtre = filtreChantiers(user) ?? { id: "__aucun__" };
  const i = await db.intervenant.findUnique({
    where: { id },
    include: {
      utilisateur: { select: { id: true, email: true, role: true, actif: true, derniereConnexion: true } },
      affectations: { where: { chantier: filtre }, include: { chantier: { select: { id: true, code: true, nom: true, statut: true } } }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!i) notFound();
  const voirComptes = peut(user.role, "utilisateurs", "lire");

  return (
    <>
      <EnTetePage
        titre={`${i.nom}${i.prenom ? " " + i.prenom : ""}`}
        sousTitre={`${i.code} · ${CATEGORIES[i.categorie]} · ${TYPES_INTERVENANT[i.type]}${i.actif ? "" : " · INACTIF"}`}
        actions={
          <>
            {peut(user.role, "intervenants", "modifier") && <Link href={`/intervenants/${i.id}/modifier`} className="btn-secondaire">Modifier</Link>}
            {peut(user.role, "intervenants", "supprimer") && (
              <FormulaireAction
                action={basculerActifIntervenant.bind(null, i.id)}
                libelle={i.actif ? "Désactiver" : "Réactiver"}
                classeBouton={i.actif ? "btn-secondaire" : "btn-primaire"}
                confirmation={i.actif ? "Désactiver cet intervenant ? Il restera dans l'historique." : undefined}
                className="flex flex-col gap-2"
              />
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="carte lg:col-span-2">
          <h2 className="mb-3">Coordonnées</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Info libelle="Fonction">{i.fonction}</Info>
            <Info libelle="Entreprise / organisme">{i.entreprise}</Info>
            <Info libelle="Téléphone">{i.telephone && <a className="lien" href={`tel:${i.telephone}`}>{i.telephone}</a>}</Info>
            <Info libelle="Téléphone secondaire">{i.telephone2}</Info>
            <Info libelle="E-mail">{i.email && <a className="lien" href={`mailto:${i.email}`}>{i.email}</a>}</Info>
            <Info libelle="Adresse">{[i.adresse, i.ville, i.region && REGIONS[i.region]].filter(Boolean).join(", ") || null}</Info>
            <Info libelle="NINEA">{i.ninea}</Info>
            <Info libelle="RCCM">{i.rccm}</Info>
            <Info libelle="Forme">{i.personneMorale ? "Personne morale" : "Personne physique"}</Info>
            <Info libelle="Créé le">{formatDate(i.createdAt)}</Info>
          </dl>
          {i.notes && <p className="mt-4 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{i.notes}</p>}
        </section>

        <section className="carte">
          <h2 className="mb-3">Autorisations</h2>
          {i.utilisateur ? (
            <dl className="space-y-3">
              <Info libelle="Compte utilisateur">{voirComptes ? <Link className="lien" href={`/admin/utilisateurs/${i.utilisateur.id}`}>{i.utilisateur.email}</Link> : i.utilisateur.email}</Info>
              <Info libelle="Rôle">{ROLES[i.utilisateur.role]}</Info>
              <Info libelle="État">{i.utilisateur.actif ? "Actif" : "Désactivé"}</Info>
              <Info libelle="Dernière connexion">{formatDateHeure(i.utilisateur.derniereConnexion)}</Info>
              <Info libelle="Accès portail">
                {i.affectations.filter((a) => a.accesPortail).length} chantier(s) ouvert(s) au portail
              </Info>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              Aucun compte d'accès. {peut(user.role, "utilisateurs", "creer") && <Link className="lien" href={`/admin/utilisateurs/nouveau?intervenant=${i.id}`}>Créer un compte lié</Link>}
            </p>
          )}
        </section>

        <section className="carte lg:col-span-3">
          <h2 className="mb-3">Chantiers ({i.affectations.length})</h2>
          {i.affectations.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune affectation visible. Les affectations se gèrent depuis la fiche d'un chantier.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="tableau">
                <thead><tr><th>Chantier</th><th>Rôle sur le chantier</th><th>Période</th><th>Portail</th><th>Statut</th></tr></thead>
                <tbody>
                  {i.affectations.map((a) => (
                    <tr key={a.id}>
                      <td><Link className="lien" href={`/chantiers/${a.chantier.id}`}>{a.chantier.code} · {a.chantier.nom}</Link></td>
                      <td>{a.roleChantier}</td>
                      <td className="whitespace-nowrap">{formatDate(a.dateDebut)} → {formatDate(a.dateFin)}</td>
                      <td>{a.accesPortail ? "Oui" : "Non"}</td>
                      <td><BadgeStatut statut={a.chantier.statut} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="carte lg:col-span-3 text-sm text-slate-500">
          <h2 className="mb-1 text-slate-700">Documents et contrats</h2>
          La gestion documentaire (contrats, pièces administratives, versions) arrive à l'étape 2 ; les contrats de sous-traitance et de personnel à l'étape 3.
        </section>
      </div>
    </>
  );
}
