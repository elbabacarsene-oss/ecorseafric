import type { Prisma, Region, StatutChantier, TypeProjet } from "@prisma/client";
import Link from "next/link";
import { BadgeStatut, EnTetePage, EtatVide, Pagination } from "@/components/ui";
import { filtreChantiers } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { dateFinActualisee, estEnRetard, joursDeRetard, montantMarcheActualise } from "@/lib/calculs";
import { db } from "@/lib/db";
import { aujourdhuiDakar, formatDate, formatXOF } from "@/lib/format";
import { REGIONS, STATUTS_CHANTIER, TYPES_PROJET } from "@/lib/libelles";
import { peut } from "@/lib/permissions";

export const metadata = { title: "Chantiers" };
const PAR_PAGE = 25;

export default async function PageChantiers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("chantiers", "lire");
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const statut = sp.statut && sp.statut in STATUTS_CHANTIER ? (sp.statut as StatutChantier) : undefined;
  const type = sp.type && sp.type in TYPES_PROJET ? (sp.type as TypeProjet) : undefined;
  const region = sp.region && sp.region in REGIONS ? (sp.region as Region) : undefined;
  const retard = sp.retard === "1";
  const page = Math.max(1, Number(sp.page) || 1);
  const voirMarche = peut(user.role, "chantiers_marche", "lire");

  const where: Prisma.ChantierWhereInput = {
    AND: [
      filtreChantiers(user)!,
      {
        ...(statut && { statut }),
        ...(type && { typeProjet: type }),
        ...(region && { region }),
        ...(q && {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { nom: { contains: q, mode: "insensitive" } },
            { ville: { contains: q, mode: "insensitive" } },
            { client: { nom: { contains: q, mode: "insensitive" } } },
          ],
        }),
      },
    ],
  };
  const tous = await db.chantier.findMany({
    where,
    orderBy: [{ code: "desc" }],
    include: {
      client: { select: { nom: true, prenom: true } },
      avenants: { select: { statut: true, montant: true, delaiSupplementaireJours: true } },
    },
  });
  const auj = aujourdhuiDakar();
  const filtres = retard ? tous.filter((c) => estEnRetard(c, auj)) : tous;
  const liste = filtres.slice((page - 1) * PAR_PAGE, page * PAR_PAGE);
  const params = Object.fromEntries(Object.entries({ q, statut: statut ?? "", type: type ?? "", region: region ?? "", retard: retard ? "1" : "" }).filter(([, v]) => v));

  return (
    <>
      <EnTetePage
        titre={user.externe ? "Mes chantiers" : "Chantiers"}
        actions={peut(user.role, "chantiers", "creer") && <Link href="/chantiers/nouveau" className="btn-primaire">Nouveau chantier</Link>}
      />
      <form className="carte mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6" method="get">
        <input name="q" defaultValue={q} placeholder="Code, nom, ville, client…" className="champ lg:col-span-2" aria-label="Recherche" />
        <select name="statut" defaultValue={statut ?? ""} className="champ" aria-label="Statut">
          <option value="">Tous statuts</option>
          {Object.entries(STATUTS_CHANTIER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="type" defaultValue={type ?? ""} className="champ" aria-label="Type de projet">
          <option value="">Tous types</option>
          {Object.entries(TYPES_PROJET).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select name="region" defaultValue={region ?? ""} className="champ" aria-label="Région">
          <option value="">Toutes régions</option>
          {Object.entries(REGIONS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm whitespace-nowrap">
            <input type="checkbox" name="retard" value="1" defaultChecked={retard} /> En retard
          </label>
          <button className="btn-bleu" type="submit">Filtrer</button>
        </div>
      </form>

      {liste.length === 0 ? (
        <EtatVide
          message={Object.keys(params).length ? "Aucun chantier ne correspond à ces filtres." : user.externe ? "Aucun chantier ne vous a encore été ouvert." : "Aucun chantier enregistré pour le moment."}
          action={peut(user.role, "chantiers", "creer") && !Object.keys(params).length ? { href: "/chantiers/nouveau", libelle: "Créer le premier chantier" } : undefined}
        />
      ) : (
        <div className="carte overflow-x-auto p-0">
          <table className="tableau">
            <thead>
              <tr>
                <th className="hidden sm:table-cell">Code</th><th>Chantier</th><th className="hidden md:table-cell">Client</th><th className="hidden lg:table-cell">Type</th><th>Statut</th><th className="hidden md:table-cell">Ville</th><th>Fin prévue</th>
                {voirMarche && <th className="text-right">Marché actualisé</th>}
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => {
                const enRetard = estEnRetard(c, auj);
                return (
                  <tr key={c.id}>
                    <td className="hidden whitespace-nowrap font-mono text-xs sm:table-cell">{c.code}</td>
                    <td><Link href={`/chantiers/${c.id}`} className="lien font-medium">{c.nom}</Link><span className="block font-mono text-[11px] text-slate-500 sm:hidden">{c.code}</span></td>
                    <td className="hidden md:table-cell">{c.client.nom}{c.client.prenom ? ` ${c.client.prenom}` : ""}</td>
                    <td className="hidden lg:table-cell">{TYPES_PROJET[c.typeProjet]}</td>
                    <td><BadgeStatut statut={c.statut} /></td>
                    <td className="hidden md:table-cell">{c.ville ?? "—"}</td>
                    <td className="whitespace-nowrap">
                      {formatDate(dateFinActualisee(c))}
                      {enRetard && <span className="badge ml-1 bg-rose-100 text-rose-700">Retard {joursDeRetard(c, auj)} j</span>}
                    </td>
                    {voirMarche && <td className="whitespace-nowrap text-right">{formatXOF(montantMarcheActualise(c))}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} total={filtres.length} parPage={PAR_PAGE} params={params} />
    </>
  );
}
