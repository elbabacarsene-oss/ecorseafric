import Link from "next/link";
import { EnTetePage } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/format";
import { ROLES } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Utilisateurs" };

export default async function PageUtilisateurs() {
  const { user } = await exigerPermission("utilisateurs", "lire");
  const liste = await db.utilisateur.findMany({ orderBy: [{ actif: "desc" }, { nom: "asc" }], include: { intervenant: { select: { id: true, code: true } } } });
  return (
    <>
      <EnTetePage
        titre="Utilisateurs et rôles"
        sousTitre="Aucune inscription libre : les comptes sont créés ici, avec un mot de passe provisoire."
        actions={peut(user.role, "utilisateurs", "creer") && <Link href="/admin/utilisateurs/nouveau" className="btn-primaire">Nouvel utilisateur</Link>}
      />
      <div className="carte overflow-x-auto p-0">
        <table className="tableau">
          <thead><tr><th>Nom</th><th>E-mail</th><th>Rôle</th><th>Fiche</th><th>État</th><th>Dernière connexion</th></tr></thead>
          <tbody>
            {liste.map((u) => (
              <tr key={u.id} className={u.actif ? "" : "opacity-60"}>
                <td>{peut(user.role, "utilisateurs", "modifier") ? <Link className="lien" href={`/admin/utilisateurs/${u.id}`}>{u.prenom} {u.nom}</Link> : `${u.prenom} ${u.nom}`}</td>
                <td>{u.email}</td>
                <td>{ROLES[u.role]}</td>
                <td>{u.intervenant ? <Link className="lien font-mono text-xs" href={`/intervenants/${u.intervenant.id}`}>{u.intervenant.code}</Link> : "—"}</td>
                <td>{u.actif ? (u.verrouilleJusqua && u.verrouilleJusqua > new Date() ? "Verrouillé" : "Actif") : "Désactivé"}</td>
                <td className="whitespace-nowrap">{formatDateHeure(u.derniereConnexion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
