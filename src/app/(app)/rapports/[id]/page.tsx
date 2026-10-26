import Link from "next/link";
import { notFound } from "next/navigation";
import { Photos } from "@/components/Documents";
import { FormulaireAction } from "@/components/FormulaireAction";
import { EnTetePage, Info } from "@/components/ui";
import { chantierAccessible } from "@/lib/acces";
import { exigerPermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDate, formatDateHeure } from "@/lib/format";
import { COULEUR_RAPPORT, METEOS, STATUTS_RAPPORT, UNITES } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { ETATS_MATERIEL, type LigneMateriau, type LigneMateriel, type LignePersonnel, type LigneTravaux } from "@/lib/rapports";
import { deciderRapport, soumettreRapport } from "../actions";

export const metadata = { title: "Rapport journalier" };

const nb = (v: number | null) => (v === null ? "—" : v.toLocaleString("fr-SN", { maximumFractionDigits: 3 }));

export default async function PageRapport({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await exigerPermission("rapports", "lire");
  const { id } = await params;
  const r = await db.rapportJournalier.findUnique({
    where: { id },
    include: {
      chantier: { select: { id: true, code: true, nom: true } },
      redacteur: { select: { prenom: true, nom: true } },
      validateur: { select: { prenom: true, nom: true } },
    },
  });
  if (!r || !(await chantierAccessible(user, r.chantierId, "lire", "rapports"))) notFound();
  const peutModifier = peut(user.role, "rapports", "modifier") && (await chantierAccessible(user, r.chantierId, "modifier", "rapports"));
  const peutValider = peut(user.role, "rapports", "approuver") && (await chantierAccessible(user, r.chantierId, "approuver", "rapports"));
  const personnel = r.personnel as LignePersonnel[];
  const travaux = r.travaux as LigneTravaux[];
  const taches = travaux.some((t) => t.tacheId) ? await db.tachePlanning.findMany({ where: { id: { in: travaux.map((t) => t.tacheId).filter((x): x is string => !!x) } }, select: { id: true, nom: true } }) : [];
  const peutPhotos = r.statut !== "VALIDE" && peut(user.role, "documents", "creer") && (await chantierAccessible(user, r.chantierId, "creer", "documents"));

  return (
    <>
      <EnTetePage
        titre={`Rapport du ${formatDate(r.date)}`}
        sousTitre={`${r.chantier.code} · ${r.chantier.nom}`}
        actions={
          <>
            <span className={`badge ${COULEUR_RAPPORT[r.statut]}`}>{STATUTS_RAPPORT[r.statut]}</span>
            <a className="btn-secondaire" href={`/api/rapports/${r.id}/pdf`} target="_blank" rel="noopener">PDF</a>
            {r.statut === "BROUILLON" && peutModifier && <Link className="btn-secondaire" href={`/rapports/${r.id}/modifier`}>Modifier</Link>}
          </>
        }
      />
      {r.motifRenvoi && r.statut === "BROUILLON" && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Renvoyé pour correction : {r.motifRenvoi}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="carte lg:col-span-2">
          <dl className="grid gap-3 sm:grid-cols-3">
            <Info libelle="Chantier"><Link className="lien" href={`/chantiers/${r.chantier.id}`}>{r.chantier.code}</Link></Info>
            <Info libelle="Responsable">{`${r.redacteur.prenom} ${r.redacteur.nom}`}</Info>
            <Info libelle="Météo">{r.meteo ? `${METEOS[r.meteo]}${r.meteoDetails ? ` · ${r.meteoDetails}` : ""}` : null}</Info>
            <Info libelle="Effectif présent">{`${r.effectifTotal} personne(s)`}</Info>
            <Info libelle="Heures travaillées">{`${nb(Number(r.heuresTravaillees))} h`}</Info>
            <Info libelle="Soumis le">{r.soumisLe ? formatDateHeure(r.soumisLe) : null}</Info>
          </dl>
        </section>
        <section className="carte">
          <h2 className="mb-2">Validation</h2>
          {r.statut === "VALIDE" ? (
            <p className="text-sm">
              Validé par <strong>{r.validateur?.prenom} {r.validateur?.nom}</strong> le {formatDateHeure(r.valideLe)}.
              <span className="mt-1 block break-all text-xs text-slate-500">Empreinte SHA-256 : {r.empreinteValidation}</span>
            </p>
          ) : (
            <div className="space-y-2">
              {r.statut === "BROUILLON" && peutModifier && <FormulaireAction action={soumettreRapport.bind(null, r.id)} libelle="Soumettre à validation" className="space-y-2" />}
              {r.statut === "SOUMIS" && peutValider && r.redacteurId !== user.id && (
                <>
                  <FormulaireAction action={deciderRapport.bind(null, r.id, "VALIDE")} libelle="Valider le rapport" confirmation="Valider ce rapport ? Il ne pourra plus être modifié." className="space-y-2" />
                  <FormulaireAction action={deciderRapport.bind(null, r.id, "RENVOI")} libelle="Renvoyer pour correction" classeBouton="btn-secondaire" className="space-y-2">
                    <input name="motif" placeholder="Motif du renvoi" className="champ" aria-label="Motif du renvoi" />
                  </FormulaireAction>
                </>
              )}
              {r.statut === "SOUMIS" && r.redacteurId === user.id && <p className="text-sm text-slate-500">En attente de validation par le conducteur de travaux ou un autre responsable habilité.</p>}
              <p className="text-xs text-slate-500">La validation électronique enregistre le nom, l'heure et une empreinte du contenu ; le rapport devient non modifiable.</p>
            </div>
          )}
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Bloc titre="Personnel par spécialité" vide={!personnel.length}>
          <table className="tableau"><thead><tr><th>Spécialité</th><th className="text-right">Nombre</th><th className="text-right">Heures / pers.</th></tr></thead>
            <tbody>{personnel.map((p, i) => <tr key={i}><td>{p.specialite}</td><td className="text-right">{p.nombre}</td><td className="text-right">{nb(p.heures)}</td></tr>)}</tbody></table>
        </Bloc>
        <Bloc titre="Quantités exécutées" vide={!travaux.length}>
          <table className="tableau"><thead><tr><th>Ouvrage</th><th>U</th><th className="text-right">Qté</th><th>Tâche</th></tr></thead>
            <tbody>{travaux.map((t, i) => <tr key={i}><td>{t.designation}</td><td>{t.unite ? UNITES[t.unite] : ""}</td><td className="text-right">{nb(t.quantite)}</td><td className="text-xs">{t.tacheId ? `${taches.find((x) => x.id === t.tacheId)?.nom ?? "?"}${t.avancement !== null ? ` → ${t.avancement} %` : ""}` : "—"}</td></tr>)}</tbody></table>
        </Bloc>
        <Bloc titre="Matériaux consommés" vide={!(r.materiauxConsommes as LigneMateriau[]).length}>
          <TableMat l={r.materiauxConsommes as LigneMateriau[]} />
        </Bloc>
        <Bloc titre="Matériaux livrés" vide={!(r.materiauxLivres as LigneMateriau[]).length}>
          <TableMat l={r.materiauxLivres as LigneMateriau[]} fournisseur />
        </Bloc>
        <Bloc titre="Matériel et engins" vide={!(r.materiel as LigneMateriel[]).length}>
          <table className="tableau"><thead><tr><th>Matériel</th><th className="text-right">Heures</th><th>État</th></tr></thead>
            <tbody>{(r.materiel as LigneMateriel[]).map((m, i) => <tr key={i}><td>{m.designation}</td><td className="text-right">{nb(m.heures)}</td><td className={m.etat === "EN_PANNE" ? "text-rose-700" : ""}>{ETATS_MATERIEL[m.etat]}</td></tr>)}</tbody></table>
        </Bloc>
        <section className="carte space-y-3 text-sm">
          {([["Travaux réalisés", r.travauxRealises], ["Incidents", r.incidents], ["Difficultés", r.difficultes], ["Instructions", r.instructions], ["Observations", r.observations]] as const).map(([t, v]) => (
            <div key={t}><h3 className={`font-semibold ${t === "Incidents" && v ? "text-rose-700" : "text-ecorse-bleu-900"}`}>{t}</h3><p className="whitespace-pre-line text-slate-700">{v || "—"}</p></div>
          ))}
        </section>
      </div>

      <Photos user={user} where={{ rapportId: r.id }} cible={{ chantierId: r.chantierId, rapportId: r.id }} peutDeposer={peutPhotos} titre="Photos du jour" />
    </>
  );
}

function Bloc({ titre, vide, children }: { titre: string; vide: boolean; children: React.ReactNode }) {
  return (
    <section className="carte overflow-x-auto">
      <h2 className="mb-2">{titre}</h2>
      {vide ? <p className="text-sm text-slate-500">Rien de saisi.</p> : children}
    </section>
  );
}

function TableMat({ l, fournisseur }: { l: LigneMateriau[]; fournisseur?: boolean }) {
  return (
    <table className="tableau"><thead><tr><th>Matériau</th><th>U</th><th className="text-right">Qté</th>{fournisseur && <th>Fournisseur</th>}</tr></thead>
      <tbody>{l.map((m, i) => <tr key={i}><td>{m.designation}</td><td>{UNITES[m.unite]}</td><td className="text-right">{nb(m.quantite)}</td>{fournisseur && <td>{m.fournisseur ?? ""}</td>}</tr>)}</tbody></table>
  );
}
