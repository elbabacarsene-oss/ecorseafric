"use server";

import type { CategorieDocument, Prisma, Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/FormulaireAction";
import { chantierAccessible, devisAccessible, documentAccessible } from "@/lib/acces";
import { AccesRefuse, verifierPermission, type UtilisateurConnecte } from "@/lib/auth";
import { evenementChantier, journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { choix, coche, date, ErreurSaisie, executer, texte } from "@/lib/formulaire";
import { CATEGORIES_A_APPROUVER, CATEGORIES_DOCUMENT, ROLES_EXTERNES } from "@/lib/libelles";
import { portee } from "@/lib/permissions";
import { enregistrerFichier, lireFichier, type FichierRecu } from "@/lib/stockage";

const MAX_PHOTOS = 8;

function lirePartage(fd: FormData): Role[] {
  const roles = fd.getAll("partageExterne").map(String);
  if (roles.some((r) => !ROLES_EXTERNES.includes(r as Role))) throw new ErreurSaisie("Rôle de partage invalide.");
  return roles as Role[];
}

/** Vérifie le droit de créer un document sur la cible (chantier, devis, rapport ou entreprise). */
async function cibleAutorisee(user: UtilisateurConnecte, fd: FormData) {
  const chantierId = texte(fd, "chantierId");
  const devisId = texte(fd, "devisId");
  const rapportId = texte(fd, "rapportId");
  if (rapportId) {
    const r = await db.rapportJournalier.findUnique({ where: { id: rapportId }, select: { chantierId: true, statut: true } });
    if (!r || r.chantierId !== chantierId) throw new AccesRefuse("Rapport introuvable.");
    if (r.statut === "VALIDE") throw new ErreurSaisie("Le rapport est validé : on ne peut plus y ajouter de photos.");
  }
  if (chantierId) {
    if (!(await chantierAccessible(user, chantierId, "creer", "documents"))) throw new AccesRefuse("Chantier non autorisé.");
  } else if (devisId) {
    if (!(await devisAccessible(user, devisId, "modifier"))) throw new AccesRefuse("Devis non autorisé.");
  } else if (portee(user.role, "documents", "creer") !== "tous") {
    throw new AccesRefuse("Les documents de l'entreprise (sans chantier) sont réservés aux personnes ayant accès à tous les documents.");
  }
  return { chantierId, devisId, rapportId };
}

const statutInitial = (c: CategorieDocument) => (CATEGORIES_A_APPROUVER.includes(c) ? "EN_ATTENTE" : "EN_VIGUEUR") as "EN_ATTENTE" | "EN_VIGUEUR";

async function creerAvecVersion(
  tx: Prisma.TransactionClient,
  user: UtilisateurConnecte,
  data: Omit<Prisma.DocumentUncheckedCreateInput, "creePar">,
  f: FichierRecu,
  indice: string | null,
  commentaire: string | null,
) {
  const doc = await tx.document.create({ data: { ...data, creePar: user.id } });
  const fichier = await enregistrerFichier(tx, f);
  await tx.versionDocument.create({
    data: {
      documentId: doc.id, numero: 1, indice, statut: statutInitial(data.categorie), fichierId: fichier.id, nomFichier: f.nom, mime: f.type.mime,
      taille: f.taille, empreinte: f.empreinte, commentaire, deposePar: user.id,
    },
  });
  await journaliser(user.id, "CREATION", "Document", doc.id, { titre: data.titre, categorie: data.categorie, fichier: f.nom, empreinte: f.empreinte }, tx);
  if (data.chantierId) await evenementChantier(data.chantierId, "DOCUMENT", `Document déposé : ${CATEGORIES_DOCUMENT[data.categorie]} « ${data.titre} ».`, user.id, tx);
  return doc;
}

function revaliderCible(c: { chantierId?: string | null; devisId?: string | null; rapportId?: string | null }) {
  revalidatePath("/documents");
  if (c.chantierId) revalidatePath(`/chantiers/${c.chantierId}`);
  if (c.devisId) revalidatePath(`/devis/${c.devisId}`);
  if (c.rapportId) revalidatePath(`/rapports/${c.rapportId}`);
}

export async function creerDocument(_: EtatAction, fd: FormData): Promise<EtatAction> {
  let id = "";
  const rediriger = fd.get("rediriger") === "1";
  const r = await executer(async () => {
    const { user } = await verifierPermission("documents", "creer");
    const cible = await cibleAutorisee(user, fd);
    const f = await lireFichier(fd.get("fichier"));
    if (!f) throw new ErreurSaisie("Choisissez un fichier.");
    const categorie = choix<CategorieDocument>(fd, "categorie", CATEGORIES_DOCUMENT, { requis: true, libelle: "Catégorie" })!;
    const data = {
      ...cible,
      categorie,
      titre: texte(fd, "titre", { max: 300 }) ?? f.nom.replace(/\.[^.]+$/, ""),
      reference: texte(fd, "reference", { max: 100 }),
      lot: texte(fd, "lot", { max: 150 }),
      description: texte(fd, "description", { max: 2000 }),
      dateValidite: date(fd, "dateValidite", { libelle: "Date de validité" }),
      partageExterne: cible.chantierId ? lirePartage(fd) : [],
    };
    const doc = await db.$transaction((tx) => creerAvecVersion(tx, user, data, f, texte(fd, "indice", { max: 20 }), texte(fd, "commentaire", { max: 1000 })));
    id = doc.id;
    revaliderCible(cible);
  });
  if (r?.erreur) return r;
  if (!rediriger) return { succes: "Document enregistré.", jeton: Date.now() };
  redirect(`/documents/${id}`);
}

/** Dépôt groupé de photos (chantier ou rapport journalier). Les photos sont compressées dans le navigateur. */
export async function deposerPhotos(_: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("documents", "creer");
    const cible = await cibleAutorisee(user, fd);
    if (!cible.chantierId) throw new ErreurSaisie("Chantier manquant.");
    const fichiers = fd.getAll("photos").filter((x) => typeof x !== "string" && x.size > 0);
    if (fichiers.length === 0) throw new ErreurSaisie("Choisissez au moins une photo.");
    if (fichiers.length > MAX_PHOTOS) throw new ErreurSaisie(`${MAX_PHOTOS} photos au maximum par envoi.`);
    const recus: FichierRecu[] = [];
    for (const x of fichiers) recus.push((await lireFichier(x, { imagesSeulement: true }))!);
    const legende = texte(fd, "legende", { max: 300 });
    await db.$transaction(async (tx) => {
      for (const [i, f] of recus.entries()) {
        await creerAvecVersion(tx, user, {
          ...cible, categorie: "PHOTO", partageExterne: lirePartage(fd),
          titre: legende ? (recus.length > 1 ? `${legende} (${i + 1})` : legende) : f.nom.replace(/\.[^.]+$/, ""),
        }, f, null, null);
      }
    }, { timeout: 30_000 });
    revaliderCible(cible);
    return { succes: `${recus.length} photo(s) enregistrée(s).`, jeton: Date.now() };
  });
}

