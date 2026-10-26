import Link from "next/link";
import { Champ, ChampMontant, Selection } from "@/components/Champs";
import { FormulaireAction } from "@/components/FormulaireAction";
import { GraphiqueBudget } from "@/components/GraphiqueBudget";
import { EnTetePage, Info } from "@/components/ui";
import { chantierAccessible, exigerChantier } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { alertesBudget, totauxBudget } from "@/lib/budget-calculs";
import { montantMarcheActualise } from "@/lib/calculs";
import { db } from "@/lib/db";
import { formatDateHeure, formatXOF } from "@/lib/format";
import { POSTES_BUDGET, STATUTS_BUDGET } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { ajouterLigneBudget, deciderBudget, modifierLigneBudget, soumettreBudget, supprimerLigneBudget } from "../../../budgets/actions";

export const metadata = { title: "Budget du chantier" };

const COULEUR: Record<string, string> = {
  NON_ETABLI: "bg-slate-100 text-slate-700", BROUILLON: "bg-sky-100 text-sky-800", SOUMIS: "bg-amber-100 text-amber-800", VALIDE: "bg-emerald-100 text-emerald-800",
};

export default async function PageBudget({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("budgets", "lire");
  const { id } = await params;
  await exigerChantier(user, id, "lire", "budgets");
  const c = await db.chantier.findUniqueOrThrow({
    where: { id },
    include: {
      avenants: { select: { statut: true, montant: true, delaiSupplementaireJours: true } },
      lignesBudget: { orderBy: [{ lot: "asc" }, { ordre: "asc" }] },
      budgetPreparateur: { select: { prenom: true, nom: true } },
      budgetValidateur: { select: { prenom: true, nom: true } },
      devis: { where: { statut: "ACCEPTE" }, select: { id: true, numero: true, variante: true, version: true } },
    },
  });
  const t = totauxBudget(c.lignesBudget);
  const marche = montantMarcheActualise(c);
  const alertes = alertesBudget(c.lignesBudget, marche);
  const voirMarche = peut(user.role, "chantiers_marche", "lire");
  const peutCreer = peut(user.role, "budgets", "creer") && (await chantierAccessible(user, id, "creer", "budgets"));
  const peutModifier = peut(user.role, "budgets", "modifier") && (await chantierAccessible(user, id, "modifier", "budgets"));
  const peutApprouver = peut(user.role, "budgets", "approuver") && (await chantierAccessible(user, id, "approuver", "budgets"));
  const valide = c.budgetStatut === "VALIDE";
  const editable = peutModifier && (c.budgetStatut === "BROUILLON" || c.budgetStatut === "NON_ETABLI");
  const lots = [...new Set(c.lignesBudget.map((l) => l.lot))];

  return (
    <>
      <EnTetePage
        titre={`Budget · ${c.code}`}
        sousTitre={c.nom}
        actions={
          <>
            <span className={`badge ${COULEUR[c.budgetStatut]}`}>{STATUTS_BUDGET[c.budgetStatut]}</span>
            <Link href={`/chantiers/${c.id}`} className="btn-secondaire">Fiche chantier</Link>
          </>
        }
      />

      {alertes.length > 0 && (
        <ul className="mb-4 space-y-2">
          {alertes.map((a, i) => (
            <li key={i} className={`rounded-lg border p-3 text-sm ${a.niveau === "critique" ? "border-rose-200 bg-rose-50 text-rose-800" : a.niveau === "alerte" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"}`}>{a.message}</li>
          ))}
        </ul>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="carte"><p className="text-xs uppercase text-slate-500">Budget initial</p><p className="text-lg font-semibold text-ecorse-bleu-900">{c.lignesBudget.length ? formatXOF(t.initial) : "Non établi"}</p></div>
        <div className="carte"><p className="text-xs uppercase text-slate-500">Budget actualisé</p><p className="text-lg font-semibold text-ecorse-bleu-900">{c.lignesBudget.length ? formatXOF(t.actualise) : "—"}</p></div>
        <div className="carte"><p className="text-xs uppercase text-slate-500">Écart</p><p className={`text-lg font-semibold ${t.ecart > 0 ? "text-rose-700" : "text-ecorse-bleu-900"}`}>{c.lignesBudget.length ? formatXOF(t.ecart) : "—"}</p></div>
        {voirMarche && <div className="carte"><p className="text-xs uppercase text-slate-500">Marché actualisé</p><p className="text-lg font-semibold text-ecorse-bleu-900">{formatXOF(marche)}</p></div>}
        {voirMarche && (
          <div className="carte">
            <p className="text-xs uppercase text-slate-500">Marge prévisionnelle</p>
            <p className={`text-lg font-semibold ${marche - t.actualise < 0 ? "text-rose-700" : "text-emerald-700"}`}>{c.lignesBudget.length && marche > 0 ? formatXOF(marche - t.actualise) : "Non calculable"}</p>
          </div>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Dépenses engagées et payées, comparaison budget / réel : module financier (étape 4). Ici, budget initial (figé à la validation) et budget actualisé (révisions motivées).
      </p>

      {c.lignesBudget.length > 0 && (
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <section className="carte">
            <h2 className="mb-2">Par poste</h2>
            <GraphiqueBudget donnees={t.parPoste.map((p) => ({ libelle: POSTES_BUDGET[p.poste], initial: p.initial, actualise: p.actualise }))} />
          </section>
          <section className="carte overflow-x-auto">
            <h2 className="mb-2">Par lot</h2>
            <table className="tableau">
              <thead><tr><th>Lot</th><th className="text-right">Initial</th><th className="text-right">Actualisé</th><th className="text-right">Écart</th></tr></thead>
              <tbody>
                {t.parLot.map((l) => (
                  <tr key={l.lot}><td>{l.lot}</td><td className="whitespace-nowrap text-right">{formatXOF(l.initial)}</td><td className="whitespace-nowrap text-right">{formatXOF(l.actualise)}</td><td className={`whitespace-nowrap text-right ${l.actualise > l.initial ? "text-rose-700" : ""}`}>{formatXOF(l.actualise - l.initial)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <section className="carte">
        <h2 className="mb-3">Lignes budgétaires ({c.lignesBudget.length})</h2>
        {c.lignesBudget.length === 0 ? (
          <p className="mb-3 text-sm text-slate-500">
            Aucun budget détaillé.{" "}
            {c.devis.length > 0 ? <>Un devis accepté est rattaché : <Link className="lien" href={`/devis/${c.devis[0].id}`}>{c.devis[0].numero}</Link> — il peut initialiser le budget.</> : "Saisissez les lignes ci-dessous ou initialisez-le depuis un devis accepté."}
          </p>
        ) : (
          <div className="mb-4 overflow-x-auto">
            <table className="tableau">
              <thead><tr><th>Lot</th><th>Poste</th><th>Désignation</th><th className="text-right">Initial</th><th className="text-right">Actualisé</th><th>Commentaire</th><th></th></tr></thead>
              <tbody>
                {c.lignesBudget.map((l) => (
                  <tr key={l.id}>
                    <td>{l.lot}</td>
                    <td>{POSTES_BUDGET[l.poste]}</td>
                    <td>{l.designation}</td>
                    <td className="whitespace-nowrap text-right">{formatXOF(l.montantInitial)}</td>
                    <td className={`whitespace-nowrap text-right ${l.montantActualise !== null && Number(l.montantActualise) > Number(l.montantInitial) ? "text-rose-700" : ""}`}>{l.montantActualise !== null ? formatXOF(l.montantActualise) : "—"}</td>
                    <td className="max-w-xs text-xs text-slate-500">{l.commentaire}</td>
                    <td className="min-w-64">
                      {editable && (
                        <details>
                          <summary className="cursor-pointer text-xs text-ecorse-bleu-700">Modifier</summary>
                          <FormulaireAction action={modifierLigneBudget.bind(null, l.id)} className="mt-2 grid gap-2">
                            <Champ nom="lot" libelle="Lot" requis defaut={l.lot} list="lots-budget" />
                            <Selection nom="poste" libelle="Poste" requis options={Object.entries(POSTES_BUDGET)} defaut={l.poste} vide={false} />
                            <Champ nom="designation" libelle="Désignation" requis defaut={l.designation} />
                            <ChampMontant nom="montantInitial" libelle="Montant" requis defaut={l.montantInitial.toString()} />
                            <Champ nom="commentaire" libelle="Commentaire" defaut={l.commentaire} />
                          </FormulaireAction>
                          <FormulaireAction action={supprimerLigneBudget.bind(null, l.id)} libelle="Supprimer" classeBouton="btn-secondaire" confirmation="Supprimer cette ligne ?" className="mt-2" />
                        </details>
                      )}
                      {valide && peutModifier && (
                        <details>
                          <summary className="cursor-pointer text-xs text-ecorse-bleu-700">Réviser</summary>
                          <FormulaireAction action={modifierLigneBudget.bind(null, l.id)} libelle="Enregistrer la révision" className="mt-2 grid gap-2">
                            <ChampMontant nom="montantActualise" libelle="Nouveau montant actualisé" requis defaut={(l.montantActualise ?? l.montantInitial).toString()} />
                            <Champ nom="motif" libelle="Motif de la révision" requis />
                          </FormulaireAction>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="font-semibold"><td colSpan={3}>Total</td><td className="whitespace-nowrap text-right">{formatXOF(t.initial)}</td><td className="whitespace-nowrap text-right">{t.revise ? formatXOF(t.actualise) : "—"}</td><td colSpan={2}></td></tr>
              </tbody>
            </table>
          </div>
        )}
        <datalist id="lots-budget">{lots.map((l) => <option key={l} value={l} />)}</datalist>

        {peutCreer && c.budgetStatut !== "SOUMIS" && (
          <details className="rounded-lg border border-slate-200 p-3" open={c.lignesBudget.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">{valide ? "Ajouter un besoin (budget actualisé)" : "Ajouter une ligne"}</summary>
            <FormulaireAction action={ajouterLigneBudget.bind(null, c.id)} libelle="Ajouter" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Champ nom="lot" libelle="Lot" requis list="lots-budget" placeholder="ex. Gros œuvre" />
              <Selection nom="poste" libelle="Poste" requis options={Object.entries(POSTES_BUDGET)} />
              <Champ nom="designation" libelle="Désignation" requis />
              <ChampMontant nom="montant" libelle="Montant (F CFA)" requis />
              <Champ nom="commentaire" libelle={valide ? "Motif (obligatoire)" : "Commentaire"} requis={valide} />
            </FormulaireAction>
          </details>
        )}
      </section>

      <section className="carte mt-4">
        <h2 className="mb-3">Validation</h2>
        <dl className="mb-3 grid gap-3 sm:grid-cols-3">
          <Info libelle="Préparé par">{c.budgetPreparateur ? `${c.budgetPreparateur.prenom} ${c.budgetPreparateur.nom}` : null}</Info>
          <Info libelle="Validé par">{c.budgetValidateur ? `${c.budgetValidateur.prenom} ${c.budgetValidateur.nom}` : null}</Info>
          <Info libelle="Date de validation">{c.budgetDateValidation ? formatDateHeure(c.budgetDateValidation) : null}</Info>
        </dl>
        <div className="flex flex-wrap items-start gap-3">
          {c.budgetStatut === "BROUILLON" && peutModifier && <FormulaireAction action={soumettreBudget.bind(null, c.id)} libelle="Soumettre le budget à validation" className="space-y-2" />}
          {c.budgetStatut === "SOUMIS" && peutApprouver && c.budgetPreparePar !== user.id && (
            <>
              <FormulaireAction action={deciderBudget.bind(null, c.id, "VALIDE")} libelle="Valider le budget initial" confirmation={`Valider et figer le budget initial de ${formatXOF(t.initial)} ?`} className="space-y-2" />
              <FormulaireAction action={deciderBudget.bind(null, c.id, "RENVOI")} libelle="Renvoyer" classeBouton="btn-secondaire" className="flex flex-wrap items-start gap-2">
                <input name="motif" placeholder="Motif du renvoi" className="champ w-64" aria-label="Motif du renvoi" />
              </FormulaireAction>
            </>
          )}
          {c.budgetStatut === "SOUMIS" && c.budgetPreparePar === user.id && <p className="text-sm text-slate-500">En attente de validation par une autre personne habilitée.</p>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Une fois validé, le budget initial est figé. Les révisions modifient le budget actualisé, avec un motif inscrit dans l'historique du chantier.</p>
      </section>
    </>
  );
}
