import Link from "next/link";
import { notFound } from "next/navigation";
import { Champ, CaseACocher, ZoneTexte } from "@/components/Champs";
import { ChampFichier } from "@/components/ChampFichier";
import { versionCourante } from "@/components/Documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, Info } from "@/components/ui";
import { documentAccessible } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { aujourdhuiDakar, formatDate, formatDateHeure, toInputDate } from "@/lib/format";
import { CATEGORIES_A_APPROUVER, CATEGORIES_DOCUMENT, COULEUR_VERSION, ROLES, ROLES_EXTERNES, STATUTS_VERSION } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { TAILLE_MAX_MO } from "@/lib/stockage";
import { deciderVersion, deposerVersion, modifierDocument } from "../actions";

export const metadata = { title: "Document" };

const taille = (o: number) => (o > 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(o / 1024)} Ko`);

export default async function PageDocument({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("documents", "lire");
  if (user.externe) notFound(); // le portail n'accède qu'aux fichiers en vigueur, pas à l'historique
  const { id } = await params;
  const d = await db.document.findUnique({
    where: { id },
    include: {
      chantier: { select: { id: true, code: true, nom: true } },
      devis: { select: { id: true, numero: true } },
      rapport: { select: { id: true, date: true } },
      createur: { select: { prenom: true, nom: true } },
      versions: {
        orderBy: { numero: "desc" },
        select: {
          id: true, numero: true, indice: true, statut: true, nomFichier: true, taille: true, empreinte: true, commentaire: true, deposePar: true,
          deposeLe: true, decideLe: true, motif: true, remplaceLe: true, mime: true,
          deposant: { select: { prenom: true, nom: true } }, decideur: { select: { prenom: true, nom: true } },
        },
      },
    },
  });
  if (!d || !(await documentAccessible(user, d, "lire"))) notFound();
  const peutModifier = peut(user.role, "documents", "modifier") && (await documentAccessible(user, d, "modifier"));
  const peutApprouver = peut(user.role, "documents", "approuver") && (await documentAccessible(user, d, "approuver"));
  const cour = versionCourante(d.versions);
  const expire = d.dateValidite && d.dateValidite < aujourdhuiDakar();

  return (
    <>
      <EnTetePage titre={d.titre} sousTitre={`${CATEGORIES_DOCUMENT[d.categorie]}${d.reference ? ` · ${d.reference}` : ""}${d.archive ? " · archivé" : ""}`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`carte lg:col-span-2 ${cour ? "border-emerald-300" : "border-amber-300"}`}>
          <h2 className="mb-2">Version en vigueur</h2>
          {cour ? (
            <p className="text-sm">
              <a className="btn-primaire" href={`/api/fichiers/${cour.id}`} target="_blank" rel="noopener">
                Ouvrir {cour.indice ? `l'indice ${cour.indice}` : `la version ${cour.numero}`}
              </a>
              <span className="ml-2 text-slate-500">{cour.nomFichier} · {taille(cour.taille)}</span>
            </p>
          ) : (
            <p className="text-sm text-amber-800">Aucune version n'est en vigueur{CATEGORIES_A_APPROUVER.includes(d.categorie) ? " : la version déposée attend une approbation." : "."}</p>
          )}
          {expire && <p className="mt-2 text-sm font-medium text-rose-700">Date de validité dépassée ({formatDate(d.dateValidite)}).</p>}
        </section>
        <section className="carte">
          <dl className="space-y-2">
            <Info libelle="Rattachement">
              {d.chantier ? <Link className="lien" href={`/chantiers/${d.chantier.id}`}>{d.chantier.code} · {d.chantier.nom}</Link> : d.devis ? <Link className="lien" href={`/devis/${d.devis.id}`}>Devis {d.devis.numero}</Link> : "Entreprise"}
              {d.rapport && <> · <Link className="lien" href={`/rapports/${d.rapport.id}`}>rapport du {formatDate(d.rapport.date)}</Link></>}
            </Info>
            <Info libelle="Lot">{d.lot}</Info>
            <Info libelle="Validité">{d.dateValidite ? formatDate(d.dateValidite) : null}</Info>
            <Info libelle="Partagé sur le portail avec">{d.partageExterne.length ? d.partageExterne.map((r) => ROLES[r].replace(" (portail)", "")).join(", ") : "Personne"}</Info>
            <Info libelle="Créé par">{`${d.createur.prenom} ${d.createur.nom}`}</Info>
          </dl>
        </section>
      </div>

      <section className="carte mt-4">
        <h2 className="mb-3">Historique des versions</h2>
        <div className="overflow-x-auto">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Indice</th><th>Statut</th><th>Fichier</th><th>Déposé</th><th>Décision</th><th></th></tr></thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id} className={v.statut === "REMPLACE" || v.statut === "REJETE" ? "text-slate-500" : ""}>
                  <td>{v.numero}</td>
                  <td>{v.indice ?? "—"}</td>
                  <td>
                    <span className={`badge ${COULEUR_VERSION[v.statut]}`}>{STATUTS_VERSION[v.statut]}</span>
                    {v.remplaceLe && <span className="block text-xs">le {formatDate(v.remplaceLe)}</span>}
                  </td>
                  <td>
                    <a className="lien" href={`/api/fichiers/${v.id}`} target="_blank" rel="noopener">{v.nomFichier}</a>
                    <span className="block text-xs text-slate-400">{taille(v.taille)} · SHA-256 {v.empreinte.slice(0, 12)}…</span>
                    {v.commentaire && <span className="block text-xs">{v.commentaire}</span>}
                  </td>
                  <td className="whitespace-nowrap text-xs">{v.deposant.prenom} {v.deposant.nom}<br />{formatDateHeure(v.deposeLe)}</td>
                  <td className="text-xs">{v.decideur ? <>{v.decideur.prenom} {v.decideur.nom}<br />{formatDateHeure(v.decideLe)}</> : "—"}{v.motif && <span className="block">{v.motif}</span>}</td>
                  <td className="min-w-48">
                    {v.statut === "EN_ATTENTE" && peutApprouver && v.deposePar !== user.id && (
                      <div className="space-y-2">
                        <FormulaireAction action={deciderVersion.bind(null, v.id, "APPROUVE")} libelle="Approuver" confirmation="Approuver cette version ? La version en vigueur sera marquée remplacée." className="space-y-1" />
                        <FormulaireAction action={deciderVersion.bind(null, v.id, "REJETE")} libelle="Rejeter" classeBouton="btn-secondaire" className="space-y-1">
                          <input name="motif" placeholder="Motif du rejet" className="champ" aria-label="Motif du rejet" />
                        </FormulaireAction>
                      </div>
                    )}
                    {v.statut === "EN_ATTENTE" && v.deposePar === user.id && <span className="text-xs text-slate-500">En attente d'une autre personne habilitée</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Une version remplacée reste consultable ; ses PDF portent le tampon « version remplacée — ne pas utiliser » sur chaque page.
          Le portail ne donne accès qu'à la version en vigueur.
        </p>
      </section>

      {peutModifier && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section className="carte">
            <h2 className="mb-3">Déposer une nouvelle version</h2>
            <FormulaireAction action={deposerVersion.bind(null, d.id)} libelle="Déposer la version" className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><ChampFichier nom="fichier" libelle="Fichier" requis aide={`${TAILLE_MAX_MO} Mo maximum.`} /></div>
              <Champ nom="indice" libelle="Indice" />
              <Champ nom="commentaire" libelle="Commentaire (nature des modifications)" />
            </FormulaireAction>
          </section>
          <section className="carte">
            <h2 className="mb-3">Informations et partage</h2>
            <FormulaireAction action={modifierDocument.bind(null, d.id)} className="grid gap-3 sm:grid-cols-2">
              <Champ nom="titre" libelle="Titre" requis defaut={d.titre} className="sm:col-span-2" />
              <Champ nom="reference" libelle="Référence" defaut={d.reference} />
              <Champ nom="lot" libelle="Lot" defaut={d.lot} />
              <Champ nom="dateValidite" libelle="Valable jusqu'au" type="date" defaut={toInputDate(d.dateValidite)} />
              <ZoneTexte nom="description" libelle="Description" defaut={d.description} className="sm:col-span-2" lignes={2} />
              {d.chantierId && (
                <fieldset className="sm:col-span-2">
                  <legend className="etiquette">Partagé sur le portail avec</legend>
                  <div className="flex flex-wrap gap-3">
                    {ROLES_EXTERNES.map((r) => (
                      <label key={r} className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name="partageExterne" value={r} defaultChecked={d.partageExterne.includes(r)} /> {ROLES[r].replace(" (portail)", "")}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <CaseACocher nom="archive" libelle="Archiver (masquer des listes)" defaut={d.archive} />
            </FormulaireAction>
          </section>
        </div>
      )}
    </>
  );
}
