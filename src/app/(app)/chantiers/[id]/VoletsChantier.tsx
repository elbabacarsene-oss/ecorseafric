import Link from "next/link";
import { chantierAccessible } from "@/lib/acces";
import type { UtilisateurConnecte } from "@/lib/auth";
import { totauxBudget } from "@/lib/budget-calculs";
import { db } from "@/lib/db";
import { totauxDevis } from "@/lib/devis-calculs";
import { aujourdhuiDakar, formatDate, formatXOF } from "@/lib/format";
import { COULEUR_DEVIS, COULEUR_RAPPORT, STATUTS_BUDGET, STATUTS_DEVIS, STATUTS_RAPPORT } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { avancementGlobal, etatTache } from "@/lib/planning-calculs";

/** Budget, planning, rapports journaliers et devis du chantier (étape 2), selon les droits de l'utilisateur. */
export async function VoletsChantier({ user, chantierId }: { user: UtilisateurConnecte; chantierId: string }) {
  const acces = async (m: "budgets" | "planning" | "rapports" | "devis") => peut(user.role, m, "lire") && (await chantierAccessible(user, chantierId, "lire", m));
  const [voirBudget, voirPlanning, voirRapports, voirDevis] = await Promise.all([acces("budgets"), acces("planning"), acces("rapports"), acces("devis")]);
  if (!voirBudget && !voirPlanning && !voirRapports && !voirDevis) return null;
  const auj = aujourdhuiDakar();

  const [c, taches, rapports, devis] = await Promise.all([
    db.chantier.findUniqueOrThrow({ where: { id: chantierId }, select: { budgetStatut: true, lignesBudget: voirBudget ? { select: { lot: true, poste: true, montantInitial: true, montantActualise: true } } : false } }),
    voirPlanning ? db.tachePlanning.findMany({ where: { chantierId }, include: { _count: { select: { enfants: true } } } }) : [],
    voirRapports ? db.rapportJournalier.findMany({ where: { chantierId }, orderBy: { date: "desc" }, take: 5, select: { id: true, date: true, statut: true, effectifTotal: true, incidents: true } }) : [],
    voirDevis ? db.devis.findMany({ where: { chantierId, statut: { not: "REMPLACE" } }, include: { lignes: { select: { lot: true, quantite: true, debourseSecUnitaire: true, prixUnitaireImpose: true } } }, orderBy: { numero: "desc" } }) : [],
  ]);
  const feuilles = taches.filter((t) => !t._count.enfants);
  const retards = feuilles.filter((t) => etatTache(t, auj).enRetard);
  const importantesEnRetard = retards.filter((t) => t.importante);
  const tb = c.lignesBudget ? totauxBudget(c.lignesBudget) : null;
  const av = avancementGlobal(taches);

  return (
    <>
      {importantesEnRetard.length > 0 && (
        <section className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 lg:col-span-3">
          <strong>Alerte planning :</strong> {importantesEnRetard.length} tâche(s) importante(s) en retard —{" "}
          {importantesEnRetard.slice(0, 4).map((t) => `${t.nom} (${etatTache(t, auj).joursRetard} j)`).join(", ")}.
        </section>
      )}
      <section className="grid gap-4 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-4">
        {voirBudget && (
          <Link href={`/chantiers/${chantierId}/budget`} className="carte block hover:border-ecorse-vert-500">
            <p className="text-xs font-medium uppercase text-slate-500">Budget détaillé</p>
            <p className="mt-1 font-semibold text-ecorse-bleu-900">{STATUTS_BUDGET[c.budgetStatut]}</p>
            <p className="text-xs text-slate-500">{tb && c.lignesBudget!.length ? `Initial ${formatXOF(tb.initial)} · actualisé ${formatXOF(tb.actualise)}` : "Aucune ligne budgétaire"}</p>
          </Link>
        )}
        {voirPlanning && (
          <Link href={`/chantiers/${chantierId}/planning`} className="carte block hover:border-ecorse-vert-500">
            <p className="text-xs font-medium uppercase text-slate-500">Planning</p>
            <p className="mt-1 font-semibold text-ecorse-bleu-900">{taches.length ? `${av ?? 0} % d'avancement` : "Aucune tâche"}</p>
            <p className={`text-xs ${retards.length ? "text-rose-700" : "text-slate-500"}`}>{taches.length ? `${taches.length} tâche(s) · ${retards.length} en retard` : "Créer le planning"}</p>
          </Link>
        )}
        {voirRapports && (
          <Link href={`/rapports?chantier=${chantierId}`} className="carte block hover:border-ecorse-vert-500">
            <p className="text-xs font-medium uppercase text-slate-500">Rapports journaliers</p>
            <p className="mt-1 font-semibold text-ecorse-bleu-900">{rapports.length ? `Dernier : ${formatDate(rapports[0].date)}` : "Aucun rapport"}</p>
            <p className="text-xs text-slate-500">{rapports.filter((r) => r.statut === "SOUMIS").length} à valider</p>
          </Link>
        )}
        {voirDevis && (
          <div className="carte">
            <p className="text-xs font-medium uppercase text-slate-500">Devis rattachés</p>
            {devis.length === 0 ? <p className="mt-1 text-sm text-slate-500">Aucun devis</p> : (
              <ul className="mt-1 space-y-1 text-sm">
                {devis.slice(0, 4).map((d) => (
                  <li key={d.id}>
                    <Link className="lien" href={`/devis/${d.id}`}>{d.numero}-{d.variante} v{d.version}</Link>{" "}
                    <span className={`badge ${COULEUR_DEVIS[d.statut]}`}>{STATUTS_DEVIS[d.statut]}</span>
                    <span className="block text-xs text-slate-500">{formatXOF(totauxDevis(d.lignes, d).totalHT)} HT</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      {voirRapports && rapports.length > 0 && (
        <section className="carte lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2>Derniers rapports journaliers</h2>
            {peut(user.role, "rapports", "creer") && <Link className="btn-secondaire" href={`/rapports/nouveau?chantier=${chantierId}`}>Nouveau rapport</Link>}
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {rapports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="lien" href={`/rapports/${r.id}`}>{formatDate(r.date)}</Link>
                <span className="text-slate-500">{r.effectifTotal} pers.{r.incidents ? " · incident signalé" : ""}</span>
                <span className={`badge ${COULEUR_RAPPORT[r.statut]}`}>{STATUTS_RAPPORT[r.statut]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
