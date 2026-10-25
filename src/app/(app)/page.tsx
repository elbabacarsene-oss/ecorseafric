import Link from "next/link";
import { redirect } from "next/navigation";
import { GraphiqueChantiers, type PointChantier } from "@/components/GraphiqueChantiers";
import { EnTetePage } from "@/components/ui";
import { filtreChantiers } from "@/lib/acces";
import { exigerUtilisateur } from "@/lib/auth";
import {
  budgetReference, estEnRetard, joursDeRetard, margePrevisionnelle, montantMarcheActualise, STATUTS_ACTIFS, totalAvenantsApprouves,
} from "@/lib/calculs";
import { db } from "@/lib/db";
import { aujourdhuiDakar, formatDate, formatNombre, formatXOF } from "@/lib/format";
import { portee, peut } from "@/lib/permissions";

export const metadata = { title: "Tableau de bord" };

function Tuile({ titre, valeur, detail, href }: { titre: string; valeur: string; detail?: string; href?: string }) {
  const contenu = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{titre}</p>
      <p className="mt-1 text-xl font-semibold text-ecorse-bleu-900 sm:text-2xl">{valeur}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </>
  );
  return href ? <Link href={href} className="carte block hover:border-ecorse-vert-500">{contenu}</Link> : <div className="carte">{contenu}</div>;
}

/** Indicateur dont le module source n'est pas encore livré : on ne montre aucun chiffre. */
function TuileAVenir({ titre, etape }: { titre: string; etape: number }) {
  return (
    <div className="carte border-dashed bg-slate-50">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{titre}</p>
      <p className="mt-1 text-sm text-slate-400">Aucune donnée : module prévu à l'étape {etape}</p>
    </div>
  );
}

