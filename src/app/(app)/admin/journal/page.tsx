import { EnTetePage, Pagination } from "@/components/ui";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateHeure } from "@/lib/format";

export const metadata = { title: "Journal d'audit" };
const PAR_PAGE = 50;

export default async function PageJournal({ searchParams }: { searchParams: Promise<{ page?: string; entite?: string }> }) {
  await exigerPermission("journal", "lire");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.entite ? { entite: sp.entite } : {};
  const [lignes, total, entites] = await Promise.all([
    db.journalAudit.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * PAR_PAGE, take: PAR_PAGE, include: { user: { select: { prenom: true, nom: true, email: true } } } }),
    db.journalAudit.count({ where }),
    db.journalAudit.findMany({ distinct: ["entite"], select: { entite: true } }),
  ]);
  return (
    <>
      <EnTetePage titre="Journal d'audit" sousTitre="Opérations sensibles : connexions, créations, modifications, approbations. Le journal n'est pas modifiable depuis l'application." />
      <form method="get" className="carte mb-4 flex gap-2">
        <select name="entite" defaultValue={sp.entite ?? ""} className="champ max-w-xs" aria-label="Type d'élément">
          <option value="">Tous les éléments</option>
          {entites.map((e) => <option key={e.entite} value={e.entite}>{e.entite}</option>)}
        </select>
        <button className="btn-bleu" type="submit">Filtrer</button>
      </form>
      <div className="carte overflow-x-auto p-0">
        <table className="tableau">
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Élément</th><th>Détails</th><th>IP</th></tr></thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id.toString()}>
                <td className="whitespace-nowrap">{formatDateHeure(l.createdAt)}</td>
                <td>{l.user ? `${l.user.prenom} ${l.user.nom}` : "—"}</td>
                <td>{l.action}</td>
                <td className="whitespace-nowrap">{l.entite}{l.entiteId && <span className="block font-mono text-[10px] text-slate-400">{l.entiteId}</span>}</td>
                <td className="max-w-md break-all font-mono text-[11px] text-slate-600">{l.details ? JSON.stringify(l.details) : ""}</td>
                <td className="text-xs">{l.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} parPage={PAR_PAGE} params={sp.entite ? { entite: sp.entite } : {}} />
    </>
  );
}
