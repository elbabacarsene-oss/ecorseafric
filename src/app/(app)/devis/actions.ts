"use server";

import type { Prisma, Region, TypeComposant, TypeProjet, Unite } from "@prisma/client";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/FormulaireAction";
import { chantierAccessible, devisAccessible } from "@/lib/acces";
import { AccesRefuse, verifierPermission, type UtilisateurConnecte } from "@/lib/auth";
import { evenementChantier, journaliser } from "@/lib/audit";
import { montantsChantierDepuisBudget } from "@/lib/budget-calculs";
import { prochainCodeChantier, prochainNumeroDevis } from "@/lib/codes";
import { db } from "@/lib/db";
import { budgetDepuisDevis, debourseSecSousDetail, totauxDevis, varianteSuivante } from "@/lib/devis-calculs";
import { ajouterJours, formatXOF } from "@/lib/format";
import { choix, date, entier, ErreurSaisie, executer, nombre, texte } from "@/lib/formulaire";
import { analyserTableau, lireCsv, type LigneImportee } from "@/lib/import-quantites";
import { POSTES_BUDGET, REGIONS, TYPES_COMPOSANT, TYPES_PROJET, UNITES } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { lireFichier } from "@/lib/stockage";

// ───────────── Outils ─────────────

const inclureLignes = { lignes: { orderBy: { ordre: "asc" }, include: { sousDetail: { orderBy: { ordre: "asc" } } } } } satisfies Prisma.DevisInclude;

async function devisPour(user: UtilisateurConnecte, id: string, action: "lire" | "modifier" | "approuver") {
  const d = await db.devis.findUnique({ where: { id } });
  if (!d || !(await devisAccessible(user, id, action === "approuver" ? "approuver" : action))) throw new AccesRefuse("Devis introuvable ou non autorisé.");
  return d;
}

function exigerBrouillon(d: { statut: string }) {
  if (d.statut !== "BROUILLON") throw new ErreurSaisie("Seul un devis en brouillon peut être modifié. Créez une nouvelle version pour le faire évoluer.");
}

async function ligneModifiable(user: UtilisateurConnecte, ligneId: string) {
  const l = await db.ligneDevis.findUnique({ where: { id: ligneId }, include: { devis: true } });
  if (!l) throw new AccesRefuse("Ligne introuvable.");
  await devisPour(user, l.devisId, "modifier");
  exigerBrouillon(l.devis);
  return l;
}

function lireTaux(fd: FormData) {
  return {
    tauxFraisChantier: nombre(fd, "tauxFraisChantier", { libelle: "Frais de chantier (%)", max: 100 }) ?? 0,
    tauxFraisGeneraux: nombre(fd, "tauxFraisGeneraux", { libelle: "Frais généraux (%)", max: 100 }) ?? 0,
    tauxMarge: nombre(fd, "tauxMarge", { libelle: "Marge (%)", max: 200 }) ?? 0,
    tauxTva: nombre(fd, "tauxTva", { libelle: "TVA (%)", max: 100 }) ?? 0,
  };
}

async function lireEnTete(fd: FormData, user: UtilisateurConnecte) {
  const clientId = texte(fd, "clientId", { requis: true, libelle: "Client" })!;
  const client = await db.intervenant.findUnique({ where: { id: clientId }, select: { categorie: true, actif: true } });
  if (!client?.actif || client.categorie !== "MAITRISE_OUVRAGE") throw new ErreurSaisie("Client introuvable : choisissez une fiche de la maîtrise d'ouvrage.");
  const chantierId = texte(fd, "chantierId");
  if (chantierId && !(await chantierAccessible(user, chantierId, "lire", "devis"))) throw new AccesRefuse("Chantier non autorisé.");
  const dateDevis = date(fd, "dateDevis", { libelle: "Date du devis" }) ?? undefined;
  const dateValidite = date(fd, "dateValidite", { libelle: "Date de validité" });
  if (dateDevis && dateValidite && dateValidite < dateDevis) throw new ErreurSaisie("La date de validité doit suivre la date du devis.");
  return {
    objet: texte(fd, "objet", { requis: true, libelle: "Objet", max: 300 })!,
    clientId,
    chantierId,
    typeProjet: choix<TypeProjet>(fd, "typeProjet", TYPES_PROJET),
    lieu: texte(fd, "lieu", { max: 200 }),
    dateDevis,
    dateValidite,
    delaiExecutionJours: texte(fd, "delaiExecutionJours") ? entier(fd, "delaiExecutionJours", { libelle: "Délai d'exécution", min: 1 }) : null,
    conditions: texte(fd, "conditions", { max: 4000 }),
    notesInternes: texte(fd, "notesInternes", { max: 4000 }),
    ...lireTaux(fd),
  };
}

