import Link from "next/link";
import { CaseACocher, Champ, Selection } from "@/components/Champs";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Gantt, type BarreGantt } from "@/components/Gantt";
import { EnTetePage } from "@/components/ui";
import { chantierAccessible, exigerChantier } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { dateFinActualisee } from "@/lib/calculs";
import { db } from "@/lib/db";
import { aujourdhuiDakar, formatDate, formatDateHeure, toInputDate } from "@/lib/format";
import { peut } from "@/lib/permissions";
import { avancementGlobal, cheminCritique, dureeJours, ecartReference, etatTache, type ResultatCPM } from "@/lib/planning-calculs";
import {
  ajouterDependance, creerTache, figerReference, modifierTache, recalculerPlanning, supprimerDependance, supprimerTache,
} from "../../../planning/actions";

export const metadata = { title: "Planning du chantier" };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const nomIntervenant = (i: { nom: string; prenom: string | null } | null) => (i ? `${i.nom}${i.prenom ? " " + i.prenom : ""}` : null);

export default async function PagePlanning({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { user } = await exigerPermission("planning", "lire");
  const { id } = await params;
  const sp = await searchParams;
  await exigerChantier(user, id, "lire", "planning");
  const c = await db.chantier.findUniqueOrThrow({
    where: { id },
    include: { avenants: { select: { statut: true, montant: true, delaiSupplementaireJours: true } } },
  });
  const taches = await db.tachePlanning.findMany({
    where: { chantierId: id },
    orderBy: { ordre: "asc" },
    include: {
      responsable: { select: { nom: true, prenom: true } },
      intervenant: { select: { nom: true, prenom: true } },
      predecesseurs: { include: { predecesseur: { select: { id: true, nom: true } } } },
      _count: { select: { enfants: true } },
    },
  });
  const peutCreer = peut(user.role, "planning", "creer") && (await chantierAccessible(user, id, "creer", "planning"));
  const peutModifier = peut(user.role, "planning", "modifier") && (await chantierAccessible(user, id, "modifier", "planning"));
  const peutSupprimer = peut(user.role, "planning", "supprimer") && peutModifier;
  const auj = aujourdhuiDakar();

  // Arborescence (ordre de saisie, sous-tâches sous leur parent)
  const ordonnees: (typeof taches[number] & { niveau: number })[] = [];
  const ajouter = (parentId: string | null, niveau: number) => {
    for (const t of taches.filter((x) => x.parentId === parentId)) {
      ordonnees.push({ ...t, niveau });
      ajouter(t.id, niveau + 1);
    }
  };
  ajouter(null, 0);

  const feuilles = taches.filter((t) => !t._count.enfants);
  const deps = taches.flatMap((t) => t.predecesseurs.map((p) => ({ id: p.id, predecesseurId: p.predecesseurId, successeurId: t.id, decalageJours: p.decalageJours })));
  let cpm: ResultatCPM | null = null;
  let erreurCpm: string | null = null;
  try {
    cpm = feuilles.length ? cheminCritique(feuilles, deps) : null;
  } catch (e) {
    erreurCpm = (e as Error).message;
  }
  const finActualisee = dateFinActualisee(c);
  const avGlobal = avancementGlobal(taches);
  const enRetard = feuilles.filter((t) => etatTache(t, auj).enRetard);
  const finProjet = cpm?.finProjet ?? null;
  const depassement = finProjet && finActualisee ? Math.round((finProjet.getTime() - finActualisee.getTime()) / 86_400_000) : null;

  // Filtres
  const filtres = { lot: sp.lot ?? "", corpsEtat: sp.corpsEtat ?? "", equipe: sp.equipe ?? "", intervenant: sp.intervenant ?? "" };
  const valeurs = (k: "lot" | "corpsEtat" | "equipe") => [...new Set(taches.map((t) => t[k]).filter((x): x is string => !!x))].sort();
  const affichees = ordonnees.filter((t) =>
    (!filtres.lot || t.lot === filtres.lot) && (!filtres.corpsEtat || t.corpsEtat === filtres.corpsEtat) && (!filtres.equipe || t.equipe === filtres.equipe)
    && (!filtres.intervenant || t.intervenantId === filtres.intervenant || t.responsableId === filtres.intervenant));
  const filtre = Object.values(filtres).some(Boolean);

  const barres: BarreGantt[] = affichees.map((t) => {
    const e = etatTache(t, auj);
    const marge = cpm?.marge.get(t.id);
    const ecart = ecartReference(t);
    return {
      id: t.id, nom: t.nom, niveau: filtre ? 0 : t.niveau, jalon: t.type === "JALON", recapitulative: t._count.enfants > 0,
      debut: iso(t.debutPrevu)!, fin: iso(t.finPrevue)!, debutRef: iso(t.debutReference), finRef: iso(t.finReference),
      debutReel: iso(t.debutReel), finReelle: iso(t.finReelle), avancement: t.avancement,
      critique: !!cpm?.critiques.has(t.id), enRetard: e.enRetard, importante: t.importante,
      info: [
        t.nom,
        `Prévu : ${formatDate(t.debutPrevu)} → ${formatDate(t.finPrevue)} (${dureeJours(t)} j)`,
        t.finReference ? `Référence : ${formatDate(t.debutReference)} → ${formatDate(t.finReference)}${ecart ? ` (écart ${ecart > 0 ? "+" : ""}${ecart} j)` : ""}` : "",
        t.debutReel ? `Réel : ${formatDate(t.debutReel)} → ${formatDate(t.finReelle)}` : "",
        `Avancement : ${t.avancement} % (attendu ${e.avancementAttendu} %)`,
        marge !== undefined ? `Marge totale : ${marge} j${marge <= 0 ? " — chemin critique" : ""}` : "",
        e.enRetard ? `EN RETARD de ${e.joursRetard} j` : "",
        nomIntervenant(t.responsable) ? `Responsable : ${nomIntervenant(t.responsable)}` : "",
      ].filter(Boolean).join("\n"),
    };
  });

  const intervenants = await db.intervenant.findMany({
    where: { actif: true, categorie: { in: ["PERSONNEL_INTERNE", "INTERVENANT_EXTERNE", "MAITRISE_OEUVRE"] } },
    select: { id: true, nom: true, prenom: true, code: true, categorie: true },
    orderBy: { nom: "asc" },
  });
  const optInternes = intervenants.filter((i) => i.categorie === "PERSONNEL_INTERNE").map((i) => [i.id, `${nomIntervenant(i)} (${i.code})`] as [string, string]);
  const optExternes = intervenants.filter((i) => i.categorie !== "PERSONNEL_INTERNE").map((i) => [i.id, `${nomIntervenant(i)} (${i.code})`] as [string, string]);
  const optParents = ordonnees.filter((t) => t.type === "TACHE" && t.predecesseurs.length === 0 && !deps.some((d) => d.predecesseurId === t.id)).map((t) => [t.id, `${"— ".repeat(t.niveau)}${t.nom}`] as [string, string]);
  const optFeuilles = ordonnees.filter((t) => !t._count.enfants).map((t) => [t.id, t.nom] as [string, string]);

  return (
    <>
      <EnTetePage
        titre={`Planning · ${c.code}`}
        sousTitre={c.nom}
        actions={<Link href={`/chantiers/${c.id}`} className="btn-secondaire">Fiche chantier</Link>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tuile t="Avancement global" v={avGlobal === null ? "—" : `${avGlobal} %`} d="Pondéré par la durée des tâches" />
        <Tuile t="Fin prévue (planning)" v={finProjet ? formatDate(finProjet) : "—"} d={depassement !== null ? (depassement > 0 ? `${depassement} j après la fin contractuelle` : "Dans le délai contractuel") : undefined} alerte={depassement !== null && depassement > 0} />
        <Tuile t="Fin contractuelle actualisée" v={formatDate(finActualisee)} />
        <Tuile t="Tâches en retard" v={String(enRetard.length)} d={`dont ${enRetard.filter((t) => t.importante).length} importante(s)`} alerte={enRetard.length > 0} />
        <Tuile t="Planning de référence" v={c.planningReferenceLe ? formatDate(c.planningReferenceLe) : "Non figé"} d={c.planningReferenceLe ? `figé le ${formatDateHeure(c.planningReferenceLe)}` : "Figez-le pour suivre les écarts"} />
      </div>

      {erreurCpm && <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{erreurCpm}</p>}
      {cpm && cpm.conflits.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{cpm.conflits.length} enchaînement(s) non respecté(s) :</p>
          <ul className="ml-4 list-disc">
            {cpm.conflits.map((x, i) => (
              <li key={i}>« {taches.find((t) => t.id === x.successeurId)?.nom} » commence {x.joursManquants} jour(s) trop tôt après « {taches.find((t) => t.id === x.predecesseurId)?.nom} ».</li>
            ))}
          </ul>
          {peutModifier && <FormulaireAction action={recalculerPlanning.bind(null, c.id)} libelle="Décaler les tâches concernées" confirmation="Décaler automatiquement les tâches pour respecter les dépendances ?" className="mt-2 space-y-2" />}
        </div>
      )}

      <section className="carte mb-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2>Diagramme de Gantt</h2>
          {peutModifier && taches.length > 0 && (
            <FormulaireAction action={figerReference.bind(null, c.id)} libelle={c.planningReferenceLe ? "Figer un nouveau planning de référence" : "Figer comme planning de référence"} classeBouton="btn-secondaire" confirmation="Les dates actuelles deviendront la référence de comparaison. Continuer ?" className="space-y-1" />
          )}
        </div>
        <form method="get" className="mb-3 grid gap-2 sm:grid-cols-5">
          {(["lot", "corpsEtat", "equipe"] as const).map((k) => (
            <select key={k} name={k} defaultValue={filtres[k]} className="champ" aria-label={k}>
              <option value="">{k === "lot" ? "Tous lots" : k === "corpsEtat" ? "Tous corps d'état" : "Toutes équipes"}</option>
              {valeurs(k).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          ))}
          <select name="intervenant" defaultValue={filtres.intervenant} className="champ" aria-label="Intervenant">
            <option value="">Tous intervenants</option>
            {[...optInternes, ...optExternes].filter(([v]) => taches.some((t) => t.intervenantId === v || t.responsableId === v)).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn-secondaire">Filtrer</button>
        </form>
        {barres.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">{taches.length ? "Aucune tâche pour ce filtre." : "Aucune tâche planifiée."}</p>
        ) : (
          <Gantt barres={barres} aujourdhui={iso(auj)!} finContractuelle={iso(finActualisee)} />
        )}
      </section>

      {peutCreer && (
        <section className="carte mb-4">
          <details open={taches.length === 0}>
            <summary className="cursor-pointer font-semibold text-ecorse-bleu-900">Ajouter une tâche ou un jalon</summary>
            <FormulaireAction action={creerTache.bind(null, c.id)} libelle="Ajouter" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ChampsTache optParents={optParents} optInternes={optInternes} optExternes={optExternes} />
            </FormulaireAction>
          </details>
        </section>
      )}

      <section className="carte">
        <h2 className="mb-3">Tâches ({affichees.length})</h2>
        {affichees.length === 0 ? <p className="text-sm text-slate-500">Aucune tâche.</p> : (
          <div className="overflow-x-auto">
            <table className="tableau">
              <thead><tr><th>Tâche</th><th>Prévu</th><th>Réel</th><th className="text-right">Avanc.</th><th>Écart réf.</th><th>Marge</th><th>Responsable / exécutant</th><th>Enchaînements</th></tr></thead>
              <tbody>
                {affichees.map((t) => {
                  const e = etatTache(t, auj);
                  const ecart = ecartReference(t);
                  const marge = cpm?.marge.get(t.id);
                  return (
                    <tr key={t.id} id={`tache-${t.id}`} className={e.enRetard ? "bg-rose-50/60" : ""}>
                      <td className="min-w-56" style={{ paddingLeft: 12 + (filtre ? 0 : t.niveau) * 14 }}>
                        <span className={t._count.enfants ? "font-semibold" : ""}>{t.type === "JALON" ? "◆ " : ""}{t.nom}</span>
                        {t.importante && <span className="badge ml-1 bg-amber-100 text-amber-800">importante</span>}
                        {cpm?.critiques.has(t.id) && <span className="badge ml-1 bg-rose-100 text-rose-700">critique</span>}
                        {e.enRetard && <span className="badge ml-1 bg-rose-600 text-white">retard {e.joursRetard} j</span>}
                        {!e.enRetard && e.demarrageEnRetard && <span className="badge ml-1 bg-amber-100 text-amber-800">non démarrée</span>}
                        <span className="block text-xs text-slate-500">{[t.lot, t.corpsEtat, t.equipe].filter(Boolean).join(" · ")}</span>
                        {(peutModifier || peutSupprimer) && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-xs text-ecorse-bleu-700">Modifier</summary>
                            {peutModifier && (
                              <FormulaireAction action={modifierTache.bind(null, t.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                                <ChampsTache t={t} optParents={optParents.filter(([v]) => v !== t.id)} optInternes={optInternes} optExternes={optExternes} recapitulative={t._count.enfants > 0} />
                                <Champ nom="debutReel" libelle="Début réel" type="date" defaut={toInputDate(t.debutReel)} />
                                <Champ nom="finReelle" libelle="Fin réelle" type="date" defaut={toInputDate(t.finReelle)} aide="Renseigner la fin réelle met l'avancement à 100 %." />
                                {!t._count.enfants && <Champ nom="avancement" libelle="Avancement (%)" type="number" min={0} max={100} defaut={t.avancement} />}
                              </FormulaireAction>
                            )}
                            {peutSupprimer && <FormulaireAction action={supprimerTache.bind(null, t.id)} libelle="Supprimer" classeBouton="btn-secondaire" confirmation={t._count.enfants ? "Supprimer cette tâche ET ses sous-tâches ?" : "Supprimer cette tâche ?"} className="mt-2" />}
                          </details>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-xs">{formatDate(t.debutPrevu)}{t.type === "TACHE" && <> → {formatDate(t.finPrevue)}<br />{dureeJours(t)} j</>}</td>
                      <td className="whitespace-nowrap text-xs">{t.debutReel ? `${formatDate(t.debutReel)} → ${formatDate(t.finReelle)}` : "—"}</td>
                      <td className="text-right">{t.avancement} %<span className="block text-xs text-slate-400">attendu {e.avancementAttendu} %</span></td>
                      <td className={`whitespace-nowrap ${ecart && ecart > 0 ? "text-rose-700" : ""}`}>{ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${ecart} j`}</td>
                      <td>{marge === undefined ? "—" : `${marge} j`}</td>
                      <td className="text-xs">{nomIntervenant(t.responsable) ?? "—"}{t.intervenant && <span className="block text-slate-500">{nomIntervenant(t.intervenant)}</span>}</td>
                      <td className="min-w-48 text-xs">
                        {t.predecesseurs.map((p) => (
                          <div key={p.id} className="flex items-center gap-1">
                            après « {p.predecesseur.nom} »{p.decalageJours ? ` ${p.decalageJours > 0 ? "+" : ""}${p.decalageJours} j` : ""}
                            {peutModifier && <FormulaireAction action={supprimerDependance.bind(null, p.id)} libelle="×" classeBouton="text-rose-600 hover:underline" className="inline" />}
                          </div>
                        ))}
                        {peutModifier && !t._count.enfants && optFeuilles.length > 1 && (
                          <details>
                            <summary className="cursor-pointer text-ecorse-bleu-700">+ enchaînement</summary>
                            <FormulaireAction action={ajouterDependance.bind(null, t.id)} libelle="Ajouter" classeBouton="btn-secondaire" className="mt-1 space-y-1">
                              <select name="predecesseurId" required className="champ" aria-label="Commence après la fin de">
                                <option value="">Commence après la fin de…</option>
                                {optFeuilles.filter(([v]) => v !== t.id).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                              <input name="decalageJours" type="number" className="champ" placeholder="Décalage (jours, ex. séchage)" aria-label="Décalage en jours" />
                            </FormulaireAction>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Les tâches importantes en retard apparaissent dans les actions urgentes du tableau de bord et sur la fiche du chantier. L'envoi d'alertes par e-mail sera activé avec les notifications avancées (étape 6).
        </p>
      </section>
    </>
  );
}

function Tuile({ t, v, d, alerte }: { t: string; v: string; d?: string; alerte?: boolean }) {
  return (
    <div className={`carte ${alerte ? "border-rose-300" : ""}`}>
      <p className="text-xs uppercase text-slate-500">{t}</p>
      <p className={`text-lg font-semibold ${alerte ? "text-rose-700" : "text-ecorse-bleu-900"}`}>{v}</p>
      {d && <p className="text-xs text-slate-500">{d}</p>}
    </div>
  );
}

type TacheForm = { nom: string; type: string; parentId: string | null; lot: string | null; corpsEtat: string | null; equipe: string | null; responsableId: string | null; intervenantId: string | null; debutPrevu: Date; finPrevue: Date; importante: boolean; ressources: string | null };

function ChampsTache({ t, optParents, optInternes, optExternes, recapitulative }: { t?: TacheForm; optParents: [string, string][]; optInternes: [string, string][]; optExternes: [string, string][]; recapitulative?: boolean }) {
  return (
    <>
      <Champ nom="nom" libelle="Nom" requis defaut={t?.nom} className="sm:col-span-2" placeholder="ex. Coulage dalle haute RDC" />
      <Selection nom="type" libelle="Type" options={[["TACHE", "Tâche"], ["JALON", "Jalon"]]} defaut={t?.type ?? "TACHE"} vide={false} />
      <Selection nom="parentId" libelle="Sous-tâche de" options={optParents} defaut={t?.parentId} vide="— Aucune —" />
      <Champ nom="debutPrevu" libelle="Début prévu (ou date du jalon)" type="date" requis defaut={toInputDate(t?.debutPrevu)} disabled={recapitulative} />
      <Champ nom="finPrevue" libelle="Fin prévue" type="date" defaut={toInputDate(t?.finPrevue)} disabled={recapitulative} aide={recapitulative ? "Calculées à partir des sous-tâches." : "Inutile pour un jalon."} />
      {recapitulative && (
        <>
          <input type="hidden" name="debutPrevu" value={toInputDate(t?.debutPrevu)} />
          <input type="hidden" name="finPrevue" value={toInputDate(t?.finPrevue)} />
        </>
      )}
      <Champ nom="lot" libelle="Lot" defaut={t?.lot} />
      <Champ nom="corpsEtat" libelle="Corps d'état" defaut={t?.corpsEtat} />
      <Champ nom="equipe" libelle="Équipe" defaut={t?.equipe} />
      <Selection nom="responsableId" libelle="Responsable (interne)" options={optInternes} defaut={t?.responsableId} vide="— Aucun —" />
      <Selection nom="intervenantId" libelle="Exécutant externe" options={optExternes} defaut={t?.intervenantId} vide="— Aucun —" />
      <Champ nom="ressources" libelle="Ressources" defaut={t?.ressources} placeholder="ex. 2 maçons, 1 bétonnière" />
      <div className="flex items-end"><CaseACocher nom="importante" libelle="Tâche importante (alerte si retard)" defaut={t?.importante} /></div>
    </>
  );
}
