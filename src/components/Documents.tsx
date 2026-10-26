import type { CategorieDocument, Prisma } from "@prisma/client";
import Link from "next/link";
import { deposerPhotos, creerDocument } from "@/app/(app)/documents/actions";
import type { UtilisateurConnecte } from "@/lib/auth";
import { db } from "@/lib/db";
import { aujourdhuiDakar, formatDate, formatDateHeure } from "@/lib/format";
import { CATEGORIES_DOCUMENT, CATEGORIES_A_APPROUVER, COULEUR_VERSION, ROLES, ROLES_EXTERNES, STATUTS_VERSION, VERSION_EN_VIGUEUR } from "@/lib/libelles";
import { TAILLE_MAX_MO } from "@/lib/stockage";
import { FORMATS_ACCEPTES } from "@/lib/types-fichiers";
import { Champ, Selection } from "./Champs";
import { ChampFichier } from "./ChampFichier";
import { FormulaireAction } from "./FormulaireAction";

type Cible = { chantierId?: string | null; devisId?: string | null; rapportId?: string | null };

export function versionCourante<V extends { statut: string }>(versions: V[]): V | null {
  return versions.find((v) => VERSION_EN_VIGUEUR.includes(v.statut as never)) ?? null;
}

/** Champs communs du dépôt de document (chantier/devis/rapport passés en champs cachés). */
export function ChampsDepot({ cible, categorieDefaut, partage, rediriger }: { cible: Cible; categorieDefaut?: CategorieDocument; partage: boolean; rediriger?: boolean }) {
  return (
    <>
      {cible.chantierId && <input type="hidden" name="chantierId" value={cible.chantierId} />}
      {cible.devisId && <input type="hidden" name="devisId" value={cible.devisId} />}
      {cible.rapportId && <input type="hidden" name="rapportId" value={cible.rapportId} />}
      {rediriger && <input type="hidden" name="rediriger" value="1" />}
      <div className="sm:col-span-2"><ChampFichier nom="fichier" libelle="Fichier" requis aide={`${FORMATS_ACCEPTES} · ${TAILLE_MAX_MO} Mo maximum.`} /></div>
      <Selection nom="categorie" libelle="Catégorie" requis options={Object.entries(CATEGORIES_DOCUMENT)} defaut={categorieDefaut} aide={`Approbation requise pour : ${CATEGORIES_A_APPROUVER.map((c) => CATEGORIES_DOCUMENT[c].toLowerCase()).join(", ")}.`} />
      <Champ nom="titre" libelle="Titre" placeholder="Par défaut : nom du fichier" />
      <Champ nom="reference" libelle="Référence (n° de plan…)" />
      <Champ nom="indice" libelle="Indice / révision" placeholder="ex. A" />
      <Champ nom="lot" libelle="Lot" />
      <Champ nom="dateValidite" libelle="Valable jusqu'au" type="date" aide="Attestations, assurances, cautions…" />
      {partage && (
        <fieldset className="sm:col-span-2">
          <legend className="etiquette">Partager la version en vigueur sur le portail avec</legend>
          <div className="flex flex-wrap gap-3">
            {ROLES_EXTERNES.map((r) => (
              <label key={r} className="flex items-center gap-1 text-sm"><input type="checkbox" name="partageExterne" value={r} /> {ROLES[r].replace(" (portail)", "")}</label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Seuls les intervenants dont l'accès portail à ce chantier est ouvert le verront. Rien n'est partagé par défaut.</p>
        </fieldset>
      )}
    </>
  );
}

/** Liste des documents d'un chantier, d'un devis ou d'un rapport, avec formulaire de dépôt. */
export async function ListeDocuments({
  user, titre, where, cible, peutDeposer, categorieDefaut, sansPhotos = true,
}: {
  user: UtilisateurConnecte;
  titre: string;
  where: Prisma.DocumentWhereInput;
  cible: Cible;
  peutDeposer: boolean;
  categorieDefaut?: CategorieDocument;
  sansPhotos?: boolean;
}) {
  const docs = await db.document.findMany({
    where: {
      AND: [
        where,
        { archive: false },
        sansPhotos ? { categorie: { not: "PHOTO" } } : {},
        user.externe ? { partageExterne: { has: user.role } } : {},
      ],
    },
    include: { versions: { orderBy: { numero: "desc" }, select: { id: true, numero: true, indice: true, statut: true, nomFichier: true, deposeLe: true } } },
    orderBy: [{ categorie: "asc" }, { titre: "asc" }],
  });
  const auj = aujourdhuiDakar();
  const visibles = user.externe ? docs.filter((d) => versionCourante(d.versions)) : docs;
  return (
    <section className="carte mt-4">
      <h2 className="mb-3">{titre} ({visibles.length})</h2>
      {visibles.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">Aucun document.</p>
      ) : (
        <div className="mb-3 overflow-x-auto">
          <table className="tableau">
            <thead><tr><th>Document</th><th>Catégorie</th><th>Version en vigueur</th>{!user.externe && <th>Dernier dépôt</th>}<th>Validité</th></tr></thead>
            <tbody>
              {visibles.map((d) => {
                const cour = versionCourante(d.versions);
                const derniere = d.versions[0];
                const expire = d.dateValidite && d.dateValidite < auj;
                return (
                  <tr key={d.id}>
                    <td>
                      {user.externe ? d.titre : <Link className="lien" href={`/documents/${d.id}`}>{d.titre}</Link>}
                      {d.reference && <span className="ml-1 text-xs text-slate-500">{d.reference}</span>}
                    </td>
                    <td>{CATEGORIES_DOCUMENT[d.categorie]}</td>
                    <td>
                      {cour ? (
                        <a className="lien" href={`/api/fichiers/${cour.id}`} target="_blank" rel="noopener">
                          {cour.indice ? `Indice ${cour.indice}` : `Version ${cour.numero}`}
                        </a>
                      ) : <span className="text-amber-700">Aucune version en vigueur</span>}
                    </td>
                    {!user.externe && (
                      <td className="whitespace-nowrap">
                        <span className={`badge ${COULEUR_VERSION[derniere.statut]}`}>{STATUTS_VERSION[derniere.statut]}</span>
                        <span className="block text-xs text-slate-500">{formatDateHeure(derniere.deposeLe)}</span>
                      </td>
                    )}
                    <td className={expire ? "font-medium text-rose-700" : ""}>{d.dateValidite ? `${formatDate(d.dateValidite)}${expire ? " (expiré)" : ""}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {peutDeposer && (
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-ecorse-bleu-700">Déposer un document</summary>
          <FormulaireAction action={creerDocument} libelle="Déposer" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ChampsDepot cible={cible} categorieDefaut={categorieDefaut} partage={!!cible.chantierId} />
          </FormulaireAction>
        </details>
      )}
    </section>
  );
}

/** Galerie de photos (versions en vigueur) + dépôt groupé. */
export async function Photos({ user, where, cible, peutDeposer, titre = "Photos" }: { user: UtilisateurConnecte; where: Prisma.DocumentWhereInput; cible: Cible; peutDeposer: boolean; titre?: string }) {
  const photos = await db.document.findMany({
    where: { AND: [where, { categorie: "PHOTO", archive: false }, user.externe ? { partageExterne: { has: user.role } } : {}] },
    include: { versions: { where: { statut: { in: ["EN_VIGUEUR", "APPROUVE"] } }, take: 1, select: { id: true, deposeLe: true } } },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  const visibles = photos.filter((p) => p.versions.length);
  return (
    <section className="carte mt-4">
      <h2 className="mb-3">{titre} ({visibles.length})</h2>
      {visibles.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">Aucune photo.</p>
      ) : (
        <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {visibles.map((p) => (
            <li key={p.id}>
              <a href={`/api/fichiers/${p.versions[0].id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/fichiers/${p.versions[0].id}`} alt={p.titre} loading="lazy" className="aspect-square w-full object-cover" />
              </a>
              <p className="mt-1 truncate text-xs text-slate-600" title={p.titre}>{p.titre}</p>
              <p className="text-[11px] text-slate-400">{formatDateHeure(p.versions[0].deposeLe)}</p>
            </li>
          ))}
        </ul>
      )}
      {peutDeposer && (
        <FormulaireAction action={deposerPhotos} libelle="Envoyer les photos" classeBouton="btn-secondaire" className="grid gap-3 sm:grid-cols-2">
          {cible.chantierId && <input type="hidden" name="chantierId" value={cible.chantierId} />}
          {cible.rapportId && <input type="hidden" name="rapportId" value={cible.rapportId} />}
          <ChampFichier nom="photos" libelle="Ajouter des photos" multiple accept="image/jpeg,image/png,image/webp" compresser aide="8 photos maximum par envoi ; elles sont réduites avant l'envoi." />
          <Champ nom="legende" libelle="Légende" placeholder="ex. Coulage dalle haute RDC" />
          {!user.externe && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="partageExterne" value="CLIENT" className="h-4 w-4" /> Visible par le client sur le portail (si son accès est ouvert)
            </label>
          )}
        </FormulaireAction>
      )}
    </section>
  );
}