const revalider = (id: string) => {
  revalidatePath(`/devis/${id}`);
  revalidatePath("/devis");
};

// ───────────── Création, en-tête ─────────────

export async function creerDevis(_: EtatAction, fd: FormData): Promise<EtatAction> {
  let id = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("devis", "creer");
    const data = await lireEnTete(fd, user);
    id = await db.$transaction(async (tx) => {
      const numero = await prochainNumeroDevis(tx);
      const d = await tx.devis.create({ data: { ...data, numero, preparePar: user.id } });
      await journaliser(user.id, "CREATION", "Devis", d.id, { numero, objet: data.objet }, tx);
      return d.id;
    });
  });
  if (r?.erreur || !id) return r;
  revalidatePath("/devis");
  redirect(`/devis/${id}`);
}

export async function modifierEnTeteDevis(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const d = await devisPour(user, id, "modifier");
    exigerBrouillon(d);
    const data = await lireEnTete(fd, user);
    await db.devis.update({ where: { id }, data });
    await journaliser(user.id, "MODIFICATION", "Devis", id, { ...data, dateDevis: data.dateDevis?.toISOString(), dateValidite: data.dateValidite?.toISOString() });
    revalider(id);
    return { succes: "En-tête et coefficients enregistrés." };
  });
}

// ───────────── Lignes ─────────────

async function prochainOrdre(tx: Prisma.TransactionClient, devisId: string) {
  const m = await tx.ligneDevis.aggregate({ where: { devisId }, _max: { ordre: true } });
  return (m._max.ordre ?? 0) + 1;
}

export async function ajouterLigne(devisId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    exigerBrouillon(await devisPour(user, devisId, "modifier"));
    const lot = texte(fd, "lot", { requis: true, libelle: "Lot", max: 150 })!;
    const quantite = nombre(fd, "quantite", { requis: true, libelle: "Quantité" })!;
    const prixImpose = nombre(fd, "prixUnitaireImpose", { libelle: "Prix unitaire imposé" });
    const ouvrageId = texte(fd, "ouvrageId");
    await db.$transaction(async (tx) => {
      const ordre = await prochainOrdre(tx, devisId);
      if (ouvrageId) {
        const o = await tx.ouvrage.findUnique({ where: { id: ouvrageId }, include: { composants: { orderBy: { ordre: "asc" } } } });
        if (!o?.actif) throw new ErreurSaisie("Ouvrage introuvable ou inactif.");
        const dsSaisi = nombre(fd, "debourseSecUnitaire", { libelle: "Déboursé sec unitaire" });
        await tx.ligneDevis.create({
          data: {
            devisId, ordre, lot, ouvrageId: o.id, designation: texte(fd, "designation", { max: 500 }) ?? o.designation, unite: o.unite, quantite,
            debourseSecUnitaire: o.composants.length ? debourseSecSousDetail(o.composants) : (dsSaisi ?? 0),
            prixUnitaireImpose: prixImpose === null ? null : Math.round(prixImpose),
            origine: "BIBLIOTHEQUE",
            // Copie du sous-détail : une modification ultérieure de la bibliothèque ne change pas ce devis.
            sousDetail: { create: o.composants.map((c) => ({ ordre: c.ordre, type: c.type, designation: c.designation, unite: c.unite, quantite: c.quantite, prixUnitaire: c.prixUnitaire })) },
          },
        });
      } else {
        await tx.ligneDevis.create({
          data: {
            devisId, ordre, lot,
            designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 500 })!,
            unite: choix<Unite>(fd, "unite", UNITES, { requis: true, libelle: "Unité" })!,
            quantite,
            debourseSecUnitaire: nombre(fd, "debourseSecUnitaire", { libelle: "Déboursé sec unitaire" }) ?? 0,
            prixUnitaireImpose: prixImpose === null ? null : Math.round(prixImpose),
          },
        });
      }
    });
    revalider(devisId);
    return { succes: "Ligne ajoutée.", jeton: Date.now() };
  });
}