async function documentPour(user: UtilisateurConnecte, id: string, action: "modifier" | "approuver") {
  const d = await db.document.findUnique({ where: { id } });
  if (!d || !(await documentAccessible(user, d, action))) throw new AccesRefuse("Document introuvable ou non autorisé.");
  return d;
}

export async function deposerVersion(documentId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("documents", "modifier");
    const d = await documentPour(user, documentId, "modifier");
    const f = await lireFichier(fd.get("fichier"));
    if (!f) throw new ErreurSaisie("Choisissez un fichier.");
    const statut = statutInitial(d.categorie);
    await db.$transaction(async (tx) => {
      const max = await tx.versionDocument.aggregate({ where: { documentId }, _max: { numero: true } });
      const numero = (max._max.numero ?? 0) + 1;
      if (statut === "EN_VIGUEUR") {
        await tx.versionDocument.updateMany({ where: { documentId, statut: { in: ["EN_VIGUEUR", "APPROUVE"] } }, data: { statut: "REMPLACE", remplaceLe: new Date() } });
      }
      const fichier = await enregistrerFichier(tx, f);
      await tx.versionDocument.create({
        data: {
          documentId, numero, indice: texte(fd, "indice", { max: 20 }), statut, fichierId: fichier.id, nomFichier: f.nom, mime: f.type.mime,
          taille: f.taille, empreinte: f.empreinte, commentaire: texte(fd, "commentaire", { max: 1000 }), deposePar: user.id,
        },
      });
      await journaliser(user.id, "NOUVELLE_VERSION", "Document", documentId, { numero, fichier: f.nom, empreinte: f.empreinte }, tx);
      if (d.chantierId) await evenementChantier(d.chantierId, "DOCUMENT", `Nouvelle version (n°${numero}) de « ${d.titre} »${statut === "EN_ATTENTE" ? ", en attente d'approbation" : ""}.`, user.id, tx);
    });
    revaliderCible(d);
    revalidatePath(`/documents/${documentId}`);
    return { succes: statut === "EN_ATTENTE" ? "Version déposée : elle sera en vigueur après approbation." : "Nouvelle version en vigueur ; la précédente est marquée remplacée.", jeton: Date.now() };
  });
}

