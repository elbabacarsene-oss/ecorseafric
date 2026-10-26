import type { CategorieOuvrage, Prisma } from "@prisma/client";
import Link from "next/link";
import { EnTetePage, EtatVide } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { debourseSecSousDetail } from "@/lib/devis-calculs";
import { formatXOF } from "@/lib/format";
import { CATEGORIES_OUVRAGE, UNITES } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Bibliothèque d'ouvrages" };

export default async function PageBibliotheque({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("bibliotheque", "lire");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const categorie = sp.categorie && sp.categorie in CATEGORIES_OUVRAGE ? (sp.categorie as CategorieOuvrage) : undefined;
  const where: Prisma.OuvrageWhereInput = {
    ...(categorie && { categorie }),
    ...(sp.inactifs !== "1" && { actif: true }),
    ...(q && { OR: [{ code: { contains: q, mode: "insensitive" } }, { designation: { contains: q, mode: "insensitive" } }] }),
  };
  const ouvrages = await db.ouvrage.findMany({ where, include: { composants: true }, orderBy: [{ categorie: "asc" }, { code: "asc" }] });
  const voirPrix = peut(user.role, "devis_couts", "lire") || peut(user.role, "bibliotheque", "modifier") || user.role === "ACHETEUR";

  return (
    <>
      <EnTetePage
        titre="Bibliothèque d'ouvrages"
        sousTitre="Ouvrages types avec sous-détail de prix (quantités et prix pour une unité). Ils servent de base aux lignes de devis."
        actions={peut(user.role, "bibliotheque", "creer") && <Link href="/bibliotheque/nouveau" className="btn-primaire">Nouvel ouvrage</Link>}
      />
      <form className="carte mb-4 grid gap-3 sm:grid-cols-4" method="get">
        <input name="q" defaultValue={q} placeholder="Code ou désignation…" className="champ sm:col-span-2" aria-label="Recherche" />
        <select name="categorie" defaultValue={categorie ?? ""} className="champ" aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {Object.entries(CATEGORIES_OUVRAGE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-secondaire">Filtrer</button>
      </form>
      {ouvrages.length === 0 ? (
        <EtatVide
          message="Aucun ouvrage dans la bibliothèque. Les ouvrages et leurs prix sont saisis par l'entreprise : aucun prix n'est pré-rempli."
          action={peut(user.role, "bibliotheque", "creer") ? { href: "/bibliotheque/nouveau", libelle: "Créer le premier ouvrage" } : undefined}
        />
      ) : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Unité</th><th>Composants</th>{voirPrix && <th className="text-right">Déboursé sec unitaire</th>}</tr></thead>
            <tbody>
              {ouvrages.map((o) => (
                <tr key={o.id} className={o.actif ? "" : "opacity-50"}>
                  <td className="whitespace-nowrap"><Link className="lien" href={`/bibliotheque/${o.id}`}>{o.code}</Link></td>
                  <td>{o.designation}</td>
                  <td>{CATEGORIES_OUVRAGE[o.categorie]}</td>
                  <td>{UNITES[o.unite]}</td>
                  <td>{o.composants.length || <span className="text-amber-700">aucun</span>}</td>
                  {voirPrix && <td className="whitespace-nowrap text-right">{o.composants.length ? formatXOF(debourseSecSousDetail(o.composants)) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
