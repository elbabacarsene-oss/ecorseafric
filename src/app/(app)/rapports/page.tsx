import type { Prisma, StatutRapport } from "@prisma/client";
import Link from "next/link";
import { EnTetePage, EtatVide, Pagination } from "@/components/ui";
import { filtreChantiers } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { COULEUR_RAPPORT, METEOS, STATUTS_RAPPORT } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Rapports journaliers" };
const PAR_PAGE = 30;

export default async function PageRapports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("rapports", "lire");
  const sp = await searchParams;
  const statut = sp.statut && sp.statut in STATUTS_RAPPORT ? (sp.statut as StatutRapport) : undefined;
  const chantierId = sp.chantier || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.RapportJournalierWhereInput = {
    AND: [{ chantier: filtreChantiers(user, "lire", "rapports")! }, statut ? { statut } : {}, chantierId ? { chantierId } : {}],
  };
  const [total, rapports, chantiers] = await Promise.all([
    db.rapportJournalier.count({ where }),
    db.rapportJournalier.findMany({
      where, orderBy: [{ date: "desc" }], skip: (page - 1) * PAR_PAGE, take: PAR_PAGE,
      include: { chantier: { select: { code: true, nom: true } }, redacteur: { select: { prenom: true, nom: true } }, _count: { select: { documents: true } } },
    }),
    db.chantier.findMany({ where: filtreChantiers(user, "lire", "rapports")!, select: { id: true, code: true, nom: true }, orderBy: { code: "desc" } }),
  ]);
  const params = Object.fromEntries(Object.entries({ statut: statut ?? "", chantier: chantierId ?? "" }).filter(([, v]) => v));
  return (
    <>
      <EnTetePage
        titre="Rapports journaliers"
        actions={peut(user.role, "rapports", "creer") && <Link href={`/rapports/nouveau${chantierId ? `?chantier=${chantierId}` : ""}`} className="btn-primaire">Nouveau rapport</Link>}
      />
      <form className="carte mb-4 grid gap-3 sm:grid-cols-4" method="get">
        <select name="chantier" defaultValue={chantierId ?? ""} className="champ sm:col-span-2" aria-label="Chantier">
          <option value="">Tous chantiers</option>
          {chantiers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.nom}</option>)}
        </select>
        <select name="statut" defaultValue={statut ?? ""} className="champ" aria-label="Statut">
          <option value="">Tous statuts</option>
          {Object.entries(STATUTS_RAPPORT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn-secondaire">Filtrer</button>
      </form>
      {rapports.length === 0 ? <EtatVide message="Aucun rapport journalier." /> : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead><tr><th>Date</th><th>Chantier</th><th>Responsable</th><th>Météo</th><th className="text-right">Effectif</th><th>Incident</th><th>Photos</th><th>Statut</th></tr></thead>
            <tbody>
              {rapports.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap"><Link className="lien" href={`/rapports/${r.id}`}>{formatDate(r.date)}</Link></td>
                  <td>{r.chantier.code} <span className="text-xs text-slate-500">{r.chantier.nom}</span></td>
                  <td>{r.redacteur.prenom} {r.redacteur.nom}</td>
                  <td>{r.meteo ? METEOS[r.meteo] : "—"}</td>
                  <td className="text-right">{r.effectifTotal}</td>
                  <td>{r.incidents ? <span className="badge bg-rose-100 text-rose-700">oui</span> : "—"}</td>
                  <td>{r._count.documents || "—"}</td>
                  <td><span className={`badge ${COULEUR_RAPPORT[r.statut]}`}>{STATUTS_RAPPORT[r.statut]}</span></td>
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