export default async function TableauDeBord() {
  const user = await exigerUtilisateur();
  if (!peut(user.role, "tableau_de_bord", "lire")) redirect("/chantiers");
  const voirMarche = peut(user.role, "chantiers_marche", "lire");
  const voirBudget = peut(user.role, "chantiers_budget", "lire");

  const chantiers = await db.chantier.findMany({
    where: { AND: [filtreChantiers(user)!, { statut: { not: "ANNULE" } }] },
    select: {
      id: true, code: true, nom: true, statut: true, montantMarche: true, budgetInitial: true, budgetActualise: true,
      dateFinContractuelle: true, avenants: { select: { statut: true, montant: true, delaiSupplementaireJours: true } },
    },
    orderBy: { code: "asc" },
  });
  const auj = aujourdhuiDakar();
  const actifs = chantiers.filter((c) => STATUTS_ACTIFS.includes(c.statut));
  const enPrep = chantiers.filter((c) => c.statut === "EN_PREPARATION");
  const enRetard = chantiers.filter((c) => estEnRetard(c, auj));
  const somme = (f: (c: (typeof chantiers)[number]) => number) => chantiers.reduce((s, c) => s + f(c), 0);
  const avecBudget = chantiers.filter((c) => margePrevisionnelle(c) !== null);

  // Actions urgentes : uniquement des faits enregistrés.
  const peutApprouver = portee(user.role, "avenants", "approuver");
  const avenantsEnAttente = peutApprouver
    ? await db.avenant.findMany({
        where: { statut: "SOUMIS", preparePar: { not: user.id }, chantier: filtreChantiers(user, "approuver", "avenants")! },
        include: { chantier: { select: { id: true, code: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const sansDateFin = actifs.filter((c) => !c.dateFinContractuelle);

  const graph: PointChantier[] = chantiers
    .filter((c) => c.statut !== "CLOTURE")
    .map((c) => ({ code: c.code, nom: c.nom, marche: montantMarcheActualise(c), budget: budgetReference(c) }))
    .filter((p) => p.marche > 0 || p.budget > 0)
    .sort((a, b) => b.marche - a.marche)
    .slice(0, 12);

  const portee_ = portee(user.role, "tableau_de_bord", "lire");

  return (
    <>
      <EnTetePage
        titre="Tableau de bord"
        sousTitre={`Situation au ${formatDate(auj)}${portee_ === "affectes" ? " · limitée à vos chantiers" : ""} · chiffres calculés à partir des données enregistrées`}
      />

      <h2 className="mb-2">Chantiers</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tuile titre="Chantiers actifs" valeur={formatNombre(actifs.length)} detail="En cours ou suspendus" href="/chantiers?statut=EN_COURS" />
        <Tuile titre="En préparation" valeur={formatNombre(enPrep.length)} href="/chantiers?statut=EN_PREPARATION" />
        <Tuile titre="En retard" valeur={formatNombre(enRetard.length)} detail="Fin actualisée dépassée" href="/chantiers?retard=1" />
        <TuileAVenir titre="Salariés présents" etape={3} />
      </div>

      {(voirMarche || voirBudget) && (
        <>
          <h2 className="mb-2">Marchés et budgets</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {voirMarche && <Tuile titre="Montant total des marchés" valeur={formatXOF(somme((c) => Number(c.montantMarche)))} detail="Marchés initiaux, hors annulés" />}
            {voirMarche && <Tuile titre="Avenants approuvés" valeur={formatXOF(somme((c) => totalAvenantsApprouves(c.avenants)))} />}
            {voirBudget && <Tuile titre="Budget global" valeur={formatXOF(somme(budgetReference))} detail="Budget actualisé, sinon initial" />}
            {voirBudget && (
              <Tuile
                titre="Marge prévisionnelle"
                valeur={avecBudget.length ? formatXOF(avecBudget.reduce((s, c) => s + margePrevisionnelle(c)!, 0)) : "Non calculable"}
                detail={`Sur ${avecBudget.length} chantier(s) dont le budget est saisi`}
              />
            )}
          </div>
        </>
      )}

      <h2 className="mb-2">Finances, achats, RH et QHSE</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TuileAVenir titre="Dépenses engagées" etape={4} />
        <TuileAVenir titre="Dépenses payées" etape={4} />
        <TuileAVenir titre="Factures clients émises" etape={4} />
        <TuileAVenir titre="Encaissements reçus" etape={4} />
        <TuileAVenir titre="Créances clients" etape={4} />
        <TuileAVenir titre="Dettes fournisseurs" etape={4} />
        <TuileAVenir titre="Trésorerie enregistrée" etape={4} />
        <TuileAVenir titre="Marge actualisée estimée" etape={4} />
        <TuileAVenir titre="Factures à échéance" etape={4} />
        <TuileAVenir titre="Achats en attente de validation" etape={3} />
        <TuileAVenir titre="Alertes QHSE" etape={5} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="carte lg:col-span-2">
          <h2 className="mb-1">Comparaison des chantiers</h2>
          {voirMarche && graph.length > 0 ? (
            <>
              <p className="mb-2 text-xs text-slate-500">Marché actualisé{voirBudget ? " et budget de référence" : ""} par chantier (12 plus importants, hors clôturés).</p>
              <GraphiqueChantiers donnees={graph} avecBudget={voirBudget} />
            </>
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">
              {voirMarche ? "Aucun chantier avec un montant de marché ou un budget saisi." : "Les montants ne sont pas accessibles avec votre rôle."}
            </p>
          )}
        </section>

        <section className="carte">
          <h2 className="mb-3">Actions urgentes</h2>
          {avenantsEnAttente.length === 0 && enRetard.length === 0 && sansDateFin.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune action urgente.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {avenantsEnAttente.map((a) => (
                <li key={a.id} className="rounded-lg bg-amber-50 p-2">
                  <Link className="lien" href={`/chantiers/${a.chantier.id}`}>{a.chantier.code}</Link> : avenant n°{a.numero} ({formatXOF(a.montant)}) à approuver
                </li>
              ))}
              {enRetard.map((c) => (
                <li key={c.id} className="rounded-lg bg-rose-50 p-2">
                  <Link className="lien" href={`/chantiers/${c.id}`}>{c.code}</Link> : en retard de {joursDeRetard(c, auj)} jours
                </li>
              ))}
              {sansDateFin.map((c) => (
                <li key={c.id} className="rounded-lg bg-slate-50 p-2">
                  <Link className="lien" href={`/chantiers/${c.id}`}>{c.code}</Link> : chantier actif sans date contractuelle de fin
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
