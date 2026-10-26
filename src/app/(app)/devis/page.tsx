import type { Prisma, StatutDevis } from "@prisma/client";
import Link from "next/link";
import { EnTetePage, EtatVide, Pagination } from "@/components/ui";
import { filtreDevis } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { totauxDevis } from "@/lib/devis-calculs";
import { formatDate, formatXOF } from "@/lib/format";
import { COULEUR_DEVIS, STATUTS_DEVIS } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Devis" };
const PAR_PAGE = 25;

export default async function PageDevis({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("devis", "lire");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const statut = sp.statut && sp.statut in STATUTS_DEVIS ? (sp.statut as StatutDevis) : undefined;
  const anciennes = sp.anciennes === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.DevisWhereInput = {
    AND: [
      filtreDevis(user)!,
      statut ? { statut } : anciennes ? {} : { statut: { not: "REMPLACE" } },
      q ? { OR: [{ numero: { contains: q, mode: "insensitive" } }, { objet: { contains: q, mode: "insensitive" } }, { client: { nom: { contains: q, mode: "insensitive" } } }] } : {},
    ],
  };
  const [total, liste] = await Promise.all([
    db.devis.count({ where }),
    db.devis.findMany({
      where,
      orderBy: [{ numero: "desc" }, { variante: "asc" }, { version: "desc" }],
      skip: (page - 1) * PAR_PAGE,
      take: PAR_PAGE,
      include: {
        client: { select: { nom: true, prenom: true } },
        chantier: { select: { id: true, code: true } },
        lignes: { select: { lot: true, quantite: true, debourseSecUnitaire: true, prixUnitaireImpose: true, verifiee: true } },
      },
    }),
  ]);
  const params = Object.fromEntries(Object.entries({ q, statut: statut ?? "", anciennes: anciennes ? "1" : "" }).filter(([, v]) => v));

  return (
    <>
      <EnTetePage
        titre="Devis"
        sousTitre="Études de prix : devis quantitatifs et estimatifs, variantes, versions, validation interne."
        actions={
          <>
            {peut(user.role, "bibliotheque", "lire") && <Link href="/bibliotheque" className="btn-secondaire">Bibliothèque d'ouvrages</Link>}
            {peut(user.role, "devis", "creer") && <Link href="/devis/nouveau" className="btn-primaire">Nouveau devis</Link>}
          </>
        }
      />
      <form className="carte mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <input name="q" defaultValue={q} placeholder="Numéro, objet, client…" className="champ lg:col-span-2" aria-label="Recherche" />
        <select name="statut" defaultValue={statut ?? ""} className="champ" aria-label="Statut">
          <option value="">Statuts en cours</option>
          {Object.entries(STATUTS_DEVIS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="anciennes" value="1" defaultChecked={anciennes} /> Versions remplacées</label>
        <button className="btn-secondaire">Filtrer</button>
      </form>
      {liste.length === 0 ? (
        <EtatVide message="Aucun devis." action={peut(user.role, "devis", "creer") ? { href: "/devis/nouveau", libelle: "Créer un devis" } : undefined} />
      ) : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead><tr><th>Numéro</th><th>Objet</th><th>Client</th><th>Date</th><th>Statut</th><th className="text-right">Total HT</th><th>Chantier</th></tr></thead>
            <tbody>
              {liste.map((d) => {
                const t = totauxDevis(d.lignes, d);
                return (
                  <tr key={d.id}>
                    <td className="whitespace-nowrap"><Link className="lien" href={`/devis/${d.id}`}>{d.numero}</Link> <span className="text-xs text-slate-500">{d.variante} · v{d.version}</span></td>
                    <td className="max-w-xs">{d.objet}</td>
                    <td>{d.client.nom}{d.client.prenom ? " " + d.client.prenom : ""}</td>
                    <td className="whitespace-nowrap">{formatDate(d.dateDevis)}</td>
                    <td><span className={`badge ${COULEUR_DEVIS[d.statut]}`}>{STATUTS_DEVIS[d.statut]}</span></td>
                    <td className="whitespace-nowrap text-right">{d.lignes.length ? formatXOF(t.totalHT) : <span className="text-slate-400">aucune ligne</span>}</td>
                    <td>{d.chantier ? <Link className="lien" href={`/chantiers/${d.chantier.id}`}>{d.chantier.code}</Link> : "—"}</td>
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
