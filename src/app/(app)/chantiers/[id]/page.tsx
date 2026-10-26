import Link from "next/link";
import { FormulaireAction } from "@/components/FormulaireAction";
import { Champ, ChampMontant, CaseACocher } from "@/components/Champs";
import { BadgeStatut, EnTetePage, Info } from "@/components/ui";
import { chantierAccessible, exigerChantier } from "@/lib/acces";
import { ListeDocuments, Photos } from "@/components/Documents";
import { VoletsChantier } from "./VoletsChantier";
import { exigerPermission } from "@/lib/auth";
import {
  budgetReference, dateFinActualisee, delaiAvenantsApprouves, dureePrevueJours, estEnRetard, joursDeRetard,
  margePrevisionnelle, montantMarcheActualise, tauxMarge, totalAvenantsApprouves,
} from "@/lib/calculs";
import { db } from "@/lib/db";
import { aujourdhuiDakar, formatDate, formatDateHeure, formatXOF } from "@/lib/format";
import { REGIONS, STATUTS_AVENANT, TYPES_PROJET } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { ROLES_CLES } from "@/lib/roles-cles";
import { ajouterAffectation, ajouterNote, basculerPortail, creerAvenant, deciderAvenant, retirerAffectation, soumettreAvenant } from "../actions";

export const metadata = { title: "Fiche chantier" };

const personne = (i: { nom: string; prenom: string | null } | null) => (i ? `${i.nom}${i.prenom ? " " + i.prenom : ""}` : null);

