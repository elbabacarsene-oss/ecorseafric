import Link from "next/link";
import { redirect } from "next/navigation";
import { GraphiqueChantiers, type PointChantier } from "@/components/GraphiqueChantiers";
import { EnTetePage } from "@/components/ui";
import { filtreChantiers, filtreDevis, filtreDocuments } from "@/lib/acces";
import { totauxDevis } from "@/lib/devis-calculs";
import { exigerUtilisateur } from "@/lib/auth";
import {
  budgetReference, estEnRetard, joursDeRetard, margePrevisionnelle, montantMarcheActualise, STATUTS_ACTIFS, totalAvenantsApprouves,
} from "@/lib/calculs";
import { db } from "@/lib/db";
import { ajouterJours, aujourdhuiDakar, formatDate, formatNombre, formatXOF } from "@/lib/format";
import { portee, peut, type Action, type Module } from "@/lib/permissions";

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

  // Étape 2 : validations en attente et alertes, limitées au périmètre de l'utilisateur
  const peutP = (m: Module, a: Action) => portee(user.role, m, a) !== null;
  const chantiersDe = (m: Module, a: Action = "lire") => filtreChantiers(user, a, m) ?? { id: "__aucun__" };
  const [devisAValider, budgetsAValider, rapportsAValider, versionsAApprouver, tachesRetard, docsExpires, devisEnCours, rapportsDuJour] = await Promise.all([
    peutP("devis", "approuver") ? db.devis.findMany({ where: { AND: [filtreDevis(user, "approuver")!, { statut: "SOUMIS", preparePar: { not: user.id } }] }, select: { id: true, numero: true, variante: true, version: true } }) : [],
    peutP("budgets", "approuver") ? db.chantier.findMany({ where: { AND: [chantiersDe("budgets", "approuver"), { budgetStatut: "SOUMIS", budgetPreparePar: { not: user.id } }] }, select: { id: true, code: true } }) : [],
    peutP("rapports", "approuver") ? db.rapportJournalier.findMany({ where: { statut: "SOUMIS", redacteurId: { not: user.id }, chantier: chantiersDe("rapports", "approuver") }, select: { id: true, date: true, chantier: { select: { code: true } } }, orderBy: { date: "asc" }, take: 10 }) : [],
    peutP("documents", "approuver") ? db.versionDocument.findMany({ where: { statut: "EN_ATTENTE", deposePar: { not: user.id }, document: filtreDocuments(user, "approuver")! }, select: { id: true, numero: true, document: { select: { id: true, titre: true } } }, take: 10 }) : [],
    peutP("planning", "lire") ? db.tachePlanning.findMany({ where: { chantier: { AND: [chantiersDe("planning"), { statut: { in: STATUTS_ACTIFS } }] }, finPrevue: { lt: auj }, avancement: { lt: 100 }, finReelle: null, enfants: { none: {} } }, select: { id: true, nom: true, importante: true, finPrevue: true, chantier: { select: { id: true, code: true } } }, orderBy: { finPrevue: "asc" } }) : [],
    peutP("documents", "lire") && !user.externe ? db.document.findMany({ where: { AND: [filtreDocuments(user)!, { archive: false, dateValidite: { lt: ajouterJours(auj, 15) } }] }, select: { id: true, titre: true, dateValidite: true }, orderBy: { dateValidite: "asc" }, take: 10 }) : [],
    peutP("devis", "lire") ? db.devis.findMany({ where: { AND: [filtreDevis(user)!, { statut: { in: ["BROUILLON", "SOUMIS", "VALIDE", "ENVOYE"] } }] }, select: { statut: true, tauxFraisChantier: true, tauxFraisGeneraux: true, tauxMarge: true, lignes: { select: { lot: true, quantite: true, debourseSecUnitaire: true, prixUnitaireImpose: true } } } }) : null,
    peutP("rapports", "lire") ? db.rapportJournalier.count({ where: { date: auj, chantier: chantiersDe("rapports") } }) : null,
  ]);
  const importantesEnRetard = tachesRetard.filter((t) => t.importante);
  const devisEnvoyes = devisEnCours?.filter((d) => d.statut === "ENVOYE") ?? [];
  const nbUrgences = avenantsEnAttente.length + enRetard.length + sansDateFin.length + devisAValider.length + budgetsAValider.length + rapportsAValider.length + versionsAApprouver.length + importantesEnRetard.length + docsExpires.length;

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

      {(devisEnCours || rapportsDuJour !== null || peutP("planning", "lire")) && (
        <>
          <h2 className="mb-2">Études et travaux</h2>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {devisEnCours && <Tuile titre="Devis en cours" valeur={formatNombre(devisEnCours.length)} detail="Brouillon, soumis, validés ou envoyés" href="/devis" />}
            {devisEnCours && peut(user.role, "devis_couts", "lire") && (
              <Tuile titre="Devis envoyés en attente" valeur={formatXOF(devisEnvoyes.reduce((s, d) => s + totauxDevis(d.lignes, d).totalHT, 0))} detail={`${devisEnvoyes.length} devis, montant HT`} href="/devis?statut=ENVOYE" />
            )}
            {peutP("planning", "lire") && <Tuile titre="Tâches en retard" valeur={formatNombre(tachesRetard.length)} detail={`dont ${importantesEnRetard.length} importante(s)`} />}
            {rapportsDuJour !== null && <Tuile titre="Rapports du jour" valeur={formatNombre(rapportsDuJour)} detail={`${rapportsAValider.length} rapport(s) à valider`} href="/rapports" />}
          </div>
        </>
      )}

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
          {nbUrgences === 0 ? (
            <p className="text-sm text-slate-500">Aucune action urgente.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {importantesEnRetard.map((t) => (
                <li key={t.id} className="rounded-lg bg-rose-50 p-2">
                  <Link className="lien" href={`/chantiers/${t.chantier.id}/planning#tache-${t.id}`}>{t.chantier.code}</Link> : tâche importante « {t.nom} » en retard depuis le {formatDate(t.finPrevue)}
                </li>
              ))}
              {devisAValider.map((d) => (
                <li key={d.id} className="rounded-lg bg-amber-50 p-2">
                  Devis <Link className="lien" href={`/devis/${d.id}`}>{d.numero}-{d.variante} v{d.version}</Link> à valider
                </li>
              ))}
              {budgetsAValider.map((c) => (
                <li key={c.id} className="rounded-lg bg-amber-50 p-2">
                  <Link className="lien" href={`/chantiers/${c.id}/budget`}>{c.code}</Link> : budget à valider
                </li>
              ))}
              {rapportsAValider.map((r) => (
                <li key={r.id} className="rounded-lg bg-amber-50 p-2">
                  <Link className="lien" href={`/rapports/${r.id}`}>{r.chantier.code}</Link> : rapport du {formatDate(r.date)} à valider
                </li>
              ))}
              {versionsAApprouver.map((v) => (
                <li key={v.id} className="rounded-lg bg-amber-50 p-2">
                  <Link className="lien" href={`/documents/${v.document.id}`}>{v.document.titre}</Link> : version n°{v.numero} à approuver
                </li>
              ))}
              {docsExpires.map((d) => (
                <li key={d.id} className="rounded-lg bg-slate-50 p-2">
                  <Link className="lien" href={`/documents/${d.id}`}>{d.titre}</Link> : {d.dateValidite! < auj ? "expiré" : "expire"} le {formatDate(d.dateValidite)}
                </li>
              ))}
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
