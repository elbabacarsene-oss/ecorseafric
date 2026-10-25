import { redirect } from "next/navigation";
import { Navigation, type LienNav } from "@/components/Navigation";
import { exigerUtilisateur } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { actionDeconnexion } from "../actions-session";

export default async function LayoutApplication({ children }: { children: React.ReactNode }) {
  const user = await exigerUtilisateur();
  if (user.doitChangerMdp) redirect("/changer-mot-de-passe");
  const entreprise = await db.entreprise.findUnique({ where: { id: 1 }, select: { raisonSociale: true, logoMime: true } });

  const liens: LienNav[] = [];
  if (peut(user.role, "tableau_de_bord", "lire")) liens.push({ href: "/", libelle: "Tableau de bord" });
  if (peut(user.role, "chantiers", "lire")) liens.push({ href: "/chantiers", libelle: user.externe ? "Mes chantiers" : "Chantiers", groupe: "Opérations" });
  if (peut(user.role, "intervenants", "lire")) {
    liens.push({ href: "/intervenants", libelle: "Parties prenantes", groupe: "Opérations" });
    liens.push({ href: "/clients", libelle: "Clients", groupe: "Opérations" });
  }
  if (peut(user.role, "utilisateurs", "lire")) liens.push({ href: "/admin/utilisateurs", libelle: "Utilisateurs", groupe: "Administration" });
  if (peut(user.role, "entreprise", "lire") && !user.externe) liens.push({ href: "/admin/entreprise", libelle: "Entreprise", groupe: "Administration" });
  if (!user.externe) liens.push({ href: "/admin/permissions", libelle: "Matrice des permissions", groupe: "Administration" });
  if (peut(user.role, "journal", "lire")) liens.push({ href: "/admin/journal", libelle: "Journal d'audit", groupe: "Administration" });
  liens.push({ href: "/mon-compte", libelle: "Mon compte", groupe: "Compte" });

  return (
    <div className="min-h-screen">
      <Navigation
        liens={liens}
        utilisateur={`${user.prenom} ${user.nom}`}
        role={ROLES[user.role]}
        aLogo={!!entreprise?.logoMime}
        raisonSociale={entreprise?.raisonSociale ?? "ECORSE AFRIC"}
        deconnexion={actionDeconnexion}
      />
      <main className="px-4 py-5 lg:ml-64 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