export default async function FicheChantier({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("chantiers", "lire");
  const { id } = await params;
  await exigerChantier(user, id); // 404 si l'utilisateur n'a pas accès à ce chantier

  const r = (role: string) => peut(user.role, "avenants", role as "lire");
  const voirMarche = peut(user.role, "chantiers_marche", "lire");
  const voirBudget = peut(user.role, "chantiers_budget", "lire");
  const voirAffectations = peut(user.role, "affectations", "lire");
  // Les relations sont toujours chargées, mais n'apparaissent dans la page que si le rôle y donne accès
  // (les composants serveur n'envoient au navigateur que ce qui est rendu).
  const sel = { select: { id: true, nom: true, prenom: true, telephone: true, email: true } };

  const c = await db.chantier.findUniqueOrThrow({
    where: { id },
    include: {
      client: sel, maitreOuvrage: sel, architecte: sel, bureauEtudes: sel, bureauControle: sel,
      conducteur: sel, chefChantier: sel, responsableQhse: sel,
      avenants: {
        // Les comptes externes ne voient que les avenants approuvés.
        where: user.externe ? { statut: "APPROUVE" } : {},
        orderBy: { numero: "asc" },
        include: { preparateur: { select: { prenom: true, nom: true } }, approbateur: { select: { prenom: true, nom: true } } },
      },
      affectations: { include: { intervenant: { select: { id: true, nom: true, prenom: true, code: true, type: true, utilisateur: { select: { id: true } } } } }, orderBy: { createdAt: "asc" } },
      evenements: { orderBy: { date: "desc" }, take: 50, include: { user: { select: { prenom: true, nom: true } } } },
    },
  });
  // Les calculs ne retiennent que les avenants approuvés (voir lib/calculs.ts).
  const calc = c;
  const auj = aujourdhuiDakar();
  const enRetard = estEnRetard(calc, auj);
  const marge = margePrevisionnelle(calc);
  const taux = tauxMarge(calc);
  const intervenantsDispo = voirAffectations && peut(user.role, "affectations", "creer")
    ? await db.intervenant.findMany({ where: { actif: true }, select: { id: true, nom: true, prenom: true, code: true }, orderBy: { nom: "asc" } })
    : [];

  return (
    <>
      <EnTetePage
        titre={c.nom}
        sousTitre={`${c.code} · ${TYPES_PROJET[c.typeProjet]}${c.ville ? " · " + c.ville : ""}`}
        actions={
          <>
            <BadgeStatut statut={c.statut} />
            {enRetard && <span className="badge bg-rose-100 text-rose-700">En retard de {joursDeRetard(calc, auj)} jours</span>}
            {peut(user.role, "chantiers", "modifier") && !user.externe && <Link href={`/chantiers/${c.id}/modifier`} className="btn-secondaire">Modifier</Link>}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="carte lg:col-span-2">
          <h2 className="mb-3">Informations générales</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Info libelle="Adresse">{[c.adresse, c.ville, c.region && REGIONS[c.region]].filter(Boolean).join(", ") || null}</Info>
            <Info libelle="Coordonnées GPS">
              {c.latitude && c.longitude ? (
                <a className="lien" target="_blank" rel="noopener noreferrer" href={`https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`}>
                  {c.latitude.toString()}, {c.longitude.toString()}
                </a>
              ) : null}
            </Info>
            <Info libelle="Date de démarrage">{formatDate(c.dateDemarrage)}</Info>
            <Info libelle="Date contractuelle de fin">{formatDate(c.dateFinContractuelle)}</Info>
            <Info libelle="Durée prévue">{dureePrevueJours(c.dateDemarrage, c.dateFinContractuelle) !== null ? `${dureePrevueJours(c.dateDemarrage, c.dateFinContractuelle)} jours` : null}</Info>
            <Info libelle="Fin actualisée (avenants approuvés)">
              {formatDate(dateFinActualisee(calc))}
              {delaiAvenantsApprouves(calc.avenants) > 0 && <span className="text-xs text-slate-500"> (+{delaiAvenantsApprouves(calc.avenants)} j)</span>}
            </Info>
            <Info libelle="Fin réelle">{formatDate(c.dateFinReelle)}</Info>
          </dl>
          {c.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{c.description}</p>}
        </section>

        {(voirMarche || voirBudget) && (
          <section className="carte">
            <h2 className="mb-3">Montants</h2>
            <dl className="space-y-3">
              {voirMarche && (
                <>
                  <Info libelle="Marché initial">{formatXOF(c.montantMarche)}</Info>
                  <Info libelle="Avenants approuvés">{formatXOF(totalAvenantsApprouves(calc.avenants))}</Info>
                  <Info libelle="Marché actualisé"><strong>{formatXOF(montantMarcheActualise(calc))}</strong></Info>
                </>
              )}
              {voirBudget && (
                <>
                  <Info libelle="Budget initial">{formatXOF(c.budgetInitial)}</Info>
                  <Info libelle="Budget actualisé">{c.budgetActualise !== null ? formatXOF(c.budgetActualise) : "Non révisé"}</Info>
                  <Info libelle="Marge prévisionnelle">
                    {marge === null ? (
                      <span className="text-slate-500">Non calculable : budget non saisi</span>
                    ) : (
                      <span className={marge < 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>
                        {formatXOF(marge)}{taux !== null && ` (${(taux * 100).toLocaleString("fr-SN", { maximumFractionDigits: 1 })} %)`}
                      </span>
                    )}
                  </Info>
                  <p className="text-xs text-slate-500">
                    Marge prévisionnelle = marché actualisé − {c.budgetActualise !== null ? "budget actualisé" : "budget initial"} ({formatXOF(budgetReference(c))}).
                    Coûts engagés et payés : étape 4.
                  </p>
                </>
              )}
            </dl>
          </section>
        )}

        <section className="carte lg:col-span-3">
          <h2 className="mb-3">Intervenants clés</h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES_CLES.map((rc) => {
              const rel = rc.champ.replace(/Id$/, "") as "client";
              const i = c[rel] as { id: string; nom: string; prenom: string | null; telephone: string | null } | null;
              return (
                <Info key={rc.champ} libelle={rc.libelle}>
                  {i ? (
                    user.externe || !peut(user.role, "intervenants", "lire") ? personne(i) : (
                      <>
                        <Link className="lien" href={`/intervenants/${i.id}`}>{personne(i)}</Link>
                        {i.telephone && <span className="block text-xs text-slate-500">{i.telephone}</span>}
                      </>
                    )
                  ) : null}
                </Info>
              );
            })}
          </dl>
        </section>

        {r("lire") && (
          <section className="carte lg:col-span-3">
            <h2 className="mb-3">Avenants</h2>
            {c.avenants.length === 0 ? (
              <p className="mb-3 text-sm text-slate-500">Aucun avenant{user.externe ? " approuvé" : ""}.</p>
            ) : (
              <div className="mb-4 overflow-x-auto">
                <table className="tableau">
                  <thead><tr><th>N°</th><th>Objet</th><th className="text-right">Montant</th><th>Délai</th><th>Statut</th>{!user.externe && <th>Préparé par</th>}{!user.externe && <th>Décision</th>}{!user.externe && <th></th>}</tr></thead>
                  <tbody>
                    {c.avenants.map((a) => (
                      <tr key={a.id}>
                        <td>{a.numero}</td>
                        <td className="max-w-xs">{a.objet}</td>
                        <td className="whitespace-nowrap text-right">{formatXOF(a.montant)}</td>
                        <td>{a.delaiSupplementaireJours ? `+${a.delaiSupplementaireJours} j` : "—"}</td>
                        <td>{STATUTS_AVENANT[a.statut]}</td>
                        {!user.externe && <td className="whitespace-nowrap">{a.preparateur.prenom} {a.preparateur.nom}</td>}
                        {!user.externe && (
                          <td className="text-xs">
                            {a.approbateur ? `${a.approbateur.prenom} ${a.approbateur.nom}, ${formatDate(a.dateDecision)}` : "—"}
                            {a.motifDecision && <span className="block text-slate-500">{a.motifDecision}</span>}
                          </td>
                        )}
                        {!user.externe && (
                          <td className="min-w-48">
                            {a.statut === "BROUILLON" && r("modifier") && (
                              <FormulaireAction action={soumettreAvenant.bind(null, a.id)} libelle="Soumettre" classeBouton="btn-secondaire" className="space-y-1" />
                            )}
                            {a.statut === "SOUMIS" && r("approuver") && a.preparePar !== user.id && (
                              <div className="space-y-2">
                                <FormulaireAction action={deciderAvenant.bind(null, a.id, "APPROUVE")} libelle="Approuver" classeBouton="btn-primaire" confirmation={`Approuver l'avenant n°${a.numero} de ${formatXOF(a.montant)} ?`} className="space-y-1" />
                                <FormulaireAction action={deciderAvenant.bind(null, a.id, "REJETE")} libelle="Rejeter" classeBouton="btn-secondaire" className="space-y-1">
                                  <input name="motif" placeholder="Motif du rejet" className="champ" aria-label="Motif du rejet" />
                                </FormulaireAction>
                              </div>
                            )}
                            {a.statut === "SOUMIS" && a.preparePar === user.id && <span className="text-xs text-slate-500">En attente d'un autre approbateur</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r("creer") && !user.externe && (
              <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">Préparer un avenant</summary>
                <FormulaireAction action={creerAvenant.bind(null, c.id)} libelle="Enregistrer l'avenant" className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Champ nom="objet" libelle="Objet" requis className="sm:col-span-2" />
                  <ChampMontant nom="montant" libelle="Montant (F CFA)" requis aide="Négatif pour une moins-value." />
                  <Champ nom="delai" libelle="Délai supplémentaire (jours)" type="number" min={0} defaut={0} />
                  <Champ nom="dateSignature" libelle="Date de signature" type="date" />
                  <div className="flex items-end"><CaseACocher nom="soumettre" libelle="Soumettre directement à approbation" /></div>
                </FormulaireAction>
              </details>
            )}
          </section>
        )}

        {voirAffectations && (
          <section className="carte lg:col-span-3">
            <h2 className="mb-3">Équipe et intervenants affectés ({c.affectations.length})</h2>
            {c.affectations.length > 0 && (
              <div className="mb-4 overflow-x-auto">
                <table className="tableau">
                  <thead><tr><th>Intervenant</th><th>Rôle</th><th>Période</th><th>Accès portail</th><th></th></tr></thead>
                  <tbody>
                    {c.affectations.map((a) => {
                      const cle = ROLES_CLES.some((rc) => rc.libelle === a.roleChantier);
                      return (
                        <tr key={a.id}>
                          <td><Link className="lien" href={`/intervenants/${a.intervenant.id}`}>{personne(a.intervenant)}</Link> <span className="text-xs text-slate-500">{a.intervenant.code}</span></td>
                          <td>{a.roleChantier}{cle && <span className="badge ml-1 bg-slate-100 text-slate-600">clé</span>}</td>
                          <td className="whitespace-nowrap">{a.dateDebut || a.dateFin ? `${formatDate(a.dateDebut)} → ${formatDate(a.dateFin)}` : "—"}</td>
                          <td>
                            {a.accesPortail ? "Ouvert" : "Fermé"}
                            {!a.intervenant.utilisateur && <span className="block text-xs text-slate-400">pas de compte</span>}
                          </td>
                          <td className="flex flex-wrap gap-2">
                            {peut(user.role, "affectations", "modifier") && (
                              <FormulaireAction action={basculerPortail.bind(null, a.id)} libelle={a.accesPortail ? "Fermer le portail" : "Ouvrir le portail"} classeBouton="btn-secondaire" className="space-y-1" />
                            )}
                            {!cle && peut(user.role, "affectations", "supprimer") && (
                              <FormulaireAction action={retirerAffectation.bind(null, a.id)} libelle="Retirer" classeBouton="btn-secondaire" confirmation="Retirer cette affectation ?" className="space-y-1" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {peut(user.role, "affectations", "creer") && (
              <details className="rounded-lg border border-slate-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">Affecter un intervenant</summary>
                <FormulaireAction action={ajouterAffectation.bind(null, c.id)} libelle="Affecter" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label htmlFor="intervenantId" className="etiquette">Intervenant <span className="text-rose-600">*</span></label>
                    <select id="intervenantId" name="intervenantId" required className="champ" defaultValue="">
                      <option value="">— Choisir —</option>
                      {intervenantsDispo.map((i) => <option key={i.id} value={i.id}>{personne(i)} ({i.code})</option>)}
                    </select>
                  </div>
                  <Champ nom="roleChantier" libelle="Rôle sur le chantier" requis placeholder="ex. Sous-traitant lot étanchéité" className="sm:col-span-2" />
                  <Champ nom="dateDebut" libelle="Début" type="date" />
                  <Champ nom="dateFin" libelle="Fin" type="date" />
                  {peut(user.role, "affectations", "modifier") && (
                    <div className="flex items-end sm:col-span-2"><CaseACocher nom="accesPortail" libelle="Ouvrir l'accès portail à ce chantier" aide="Pour un intervenant externe disposant d'un compte." /></div>
                  )}
                </FormulaireAction>
              </details>
            )}
          </section>
        )}

        {!user.externe && (
          <section className="carte lg:col-span-3">
            <h2 className="mb-3">Historique des événements</h2>
            {peut(user.role, "chantiers", "modifier") && (
              <FormulaireAction action={ajouterNote.bind(null, c.id)} libelle="Ajouter au journal" classeBouton="btn-secondaire" className="mb-4 space-y-2">
                <textarea name="note" rows={2} required maxLength={2000} className="champ" placeholder="Événement, décision, visite, observation…" aria-label="Note" />
              </FormulaireAction>
            )}
            {c.evenements.length === 0 ? (
              <p className="text-sm text-slate-500">Aucun événement.</p>
            ) : (
              <ol className="space-y-3 border-l-2 border-ecorse-vert-100 pl-4">
                {c.evenements.map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className="text-xs text-slate-500">{formatDateHeure(e.date)} · {e.user ? `${e.user.prenom} ${e.user.nom}` : "Système"} · {e.type}</p>
                    <p className="whitespace-pre-line">{e.description}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <VoletsChantier user={user} chantierId={c.id} />
      </div>

      {peut(user.role, "documents", "lire") && (
        <>
          <ListeDocuments
            user={user}
            titre={user.externe ? "Documents partagés" : "Documents du chantier"}
            where={{ chantierId: c.id }}
            cible={{ chantierId: c.id }}
            peutDeposer={!user.externe && peut(user.role, "documents", "creer") && (await chantierAccessible(user, c.id, "creer", "documents"))}
          />
          <Photos user={user} where={{ chantierId: c.id }} cible={{ chantierId: c.id }} peutDeposer={!user.externe && peut(user.role, "documents", "creer") && (await chantierAccessible(user, c.id, "creer", "documents"))} />
        </>
      )}
    </>
  );
}