export async function modifierLigne(ligneId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const l = await ligneModifiable(user, ligneId);
    const n = await db.sousDetailLigne.count({ where: { ligneId } });
    const prixImpose = nombre(fd, "prixUnitaireImpose", { libelle: "Prix unitaire imposé" });
    const quantite = nombre(fd, "quantite", { requis: true, libelle: "Quantité" })!;
    const data = {
      lot: texte(fd, "lot", { requis: true, libelle: "Lot", max: 150 })!,
      designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 500 })!,
      unite: choix<Unite>(fd, "unite", UNITES, { requis: true, libelle: "Unité" })!,
      quantite,
      prixUnitaireImpose: prixImpose === null ? null : Math.round(prixImpose),
      ...(n === 0 && { debourseSecUnitaire: nombre(fd, "debourseSecUnitaire", { libelle: "Déboursé sec unitaire" }) ?? 0 }),
      // Une quantité importée corrigée par une personne est considérée comme vérifiée.
      ...(l.origine === "IMPORT" && !l.verifiee && { verifiee: true, verifieePar: user.id, dateVerification: new Date() }),
    };
    await db.ligneDevis.update({ where: { id: ligneId }, data });
    await journaliser(user.id, "MODIFICATION", "LigneDevis", ligneId, { devisId: l.devisId, avant: { quantite: l.quantite.toString() }, apres: { quantite } });
    revalider(l.devisId);
    return { succes: "Ligne enregistrée." };
  });
}

export async function supprimerLigne(ligneId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const l = await ligneModifiable(user, ligneId);
    await db.ligneDevis.delete({ where: { id: ligneId } });
    await journaliser(user.id, "SUPPRESSION", "LigneDevis", ligneId, { devisId: l.devisId, designation: l.designation });
    revalider(l.devisId);
    return { succes: "Ligne supprimée." };
  });
}

/** Vérification humaine d'une quantité importée (exigée avant soumission). */
export async function verifierLigne(ligneId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const l = await ligneModifiable(user, ligneId);
    await db.ligneDevis.update({ where: { id: ligneId }, data: { verifiee: true, verifieePar: user.id, dateVerification: new Date() } });
    await journaliser(user.id, "VERIFICATION", "LigneDevis", ligneId, { devisId: l.devisId, quantite: l.quantite.toString() });
    revalider(l.devisId);
    return { succes: "Quantité vérifiée." };
  });
}

async function recalculerDS(tx: Prisma.TransactionClient, ligneId: string) {
  const sd = await tx.sousDetailLigne.findMany({ where: { ligneId } });
  if (sd.length) await tx.ligneDevis.update({ where: { id: ligneId }, data: { debourseSecUnitaire: debourseSecSousDetail(sd) } });
}

export async function ajouterSousDetail(ligneId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const l = await ligneModifiable(user, ligneId);
    await db.$transaction(async (tx) => {
      const n = await tx.sousDetailLigne.count({ where: { ligneId } });
      await tx.sousDetailLigne.create({
        data: {
          ligneId, ordre: n + 1,
          type: choix<TypeComposant>(fd, "type", TYPES_COMPOSANT, { requis: true, libelle: "Nature" })!,
          designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 300 })!,
          unite: choix<Unite>(fd, "unite", UNITES, { requis: true, libelle: "Unité" })!,
          quantite: nombre(fd, "quantite", { requis: true, libelle: "Quantité" })!,
          prixUnitaire: nombre(fd, "prixUnitaire", { requis: true, libelle: "Prix unitaire" })!,
        },
      });
      await recalculerDS(tx, ligneId);
    });
    revalider(l.devisId);
    return { succes: "Composant ajouté au sous-détail.", jeton: Date.now() };
  });
}

