import type { CategorieDocument, Prisma } from "@prisma/client";
import Link from "next/link";
import { versionCourante } from "@/components/Documents";
import { EnTetePage, EtatVide, Pagination } from "@/components/ui";
import { filtreChantiers, filtreDocuments } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ajouterJours, aujourdhuiDakar, formatDate } from "@/lib/format";
import { CATEGORIES_DOCUMENT, COULEUR_VERSION, STATUTS_VERSION } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Documents" };
const PAR_PAGE = 30;

export default async function PageDocuments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("documents", "lire");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const categorie = sp.categorie && sp.categorie in CATEGORIES_DOCUMENT ? (sp.categorie as CategorieDocument) : undefined;
  const chantierId = sp.chantier || undefined;
  const filtre = sp.filtre ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const auj = aujourdhuiDakar();

  const where: Prisma.DocumentWhereInput = {
    AND: [
      filtreDocuments(user)!,
      { archive: sp.archives === "1" },
      categorie ? { categorie } : { categorie: { not: "PHOTO" } },
      chantierId ? { chantierId } : {},
      q ? { OR: [{ titre: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }, { lot: { contains: q, mode: "insensitive" } }] } : {},
      filtre === "attente" ? { versions: { some: { statut: "EN_ATTENTE" } } } : {},
      filtre === "expires" ? { dateValidite: { lt: auj } } : {},
      filtre === "bientot" ? { dateValidite: { gte: auj, lte: ajouterJours(auj, 30) } } : {},
    ],
  };
  const [total, docs, chantiers] = await Promise.all([
    db.document.count({ where }),
    db.document.findMany({
      where,
      include: {
        chantier: { select: { id: true, code: true } },
        devis: { select: { id: true, numero: true } },
        versions: { orderBy: { numero: "desc" }, select: { id: true, numero: true, indice: true, statut: true, deposeLe: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAR_PAGE,
      take: PAR_PAGE,
    }),
    db.chantier.findMany({ where: filtreChantiers(user, "lire", "documents") ?? { id: "__aucun__" }, select: { id: true, code: true, nom: true }, orderBy: { code: "desc" } }),
  ]);
  const params = Object.fromEntries(Object.entries({ q, categorie: categorie ?? "", chantier: chantierId ?? "", filtre, archives: sp.archives ?? "" }).filter(([, v]) => v));

  return (
    <>
      <EnTetePage
        titre="Documents"
        sousTitre={user.externe ? "Documents partagés avec vous, dans leur version en vigueur." : "Bibliothèque documentaire : versions, approbations, dates de validité. Les photos sont rangées sur chaque chantier."}
        actions={peut(user.role, "documents", "creer") && <Link href="/documents/nouveau" className="btn-primaire">Déposer un document</Link>}
      />
      <form className="carte mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
        <input name="q" defaultValue={q} placeholder="Titre, référence, lot…" className="champ lg:col-span-2" aria-label="Recherche" />
        <select name="categorie" defaultValue={categorie ?? ""} className="champ" aria-label="Catégorie">
          <option value="">Toutes catégories (hors photos)</option>
          {Object.entries(CATEGORIES_DOCUMENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="chantier" defaultValue={chantierId ?? ""} className="champ" aria-label="Chantier">
          <option value="">Tous chantiers</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
        </select>
        {!user.externe && (
          <select name="filtre" defaultValue={filtre} className="champ" aria-label="Filtre">
            <option value="">Tous</option>
            <option value="attente">Versions à approuver</option>
            <option value="expires">Validité expirée</option>
            <option value="bientot">Expirent sous 30 jours</option>
          </select>
        )}
        <button className="btn-secondaire">Filtrer</button>
      </form>
      {docs.length === 0 ? (
        <EtatVide message="Aucun document." />
      ) : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead><tr><th>Document</th><th>Catégorie</th><th>Rattachement</th><th>Version en vigueur</th>{!user.externe && <th>Dernier dépôt</th>}<th>Validité</th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const cour = versionCourante(d.versions);
                const derniere = d.versions[0];
                const expire = d.dateValidite && d.dateValidite < auj;
                if (user.externe && !cour) return null;
                return (
                  <tr key={d.id}>
                    <td>{user.externe ? d.titre : <Link className="lien" href={`/documents/${d.id}`}>{d.titre}</Link>}{d.reference && <span className="ml-1 text-xs text-slate-500">{d.reference}</span>}</td>
                    <td>{CATEGORIES_DOCUMENT[d.categorie]}</td>
                    <td className="whitespace-nowrap">
                      {d.chantier ? (user.externe ? d.chantier.code : <Link className="lien" href={`/chantiers/${d.chantier.id}`}>{d.chantier.code}</Link>) : d.devis ? <Link className="lien" href={`/devis/${d.devis.id}`}>{d.devis.numero}</Link> : "Entreprise"}
                    </td>
                    <td>{cour ? <a className="lien" href={`/api/fichiers/${cour.id}`} target="_blank" rel="noopener">{cour.indice ? `Indice ${cour.indice}` : `Version ${cour.numero}`}</a> : <span className="text-amber-700">Aucune</span>}</td>
                    {!user.externe && <td><span className={`badge ${COULEUR_VERSION[derniere.statut]}`}>{STATUTS_VERSION[derniere.statut]}</span></td>}
                    <td className={expire ? "font-medium text-rose-700" : ""}>{d.dateValidite ? `${formatDate(d.dateValidite)}${expire ? " (expiré)" : ""}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} parPage={PAR_PAGE} params={params} />
    </>
  );
}
