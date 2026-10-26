import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { Champ, Selection } from "@/components/Champs";
import { ListeDocuments } from "@/components/Documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, Info } from "@/components/ui";
import { devisAccessible, filtreDevis } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { coefficientVente, montantLigne, prixUnitaireVente, totauxDevis } from "@/lib/devis-calculs";
import { formatDate, formatDateHeure, formatXOF } from "@/lib/format";
import { CATEGORIES_OUVRAGE, COULEUR_DEVIS, ORIGINES_LIGNE, REGIONS, STATUTS_DEVIS, TYPES_COMPOSANT, TYPES_PROJET, UNITES, UNITES_LONG } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import {
  ajouterLigne, ajouterSousDetail, deciderDevis, importerQuantites, marquerEnvoye, modifierEnTeteDevis, modifierLigne, nouvelleVariante,
  nouvelleVersion, reponseClient, soumettreDevis, supprimerDevis, supprimerLigne, supprimerSousDetail, transformerEnChantier, verifierLigne,
} from "../actions";
import { ChampsDevis } from "../ChampsDevis";
import { optionsDevis } from "../options";

export const metadata = { title: "Devis" };

const nb = (v: { toString(): string } | number, max = 3) => Number(v.toString()).toLocaleString("fr-SN", { maximumFractionDigits: max });
const nbSaisie = (v: { toString(): string } | null | undefined) => (v === null || v === undefined ? "" : Number(v.toString()).toString().replace(".", ","));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("fr-SN", { maximumFractionDigits: 1 })} %`);

export default async function PageDevisDetail({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("devis", "lire");
  const { id } = await params;
  if (!(await devisAccessible(user, id))) notFound();
  const d = await db.devis.findUniqueOrThrow({
    where: { id },
    include: {
      client: { select: { id: true, nom: true, prenom: true, code: true } },
      chantier: { select: { id: true, code: true, nom: true } },
      preparateur: { select: { prenom: true, nom: true } },
      validateur: { select: { prenom: true, nom: true } },
      lignes: { orderBy: { ordre: "asc" }, include: { sousDetail: { orderBy: { ordre: "asc" } }, verificateur: { select: { prenom: true, nom: true } } } },
    },
  });
  const voirCouts = peut(user.role, "devis_couts", "lire");
  const peutModifierDevis = peut(user.role, "devis", "modifier") && (await devisAccessible(user, id, "modifier"));
  const edition = d.statut === "BROUILLON" && peutModifierDevis;
  const t = totauxDevis(d.lignes, d);
  const K = coefficientVente(d);
  const [dossier, ouvrages, options] = await Promise.all([
    db.devis.findMany({ where: { AND: [{ numero: d.numero }, filtreDevis(user)!] }, select: { id: true, variante: true, version: true, statut: true, createdAt: true }, orderBy: [{ variante: "asc" }, { version: "asc" }] }),
    edition ? db.ouvrage.findMany({ where: { actif: true }, select: { id: true, code: true, designation: true, unite: true, categorie: true }, orderBy: [{ categorie: "asc" }, { code: "asc" }] }) : [],
    edition ? optionsDevis(user) : null,
  ]);
  const lots: { lot: string; lignes: typeof d.lignes }[] = [];
  for (const l of d.lignes) {
    const g = lots.find((x) => x.lot === l.lot);
    if (g) g.lignes.push(l);
    else lots.push({ lot: l.lot, lignes: [l] });
  }
  const nomsLots = [...new Set([...lots.map((x) => x.lot), ...Object.values(CATEGORIES_OUVRAGE)])];
  const peutApprouver = peut(user.role, "devis", "approuver") && (await devisAccessible(user, id, "approuver"));
  const nbCol = voirCouts ? 8 : 7;
  let numLigne = 0;

  return (
    <>
      <EnTetePage
        titre={`Devis ${d.numero}`}
        sousTitre={`Variante ${d.variante} · version ${d.version} · ${d.objet}`}
        actions={
          <>
            <span className={`badge ${COULEUR_DEVIS[d.statut]}`}>{STATUTS_DEVIS[d.statut]}</span>
            <a className="btn-secondaire" href={`/api/devis/${d.id}/pdf`} target="_blank" rel="noopener">PDF</a>
            <a className="btn-secondaire" href={`/api/devis/${d.id}/excel`}>Excel</a>
          </>
        }
      />

      {d.statut === "REMPLACE" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Cette version a été remplacée. Elle reste consultable mais ne doit plus être utilisée.
        </p>
      )}
      {d.motifDecision && (d.statut === "BROUILLON" || d.statut === "REFUSE") && (
        <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Motif : {d.motifDecision}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="carte lg:col-span-2">
          <h2 className="mb-3">Informations</h2>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Info libelle="Client">{peut(user.role, "intervenants", "lire") ? <Link className="lien" href={`/intervenants/${d.client.id}`}>{d.client.nom} {d.client.prenom}</Link> : `${d.client.nom} ${d.client.prenom ?? ""}`}</Info>
            <Info libelle="Chantier">{d.chantier ? <Link className="lien" href={`/chantiers/${d.chantier.id}`}>{d.chantier.code} · {d.chantier.nom}</Link> : "Nouveau projet"}</Info>
            <Info libelle="Type de projet">{d.typeProjet ? TYPES_PROJET[d.typeProjet] : null}</Info>
            <Info libelle="Lieu">{d.lieu}</Info>
            <Info libelle="Date">{formatDate(d.dateDevis)}</Info>
            <Info libelle="Validité">{formatDate(d.dateValidite)}</Info>
            <Info libelle="Délai d'exécution">{d.delaiExecutionJours ? `${d.delaiExecutionJours} jours` : null}</Info>
            <Info libelle="Préparé par">{`${d.preparateur.prenom} ${d.preparateur.nom}`}</Info>
            <Info libelle="Validation interne">{d.validateur ? `${d.validateur.prenom} ${d.validateur.nom}, ${formatDateHeure(d.dateDecision)}` : null}</Info>
          </dl>
          {d.conditions && <p className="mt-4 whitespace-pre-line text-sm text-slate-700"><span className="font-medium">Conditions : </span>{d.conditions}</p>}
          {voirCouts && d.notesInternes && <p className="mt-2 whitespace-pre-line text-sm text-slate-500"><span className="font-medium">Notes internes : </span>{d.notesInternes}</p>}
        </section>

        <section className="carte">
          <h2 className="mb-3">Montants</h2>
          <dl className="space-y-2 text-sm">
            {voirCouts && (
              <>
                <Ligne l="Déboursé sec" v={formatXOF(t.debourseSec)} />
                <Ligne l={`Frais de chantier (${nb(d.tauxFraisChantier)} %)`} v={formatXOF(t.fraisChantier)} />
                <Ligne l={`Frais généraux (${nb(d.tauxFraisGeneraux)} %)`} v={formatXOF(t.fraisGeneraux)} />
                <Ligne l="Coût de revient" v={formatXOF(t.coutRevient)} gras />
                <Ligne l={`Marge (cible ${nb(d.tauxMarge)} %)`} v={`${formatXOF(t.marge)} · ${pct(t.tauxMargeEffectif)}`} couleur={t.marge < 0 ? "text-rose-700" : "text-emerald-700"} />
                <p className="text-xs text-slate-500">Coefficient de vente K = {nb(K, 4)}. Marge = total HT − coût de revient.</p>
                <hr />
              </>
            )}
            <Ligne l="Total HT" v={formatXOF(t.totalHT)} gras />
            <Ligne l={`TVA (${nb(d.tauxTva)} %)`} v={formatXOF(t.tva)} />
            <Ligne l="Total TTC" v={formatXOF(t.totalTTC)} gras />
          </dl>
        </section>
      </div>

      <section className="carte mt-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2>Détail quantitatif et estimatif ({d.lignes.length} ligne{d.lignes.length > 1 ? "s" : ""})</h2>
          {t.lignesNonVerifiees > 0 && <span className="badge bg-amber-100 text-amber-800">{t.lignesNonVerifiees} quantité(s) importée(s) à vérifier</span>}
        </div>
        {d.lignes.length === 0 ? (
          <p className="mb-3 text-sm text-slate-500">Aucune ligne. Ajoutez des ouvrages depuis la bibliothèque, saisissez-les ou importez un tableau de quantités.</p>
        ) : (
          <div className="mb-4 overflow-x-auto">
            <table className="tableau">
              <thead>
                <tr>
                  <th>N°</th><th>Désignation</th><th>U</th><th className="text-right">Quantité</th>
                  {voirCouts && <th className="text-right">DS unitaire</th>}
                  <th className="text-right">PU HT</th><th className="text-right">Montant HT</th><th></th>
                </tr>
              </thead>
              <tbody>
                {lots.map((g) => (
                  <LotRows key={g.lot} lot={g.lot} nbCol={nbCol} total={g.lignes.reduce((s, l) => s + montantLigne(l, d), 0)}>
                    {g.lignes.map((l) => {
                      numLigne++;
                      return (
                        <Fragment key={l.id}>
                          <tr>
                            <td>{numLigne}</td>
                            <td className="min-w-56">
                              {l.designation}
                              <span className="ml-1 text-xs text-slate-400">{ORIGINES_LIGNE[l.origine]}</span>
                              {!l.verifiee && <span className="badge ml-1 bg-amber-100 text-amber-800">à vérifier</span>}
                              {l.verificateur && l.origine === "IMPORT" && <span className="block text-xs text-slate-400">Vérifiée par {l.verificateur.prenom} {l.verificateur.nom}</span>}
                            </td>
                            <td>{UNITES[l.unite]}</td>
                            <td className="text-right">{nb(l.quantite)}</td>
                            {voirCouts && <td className="whitespace-nowrap text-right">{formatXOF(l.debourseSecUnitaire)}{l.sousDetail.length > 0 && <span className="block text-xs text-slate-400">sous-détail ({l.sousDetail.length})</span>}</td>}
                            <td className="whitespace-nowrap text-right">{formatXOF(prixUnitaireVente(l, d))}{l.prixUnitaireImpose !== null && <span className="block text-xs text-slate-400">imposé</span>}</td>
                            <td className="whitespace-nowrap text-right">{formatXOF(montantLigne(l, d))}</td>
                            <td className="whitespace-nowrap">
                              {edition && !l.verifiee && <FormulaireAction action={verifierLigne.bind(null, l.id)} libelle="Quantité vérifiée" classeBouton="btn-secondaire" className="space-y-1" />}
                            </td>
                          </tr>
                          {edition && (
                            <tr>
                              <td colSpan={nbCol} className="bg-slate-50/60">
                                <div className="flex flex-wrap gap-3">
                                  <details className="flex-1">
                                    <summary className="cursor-pointer text-xs font-medium text-ecorse-bleu-700">Modifier la ligne {numLigne}</summary>
                                    <FormulaireAction action={modifierLigne.bind(null, l.id)} className="mt-2 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                      <Champ nom="lot" libelle="Lot" requis defaut={l.lot} list="lots-devis" />
                                      <Champ nom="designation" libelle="Désignation" requis defaut={l.designation} className="sm:col-span-2" />
                                      <Selection nom="unite" libelle="Unité" requis options={Object.entries(UNITES_LONG)} defaut={l.unite} vide={false} />
                                      <Champ nom="quantite" libelle="Quantité" requis inputMode="decimal" defaut={nbSaisie(l.quantite)} />
                                      {voirCouts && l.sousDetail.length === 0 && <Champ nom="debourseSecUnitaire" libelle="DS unitaire" inputMode="decimal" defaut={nbSaisie(l.debourseSecUnitaire)} />}
                                      <Champ nom="prixUnitaireImpose" libelle="PU imposé (facultatif)" inputMode="decimal" defaut={nbSaisie(l.prixUnitaireImpose)} />
                                    </FormulaireAction>
                                  </details>
                                  {voirCouts && (
                                    <details className="flex-1">
                                      <summary className="cursor-pointer text-xs font-medium text-ecorse-bleu-700">Sous-détail de prix ({l.sousDetail.length})</summary>
                                      <div className="mt-2 space-y-2">
                                        {l.sousDetail.length > 0 && (
                                          <table className="tableau">
                                            <thead><tr><th>Nature</th><th>Désignation</th><th>U</th><th className="text-right">Qté / u</th><th className="text-right">PU</th><th className="text-right">Montant</th><th></th></tr></thead>
                                            <tbody>
                                              {l.sousDetail.map((c) => (
                                                <tr key={c.id}>
                                                  <td>{TYPES_COMPOSANT[c.type]}</td><td>{c.designation}</td><td>{UNITES[c.unite]}</td>
                                                  <td className="text-right">{nb(c.quantite, 4)}</td>
                                                  <td className="whitespace-nowrap text-right">{formatXOF(c.prixUnitaire)}</td>
                                                  <td className="whitespace-nowrap text-right">{formatXOF(Number(c.quantite) * Number(c.prixUnitaire))}</td>
                                                  <td><FormulaireAction action={supprimerSousDetail.bind(null, c.id)} libelle="Retirer" classeBouton="btn-secondaire" className="space-y-1" /></td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        )}
                                        <FormulaireAction action={ajouterSousDetail.bind(null, l.id)} libelle="Ajouter au sous-détail" classeBouton="btn-secondaire" className="grid gap-2 sm:grid-cols-3">
                                          <Selection nom="type" libelle="Nature" requis options={Object.entries(TYPES_COMPOSANT)} />
                                          <Champ nom="designation" libelle="Désignation" requis />
                                          <Selection nom="unite" libelle="Unité" requis options={Object.entries(UNITES_LONG)} />
                                          <Champ nom="quantite" libelle="Quantité pour 1 unité" requis inputMode="decimal" />
                                          <Champ nom="prixUnitaire" libelle="Prix unitaire" requis inputMode="decimal" />
                                        </FormulaireAction>
                                      </div>
                                    </details>
                                  )}
                                  <FormulaireAction action={supprimerLigne.bind(null, l.id)} libelle="Supprimer" classeBouton="btn-secondaire" confirmation="Supprimer cette ligne ?" className="space-y-1" />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </LotRows>
                ))}
                <tr className="font-semibold"><td colSpan={nbCol - 2}>Total HT</td><td className="whitespace-nowrap text-right">{formatXOF(t.totalHT)}</td><td></td></tr>
              </tbody>
            </table>
          </div>
        )}
        <datalist id="lots-devis">{nomsLots.map((n) => <option key={n} value={n} />)}</datalist>

        {edition && (
          <div className="grid gap-3 lg:grid-cols-2">
            <details className="rounded-lg border border-slate-200 p-3" open={d.lignes.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">Ajouter une ligne</summary>
              <FormulaireAction action={ajouterLigne.bind(null, d.id)} libelle="Ajouter la ligne" className="mt-3 grid gap-3 sm:grid-cols-2">
                <Champ nom="lot" libelle="Lot" requis list="lots-devis" placeholder="ex. Gros œuvre" />
                <div>
                  <label htmlFor="ouvrageId" className="etiquette">Ouvrage de la bibliothèque</label>
                  <select id="ouvrageId" name="ouvrageId" className="champ" defaultValue="">
                    <option value="">— Ligne libre —</option>
                    {ouvrages.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.designation} ({UNITES[o.unite]})</option>)}
                  </select>
                </div>
                <Champ nom="designation" libelle="Désignation" className="sm:col-span-2" aide="Obligatoire pour une ligne libre ; sinon celle de l'ouvrage." />
                <Selection nom="unite" libelle="Unité (ligne libre)" options={Object.entries(UNITES_LONG)} />
                <Champ nom="quantite" libelle="Quantité" requis inputMode="decimal" />
                {voirCouts && <Champ nom="debourseSecUnitaire" libelle="Déboursé sec unitaire" inputMode="decimal" aide="Ignoré si l'ouvrage a un sous-détail." />}
                <Champ nom="prixUnitaireImpose" libelle="Prix unitaire imposé (facultatif)" inputMode="decimal" aide="Bordereau du client ; sinon DS × K." />
              </FormulaireAction>
            </details>
            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">Importer un tableau de quantités (CSV ou Excel)</summary>
              <p className="mt-2 text-xs text-slate-500">
                Colonnes reconnues : Lot, Désignation, Unité, Quantité, et facultativement Déboursé sec unitaire, Prix unitaire.
                Une ligne avec une désignation sans unité ni quantité est lue comme un titre de lot.
                Chaque quantité importée devra être vérifiée par une personne avant la soumission du devis.
              </p>
              <FormulaireAction action={importerQuantites.bind(null, d.id)} libelle="Importer" className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="fichier-import" className="etiquette">Fichier <span className="text-rose-600">*</span></label>
                  <input id="fichier-import" name="fichier" type="file" required accept=".csv,.txt,.xlsx" className="champ" />
                </div>
                <Champ nom="lotDefaut" libelle="Lot par défaut" placeholder="Lot unique" list="lots-devis" />
              </FormulaireAction>
            </details>
          </div>
        )}
      </section>

      <section className="carte mt-4">
        <h2 className="mb-3">Circuit de validation</h2>
        <div className="flex flex-wrap items-start gap-3">
          {edition && <FormulaireAction action={soumettreDevis.bind(null, d.id)} libelle="Soumettre à validation interne" className="space-y-2" />}
          {d.statut === "SOUMIS" && peutApprouver && d.preparePar !== user.id && (
            <>
              <FormulaireAction action={deciderDevis.bind(null, d.id, "VALIDE")} libelle="Valider le devis" confirmation={`Valider le devis pour ${formatXOF(t.totalHT)} HT ?`} className="space-y-2" />
              <FormulaireAction action={deciderDevis.bind(null, d.id, "RENVOI")} libelle="Renvoyer pour correction" classeBouton="btn-secondaire" className="flex flex-wrap items-start gap-2">
                <input name="motif" placeholder="Motif du renvoi" className="champ w-64" aria-label="Motif du renvoi" />
              </FormulaireAction>
            </>
          )}
          {d.statut === "SOUMIS" && d.preparePar === user.id && <p className="text-sm text-slate-500">En attente de validation par une autre personne habilitée.</p>}
          {d.statut === "SOUMIS" && !peutApprouver && d.preparePar !== user.id && <p className="text-sm text-slate-500">En attente de validation.</p>}
          {d.statut === "VALIDE" && peutModifierDevis && <FormulaireAction action={marquerEnvoye.bind(null, d.id)} libelle="Marquer comme envoyé au client" className="space-y-2" />}
          {d.statut === "ENVOYE" && peutModifierDevis && (
            <>
              <FormulaireAction action={reponseClient.bind(null, d.id, "ACCEPTE")} libelle="Le client a accepté" confirmation="Enregistrer l'acceptation du client ?" className="space-y-2" />
              <FormulaireAction action={reponseClient.bind(null, d.id, "REFUSE")} libelle="Le client a refusé" classeBouton="btn-secondaire" className="flex flex-wrap items-start gap-2">
                <input name="motif" placeholder="Motif (facultatif)" className="champ w-64" aria-label="Motif du refus" />
              </FormulaireAction>
            </>
          )}
          {peut(user.role, "devis", "creer") && ["VALIDE", "ENVOYE", "REFUSE"].includes(d.statut) && (
            <FormulaireAction action={nouvelleVersion.bind(null, d.id)} libelle="Créer une nouvelle version" classeBouton="btn-secondaire" confirmation="Cette version sera marquée comme remplacée. Continuer ?" className="space-y-2" />
          )}
          {peut(user.role, "devis", "creer") && d.statut !== "REMPLACE" && (
            <FormulaireAction action={nouvelleVariante.bind(null, d.id)} libelle="Créer une variante" classeBouton="btn-secondaire" className="space-y-2" />
          )}
          {edition && d.version === 1 && (
            <FormulaireAction action={supprimerDevis.bind(null, d.id)} libelle="Supprimer le brouillon" classeBouton="btn-danger" confirmation="Supprimer définitivement ce brouillon ?" className="space-y-2" />
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Brouillon → soumis → validé en interne (par une autre personne que le préparateur) → envoyé → accepté ou refusé.
          Un devis accepté peut être transformé en chantier : ses lignes, quantités, prix, conditions et documents sont conservés.
        </p>
      </section>

      {d.statut === "ACCEPTE" && (
        <section className="carte mt-4 border-ecorse-vert-500">
          <h2 className="mb-2">Transformation en chantier</h2>
          {!d.chantier && peut(user.role, "chantiers", "creer") && (
            <FormulaireAction action={transformerEnChantier.bind(null, d.id)} libelle="Créer le chantier" confirmation="Créer le chantier à partir de ce devis ?" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Champ nom="nom" libelle="Nom du chantier" requis defaut={d.objet} className="lg:col-span-2" />
              <Selection nom="typeProjet" libelle="Type de projet" requis options={Object.entries(TYPES_PROJET)} defaut={d.typeProjet} />
              <Champ nom="ville" libelle="Ville" />
              <Selection nom="region" libelle="Région" options={Object.entries(REGIONS)} />
              <Champ nom="dateDemarrage" libelle="Date de démarrage" type="date" />
              <Champ nom="dateFinContractuelle" libelle="Date contractuelle de fin" type="date" aide={d.delaiExecutionJours ? `Laisser vide : démarrage + ${d.delaiExecutionJours} jours.` : undefined} />
              <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-3">
                Marché : {formatXOF(t.totalHT)} HT. {voirCouts && `Budget initial (coût de revient) : ${formatXOF(t.coutRevient)}, réparti par lot et par nature. `}
                Le devis reste rattaché au chantier.
              </p>
            </FormulaireAction>
          )}
          {!d.chantier && !peut(user.role, "chantiers", "creer") && <p className="text-sm text-slate-500">La création du chantier est réservée à la direction.</p>}
          {d.chantier && peut(user.role, "budgets", "creer") && (
            <FormulaireAction action={transformerEnChantier.bind(null, d.id)} libelle="Initialiser le budget du chantier depuis ce devis" className="space-y-2" />
          )}
          {d.chantier && <p className="mt-2 text-sm">Chantier : <Link className="lien" href={`/chantiers/${d.chantier.id}`}>{d.chantier.code} · {d.chantier.nom}</Link></p>}
        </section>
      )}

      {edition && options && (
        <section className="carte mt-4">
          <details>
            <summary className="cursor-pointer font-semibold text-ecorse-bleu-900">Modifier l'en-tête et les coefficients</summary>
            <FormulaireAction action={modifierEnTeteDevis.bind(null, d.id)} className="mt-3 space-y-4">
              <ChampsDevis d={d} clients={options.clients} chantiers={options.chantiers} voirCouts={voirCouts} />
            </FormulaireAction>
          </details>
        </section>
      )}

      <section className="carte mt-4">
        <h2 className="mb-3">Variantes et versions du dossier {d.numero}</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {dossier.map((v) => (
            <li key={v.id}>
              <Link href={`/devis/${v.id}`} className={`badge ${v.id === d.id ? "bg-ecorse-bleu-600 text-white" : COULEUR_DEVIS[v.statut]}`}>
                Variante {v.variante} · v{v.version} · {STATUTS_DEVIS[v.statut]}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <ListeDocuments
        user={user}
        titre="Plans et documents du dossier"
        where={{ devis: { numero: d.numero } }}
        cible={{ devisId: d.id, chantierId: d.chantier?.id ?? null }}
        peutDeposer={peutModifierDevis && peut(user.role, "documents", "creer")}
        categorieDefaut="PLAN"
      />
    </>
  );
}

function Ligne({ l, v, gras, couleur }: { l: string; v: string; gras?: boolean; couleur?: string }) {
  return (
    <div className={`flex justify-between gap-3 ${gras ? "font-semibold" : ""}`}>
      <dt className="text-slate-600">{l}</dt>
      <dd className={`text-right ${couleur ?? ""}`}>{v}</dd>
    </div>
  );
}

function LotRows({ lot, total, nbCol, children }: { lot: string; total: number; nbCol: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-ecorse-bleu-50"><td colSpan={nbCol} className="font-semibold text-ecorse-bleu-900">{lot}</td></tr>
      {children}
      <tr className="text-sm"><td colSpan={nbCol - 2} className="text-right text-slate-500">Sous-total {lot}</td><td className="whitespace-nowrap text-right font-medium">{formatXOF(total)}</td><td></td></tr>
    </>
  );
}