export async function supprimerSousDetail(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const sd = await db.sousDetailLigne.findUnique({ where: { id } });
    if (!sd) throw new AccesRefuse("Composant introuvable.");
    const l = await ligneModifiable(user, sd.ligneId);
    await db.$transaction(async (tx) => {
      await tx.sousDetailLigne.delete({ where: { id } });
      const reste = await tx.sousDetailLigne.count({ where: { ligneId: l.id } });
      if (reste === 0) await tx.ligneDevis.update({ where: { id: l.id }, data: { debourseSecUnitaire: 0 } });
      else await recalculerDS(tx, l.id);
    });
    revalider(l.devisId);
    return { succes: "Composant retiré." };
  });
}

/** Import d'un tableau de quantités (CSV ou Excel) : les lignes importées doivent être vérifiées une à une. */
export async function importerQuantites(devisId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    exigerBrouillon(await devisPour(user, devisId, "modifier"));
    const f = await lireFichier(fd.get("fichier"), { libelle: "Fichier" });
    if (!f) throw new ErreurSaisie("Choisissez un fichier CSV ou Excel (.xlsx).");
    let tableau: (string | number | null)[][];
    if (f.type.ext === "csv" || f.type.ext === "txt") {
      tableau = lireCsv(new TextDecoder("utf-8").decode(f.octets));
    } else if (f.type.ext === "xlsx") {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(f.octets as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      tableau = [];
      ws?.eachRow({ includeEmpty: false }, (row) => {
        const vals: (string | number | null)[] = [];
        for (let c = 1; c <= row.cellCount; c++) {
          const v = row.getCell(c).value;
          vals.push(v === null || v === undefined ? null : typeof v === "number" ? v : typeof v === "object" && "result" in v ? (v.result as number) : String(v));
        }
        tableau.push(vals);
      });
    } else throw new ErreurSaisie("Format non pris en charge pour l'import : utilisez un fichier CSV ou Excel (.xlsx).");
    const { lignes, erreurs } = analyserTableau(tableau, texte(fd, "lotDefaut", { max: 150 }) ?? "Lot unique");
    if (erreurs.length) throw new ErreurSaisie(`Import refusé, rien n'a été enregistré. ${erreurs.slice(0, 5).join(" ")}${erreurs.length > 5 ? ` (+${erreurs.length - 5} autres)` : ""}`);
    await db.$transaction(async (tx) => {
      let ordre = await prochainOrdre(tx, devisId);
      await tx.ligneDevis.createMany({
        data: lignes.map((l: LigneImportee) => ({
          devisId, ordre: ordre++, lot: l.lot, designation: l.designation, unite: l.unite, quantite: l.quantite,
          debourseSecUnitaire: l.debourseSecUnitaire ?? 0,
          prixUnitaireImpose: l.prixUnitaire === null ? null : Math.round(l.prixUnitaire),
          origine: "IMPORT" as const, verifiee: false,
        })),
      });
      await journaliser(user.id, "IMPORT", "Devis", devisId, { fichier: f.nom, empreinte: f.empreinte, lignes: lignes.length }, tx);
    });
    revalider(devisId);
    return { succes: `${lignes.length} ligne(s) importée(s). Chaque quantité doit être vérifiée avant la soumission du devis.`, jeton: Date.now() };
  });
}

// ───────────── Circuit de validation ─────────────

export async function soumettreDevis(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const d = await devisPour(user, id, "modifier");
    exigerBrouillon(d);
    const complet = await db.devis.findUniqueOrThrow({ where: { id }, include: inclureLignes });
    const t = totauxDevis(complet.lignes.map((l) => ({ ...l, sousDetail: l.sousDetail })), complet);
    if (complet.lignes.length === 0) return { erreur: "Le devis ne comporte aucune ligne." };
    if (t.lignesNonVerifiees) return { erreur: `${t.lignesNonVerifiees} quantité(s) importée(s) n'ont pas été vérifiées par une personne.` };
    if (t.lignesSansPrix) return { erreur: `${t.lignesSansPrix} ligne(s) sans prix : saisissez un déboursé sec ou un prix imposé.` };
    await db.devis.update({ where: { id }, data: { statut: "SOUMIS", motifDecision: null } });
    await journaliser(user.id, "SOUMISSION", "Devis", id, { totalHT: t.totalHT });
    revalider(id);
    return { succes: "Devis soumis à validation interne." };
  });
}