export async function deciderVersion(versionId: string, decision: "APPROUVE" | "REJETE", _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("documents", "approuver");
    const v = await db.versionDocument.findUnique({ where: { id: versionId } });
    if (!v) throw new AccesRefuse("Version introuvable.");
    const d = await documentPour(user, v.documentId, "approuver");
    if (v.statut !== "EN_ATTENTE") return { erreur: "Cette version n'est pas en attente d'approbation." };
    if (v.deposePar === user.id) return { erreur: "Vous avez déposé cette version : son approbation doit être faite par une autre personne habilitée." };
    const motif = texte(fd, "motif", { max: 1000 });
    if (decision === "REJETE" && !motif) return { erreur: "Indiquez le motif du rejet." };
    await db.$transaction(async (tx) => {
      if (decision === "APPROUVE") {
        // La version précédemment en vigueur reste consultable, marquée « remplacée ».
        await tx.versionDocument.updateMany({ where: { documentId: d.id, statut: { in: ["APPROUVE", "EN_VIGUEUR"] } }, data: { statut: "REMPLACE", remplaceLe: new Date() } });
      }
      await tx.versionDocument.update({ where: { id: versionId }, data: { statut: decision, decidePar: user.id, decideLe: new Date(), motif } });
      await journaliser(user.id, decision === "APPROUVE" ? "APPROBATION" : "REJET", "VersionDocument", versionId, { documentId: d.id, numero: v.numero, motif }, tx);
      if (d.chantierId) await evenementChantier(d.chantierId, "DOCUMENT", `« ${d.titre} » version n°${v.numero}${v.indice ? ` (indice ${v.indice})` : ""} ${decision === "APPROUVE" ? "approuvée" : "rejetée"}${motif ? ` : ${motif}` : ""}.`, user.id, tx);
    });
    revaliderCible(d);
    revalidatePath(`/documents/${d.id}`);
    return { succes: decision === "APPROUVE" ? "Version approuvée et mise en vigueur." : "Version rejetée." };
  });
}

export async function modifierDocument(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("documents", "modifier");
    const d = await documentPour(user, id, "modifier");
    const data = {
      titre: texte(fd, "titre", { requis: true, libelle: "Titre", max: 300 })!,
      reference: texte(fd, "reference", { max: 100 }),
      lot: texte(fd, "lot", { max: 150 }),
      description: texte(fd, "description", { max: 2000 }),
      dateValidite: date(fd, "dateValidite", { libelle: "Date de validité" }),
      partageExterne: d.chantierId ? lirePartage(fd) : [],
      archive: coche(fd, "archive"),
    };
    await db.document.update({ where: { id }, data });
    await journaliser(user.id, "MODIFICATION", "Document", id, {
      avant: { titre: d.titre, partageExterne: d.partageExterne, dateValidite: d.dateValidite?.toISOString() ?? null, archive: d.archive },
      apres: { titre: data.titre, partageExterne: data.partageExterne, dateValidite: data.dateValidite?.toISOString() ?? null, archive: data.archive },
    });
    revaliderCible(d);
    revalidatePath(`/documents/${id}`);
    return { succes: "Document mis à jour." };
  });
}
