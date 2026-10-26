import type { CategorieIntervenant, Prisma, TypeIntervenant } from "@prisma/client";
import Link from "next/link";
import { EnTetePage, EtatVide, Pagination } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { CATEGORIES, TYPES_INTERVENANT, TYPES_PAR_CATEGORIE } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Parties prenantes" };
const PAR_PAGE = 25;

export default async function PageIntervenants({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("intervenants", "lire");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const categorie = sp.categorie && sp.categorie in CATEGORIES ? (sp.categorie as CategorieIntervenant) : undefined;
  const type = sp.type && sp.type in TYPES_INTERVENANT ? (sp.type as TypeIntervenant) : undefined;
  const statut = sp.statut === "inactifs" ? false : sp.statut === "tous" ? undefined : true;
  const page = Math.max(1, Number(sp.page) || 1);

  const where: Prisma.IntervenantWhereInput = {
    ...(categorie && { categorie }),
    ...(type && { type }),
    ...(statut !== undefined && { actif: statut }),
    ...(q && {
      OR: ["nom", "prenom", "entreprise", "email", "telephone", "code", "fonction"].map((c) => ({ [c]: { contains: q, mode: "insensitive" } })),
    }),
  };
  const [liste, total] = await Promise.all([
    db.intervenant.findMany({
      where,
      orderBy: [{ nom: "asc" }],
      skip: (page - 1) * PAR_PAGE,
      take: PAR_PAGE,
      include: { _count: { select: { affectations: true } }, utilisateur: { select: { id: true } } },
    }),
    db.intervenant.count({ where }),
  ]);
  const titre = categorie === "MAITRISE_OUVRAGE" ? "Clients et maîtres d'ouvrage" : "Parties prenantes";
  const params = Object.fromEntries(Object.entries({ q, categorie: categorie ?? "", type: type ?? "", statut: sp.statut ?? "" }).filter(([, v]) => v));

  return (
    <>
      <EnTetePage
        titre={titre}
        sousTitre="Maîtrise d'ouvrage, maîtrise d'œuvre, personnel interne et intervenants externes."
        actions={peut(user.role, "intervenants", "creer") && (
          <Link href={`/intervenants/nouveau${categorie ? `?categorie=${categorie}` : ""}`} className="btn-primaire">Nouvel intervenant</Link>
        )}
      />
      <form className="carte mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="q" defaultValue={q} placeholder="Rechercher (nom, code, e-mail, téléphone…)" className="champ lg:col-span-2" aria-label="Recherche" />
        <select name="categorie" defaultValue={categorie ?? ""} className="champ" aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {Object.entries(CATEGORIES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="type" defaultValue={type ?? ""} className="champ" aria-label="Type">
          <option value="">Tous types</option>
          {(Object.keys(TYPES_PAR_CATEGORIE) as CategorieIntervenant[]).filter((c) => !categorie || c === categorie).map((c) => (
            <optgroup key={c} label={CATEGORIES[c]}>
              {TYPES_PAR_CATEGORIE[c].map((t) => <option key={t} value={t}>{TYPES_INTERVENANT[t]}</option>)}
            </optgroup>
          ))}
        </select>
        <div className="flex gap-2">
          <select name="statut" defaultValue={sp.statut ?? ""} className="champ" aria-label="Statut">
            <option value="">Actifs</option>
            <option value="inactifs">Inactifs</option>
            <option value="tous">Tous</option>
          </select>
          <button className="btn-bleu" type="submit">Filtrer</button>
        </div>
      </form>

      {liste.length === 0 ? (
        <EtatVide
          message={q || categorie || type ? "Aucun intervenant ne correspond à ces filtres." : "Aucun intervenant enregistré pour le moment."}
          action={peut(user.role, "intervenants", "creer") ? { href: "/intervenants/nouveau", libelle: "Créer le premier intervenant" } : undefined}
        />
      ) : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead>
              <tr><th className="hidden sm:table-cell">Code</th><th>Nom</th><th className="hidden md:table-cell">Type</th><th className="hidden lg:table-cell">Fonction / entreprise</th><th>Contact</th><th className="hidden md:table-cell">Chantiers</th><th className="hidden md:table-cell">Accès</th></tr>
            </thead>
            <tbody>
              {liste.map((i) => (
                <tr key={i.id} className={i.actif ? "" : "opacity-60"}>
                  <td className="hidden whitespace-nowrap font-mono text-xs sm:table-cell">{i.code}</td>
                  <td><Link href={`/intervenants/${i.id}`} className="lien font-medium">{i.nom}{i.prenom ? ` ${i.prenom}` : ""}</Link><span className="block text-xs text-slate-500 md:hidden">{TYPES_INTERVENANT[i.type]}</span></td>
                  <td className="hidden md:table-cell">{TYPES_INTERVENANT[i.type]}</td>
                  <td className="hidden lg:table-cell">{[i.fonction, i.entreprise].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="whitespace-nowrap">{i.telephone ?? ""}{i.email && <span className="block text-xs text-slate-500">{i.email}</span>}</td>
                  <td className="hidden md:table-cell">{i._count.affectations}</td>
                  <td className="hidden md:table-cell">{i.utilisateur ? <span className="badge bg-ecorse-bleu-50 text-ecorse-bleu-700">Compte</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={total} parPage={PAR_PAGE} params={params} />
    </>
  );
}