export async function deciderDevis(id: string, decision: "VALIDE" | "RENVOI", _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "approuver");
    const d = await devisPour(user, id, "approuver");
    if (d.statut !== "SOUMIS") return { erreur: "Seul un devis soumis peut être validé ou renvoyé." };
    if (d.preparePar === user.id) return { erreur: "Vous avez préparé ce devis : sa validation doit être faite par une autre personne habilitée." };
    const motif = texte(fd, "motif", { max: 1000 });
    if (decision === "RENVOI" && !motif) return { erreur: "Indiquez le motif du renvoi." };
    await db.devis.update({
      where: { id },
      data: decision === "VALIDE"
        ? { statut: "VALIDE", validePar: user.id, dateDecision: new Date(), motifDecision: motif }
        : { statut: "BROUILLON", motifDecision: motif, validePar: null, dateDecision: new Date() },
    });
    await journaliser(user.id, decision === "VALIDE" ? "APPROBATION" : "RENVOI", "Devis", id, { motif });
    revalider(id);
    return { succes: decision === "VALIDE" ? "Devis validé." : "Devis renvoyé en brouillon." };
  });
}

export async function marquerEnvoye(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const d = await devisPour(user, id, "modifier");
    if (d.statut !== "VALIDE") return { erreur: "Seul un devis validé en interne peut être envoyé au client." };
    await db.devis.update({ where: { id }, data: { statut: "ENVOYE", dateEnvoi: new Date() } });
    await journaliser(user.id, "ENVOI", "Devis", id);
    revalider(id);
    return { succes: "Devis marqué comme envoyé au client." };
  });
}

export async function reponseClient(id: string, reponse: "ACCEPTE" | "REFUSE", _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const d = await devisPour(user, id, "modifier");
    if (d.statut !== "ENVOYE") return { erreur: "Seul un devis envoyé peut être accepté ou refusé." };
    const motif = texte(fd, "motif", { max: 1000 });
    await db.devis.update({ where: { id }, data: { statut: reponse, dateReponse: new Date(), ...(motif && { motifDecision: motif }) } });
    await journaliser(user.id, reponse === "ACCEPTE" ? "ACCEPTATION_CLIENT" : "REFUS_CLIENT", "Devis", id, { motif });
    revalider(id);
    return { succes: reponse === "ACCEPTE" ? "Acceptation du client enregistrée." : "Refus du client enregistré." };
  });
}

// ───────────── Versions et variantes ─────────────

async function copierDevis(tx: Prisma.TransactionClient, sourceId: string, cible: { variante: string; version: number }, userId: string) {
  const s = await tx.devis.findUniqueOrThrow({ where: { id: sourceId }, include: inclureLignes });
  const nouveau = await tx.devis.create({
    data: {
      numero: s.numero, variante: cible.variante, version: cible.version, objet: s.objet, clientId: s.clientId, chantierId: s.chantierId,
      typeProjet: s.typeProjet, lieu: s.lieu, tauxFraisChantier: s.tauxFraisChantier, tauxFraisGeneraux: s.tauxFraisGeneraux,
      tauxMarge: s.tauxMarge, tauxTva: s.tauxTva, dateValidite: s.dateValidite, delaiExecutionJours: s.delaiExecutionJours,
      conditions: s.conditions, notesInternes: s.notesInternes, preparePar: userId,
    },
  });
  for (const l of s.lignes) {
    await tx.ligneDevis.create({
      data: {
        devisId: nouveau.id, ordre: l.ordre, lot: l.lot, ouvrageId: l.ouvrageId, designation: l.designation, unite: l.unite,
        quantite: l.quantite, debourseSecUnitaire: l.debourseSecUnitaire, prixUnitaireImpose: l.prixUnitaireImpose, origine: l.origine,
        verifiee: l.verifiee, verifieePar: l.verifieePar, dateVerification: l.dateVerification,
        sousDetail: { create: l.sousDetail.map((c) => ({ ordre: c.ordre, type: c.type, designation: c.designation, unite: c.unite, quantite: c.quantite, prixUnitaire: c.prixUnitaire })) },
      },
    });
  }
  return nouveau;
}

export async function nouvelleVersion(id: string, _: EtatAction): Promise<EtatAction> {
  let nouvelId = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("devis", "creer");
    const d = await devisPour(user, id, "lire");
    if (d.statut === "BROUILLON" || d.statut === "SOUMIS") return { erreur: "Ce devis est encore modifiable : inutile de créer une version." };
    if (d.statut === "ACCEPTE") return { erreur: "Un devis accepté est contractuel : ses évolutions passent par des avenants." };
    if (d.statut === "REMPLACE") return { erreur: "Partez de la dernière version." };
    nouvelId = await db.$transaction(async (tx) => {
      const max = await tx.devis.aggregate({ where: { numero: d.numero, variante: d.variante }, _max: { version: true } });
      const n = await copierDevis(tx, id, { variante: d.variante, version: (max._max.version ?? 1) + 1 }, user.id);
      await tx.devis.update({ where: { id }, data: { statut: "REMPLACE" } });
      await journaliser(user.id, "NOUVELLE_VERSION", "Devis", n.id, { depuis: id, version: n.version }, tx);
      return n.id;
    });
  });
  if (r?.erreur || !nouvelId) return r;
  revalider(id);
  redirect(`/devis/${nouvelId}`);
}

export async function nouvelleVariante(id: string, _: EtatAction): Promise<EtatAction> {
  let nouvelId = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("devis", "creer");
    const d = await devisPour(user, id, "lire");
    nouvelId = await db.$transaction(async (tx) => {
      const existantes = await tx.devis.findMany({ where: { numero: d.numero }, select: { variante: true }, distinct: ["variante"] });
      const n = await copierDevis(tx, id, { variante: varianteSuivante(existantes.map((x) => x.variante)), version: 1 }, user.id);
      await journaliser(user.id, "NOUVELLE_VARIANTE", "Devis", n.id, { depuis: id, variante: n.variante }, tx);
      return n.id;
    });
  });
  if (r?.erreur || !nouvelId) return r;
  revalidatePath("/devis");
  redirect(`/devis/${nouvelId}`);
}

export async function supprimerDevis(id: string, _: EtatAction): Promise<EtatAction> {
  const r = await executer(async () => {
    const { user } = await verifierPermission("devis", "modifier");
    const d = await devisPour(user, id, "modifier");
    exigerBrouillon(d);
    if (d.version > 1) return { erreur: "Une version ultérieure ne peut pas être supprimée : elle remplace une version précédente." };
    await db.$transaction(async (tx) => {
      await tx.document.updateMany({ where: { devisId: id }, data: { devisId: null } });
      await tx.devis.delete({ where: { id } });
      await journaliser(user.id, "SUPPRESSION", "Devis", id, { numero: d.numero, variante: d.variante }, tx);
    });
  });
  if (r?.erreur) return r;
  revalidatePath("/devis");
  redirect("/devis");
}

// ───────────── Transformation en chantier ─────────────

/**
 * Devis accepté → chantier : le devis (lignes, quantités, prix, conditions) reste rattaché au chantier,
 * le budget détaillé est initialisé à partir du coût de revient et les documents du dossier suivent.
 */
export async function transformerEnChantier(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  let chantierId = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("devis", "lire");
    const d = await db.devis.findUnique({ where: { id }, include: inclureLignes });
    if (!d || !(await devisAccessible(user, id, "lire"))) throw new AccesRefuse("Devis introuvable ou non autorisé.");
    if (d.statut !== "ACCEPTE") return { erreur: "Seul un devis accepté par le client peut être transformé en chantier." };
    const t = totauxDevis(d.lignes, d);
    const budget = budgetDepuisDevis(d.lignes, d);
    const lignesBudget = (cid: string) => budget.map((b, i) => ({
      chantierId: cid, ordre: i + 1, lot: b.lot, poste: b.poste, designation: `${POSTES_BUDGET[b.poste]} — ${b.lot}`, montantInitial: b.montant,
      commentaire: `Issu du devis ${d.numero}-${d.variante} v${d.version}`,
    }));
    const montants = montantsChantierDepuisBudget(budget.map((b) => ({ ...b, montantInitial: b.montant, montantActualise: null })));

    if (!d.chantierId) {
      await verifierPermission("chantiers", "creer");
      const dateDemarrage = date(fd, "dateDemarrage", { libelle: "Date de démarrage" });
      const dateFin = date(fd, "dateFinContractuelle", { libelle: "Date contractuelle de fin" })
        ?? (dateDemarrage && d.delaiExecutionJours ? ajouterJours(dateDemarrage, d.delaiExecutionJours - 1) : null);
      if (dateDemarrage && dateFin && dateFin < dateDemarrage) throw new ErreurSaisie("La date de fin doit suivre la date de démarrage.");
      const typeProjet = choix<TypeProjet>(fd, "typeProjet", TYPES_PROJET, { requis: true, libelle: "Type de projet" })!;
      chantierId = await db.$transaction(async (tx) => {
        const code = await prochainCodeChantier(tx);
        const c = await tx.chantier.create({
          data: {
            code, nom: texte(fd, "nom", { requis: true, libelle: "Nom du chantier", max: 200 })!, typeProjet, clientId: d.clientId,
            description: `${d.objet}${d.conditions ? `\n\nConditions du devis : ${d.conditions}` : ""}`,
            ville: texte(fd, "ville", { max: 100 }), region: choix<Region>(fd, "region", REGIONS), adresse: d.lieu,
            dateDemarrage, dateFinContractuelle: dateFin, montantMarche: t.totalHT, ...montants,
            budgetStatut: "BROUILLON", budgetPreparePar: user.id,
          },
        });
        await tx.affectationChantier.create({ data: { chantierId: c.id, intervenantId: d.clientId, roleChantier: "Client" } });
        await tx.ligneBudget.createMany({ data: lignesBudget(c.id) });
        await tx.devis.update({ where: { id }, data: { chantierId: c.id } });
        await tx.document.updateMany({ where: { devis: { numero: d.numero }, chantierId: null }, data: { chantierId: c.id } });
        await evenementChantier(c.id, "CREATION", `Chantier créé depuis le devis accepté ${d.numero} (variante ${d.variante}, v${d.version}) : marché ${formatXOF(t.totalHT)} HT, budget initial ${formatXOF(montants.budgetInitial)} (coût de revient).`, user.id, tx);
        await journaliser(user.id, "TRANSFORMATION", "Devis", id, { chantierId: c.id, code, totalHT: t.totalHT }, tx);
        return c.id;
      });
    } else {
      await verifierPermission("budgets", "creer");
      if (!(await chantierAccessible(user, d.chantierId, "creer", "budgets"))) throw new AccesRefuse("Chantier non autorisé.");
      const c = await db.chantier.findUniqueOrThrow({ where: { id: d.chantierId }, include: { _count: { select: { lignesBudget: true } } } });
      if (c._count.lignesBudget > 0) return { erreur: "Le budget détaillé de ce chantier est déjà établi : il n'est pas écrasé." };
      const majMarche = Number(c.montantMarche) === 0 && peut(user.role, "chantiers_marche", "modifier");
      await db.$transaction(async (tx) => {
        await tx.ligneBudget.createMany({ data: lignesBudget(c.id) });
        await tx.chantier.update({ where: { id: c.id }, data: { ...montants, budgetStatut: "BROUILLON", budgetPreparePar: user.id, ...(majMarche && { montantMarche: t.totalHT }) } });
        await tx.document.updateMany({ where: { devis: { numero: d.numero }, chantierId: null }, data: { chantierId: c.id } });
        await evenementChantier(c.id, "BUDGET", `Budget initialisé depuis le devis accepté ${d.numero} (variante ${d.variante}, v${d.version}) : ${formatXOF(montants.budgetInitial)}${majMarche ? ` ; marché fixé à ${formatXOF(t.totalHT)} HT` : ""}.`, user.id, tx);
        await journaliser(user.id, "TRANSFORMATION", "Devis", id, { chantierId: c.id, majMarche }, tx);
      });
      chantierId = c.id;
    }
  });
  if (r?.erreur || !chantierId) return r;
  revalider(id);
  redirect(`/chantiers/${chantierId}/budget`);
}
