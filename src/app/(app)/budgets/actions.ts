"use server";

import type { PosteBudget, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { EtatAction } from "@/components/FormulaireAction";
import { chantierAccessible } from "@/lib/acces";
import { AccesRefuse, verifierPermission, type UtilisateurConnecte } from "@/lib/auth";
import { evenementChantier, journaliser } from "@/lib/audit";
import { montantsChantierDepuisBudget, totauxBudget } from "@/lib/budget-calculs";
import { db } from "@/lib/db";
import { formatXOF } from "@/lib/format";
import { choix, ErreurSaisie, executer, montant, texte } from "@/lib/formulaire";
import { POSTES_BUDGET } from "@/lib/libelles";

async function chantierPour(user: UtilisateurConnecte, chantierId: string, action: "creer" | "modifier" | "approuver") {
  if (!(await chantierAccessible(user, chantierId, action, "budgets"))) throw new AccesRefuse("Chantier introuvable ou non autorisé.");
  return db.chantier.findUniqueOrThrow({ where: { id: chantierId } });
}

/** Reporte les totaux du budget détaillé sur la fiche chantier (marge prévisionnelle, tableau de bord). */
async function synchroniser(tx: Prisma.TransactionClient, chantierId: string) {
  const lignes = await tx.ligneBudget.findMany({ where: { chantierId } });
  await tx.chantier.update({ where: { id: chantierId }, data: montantsChantierDepuisBudget(lignes) });
}

const revalider = (id: string) => {
  revalidatePath(`/chantiers/${id}/budget`);
  revalidatePath(`/chantiers/${id}`);
  revalidatePath("/budgets");
  revalidatePath("/");
};

export async function ajouterLigneBudget(chantierId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("budgets", "creer");
    const c = await chantierPour(user, chantierId, "creer");
    if (c.budgetStatut === "SOUMIS") throw new ErreurSaisie("Le budget est en cours de validation : attendez la décision ou demandez son renvoi.");
    const valide = c.budgetStatut === "VALIDE";
    const m = montant(fd, "montant", { requis: true, libelle: "Montant" })!;
    const motif = texte(fd, "commentaire", { max: 500, requis: valide, libelle: "Motif de l'ajout" });
    const data = {
      chantierId,
      lot: texte(fd, "lot", { requis: true, libelle: "Lot", max: 150 })!,
      poste: choix<PosteBudget>(fd, "poste", POSTES_BUDGET, { requis: true, libelle: "Poste" })!,
      designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 300 })!,
      // Budget validé : le budget initial est figé, un nouveau besoin n'apparaît que dans le budget actualisé.
      montantInitial: valide ? 0 : m,
      montantActualise: valide ? m : null,
      commentaire: motif,
    };
    await db.$transaction(async (tx) => {
      const n = await tx.ligneBudget.count({ where: { chantierId } });
      const l = await tx.ligneBudget.create({ data: { ...data, ordre: n + 1 } });
      await synchroniser(tx, chantierId);
      if (c.budgetStatut === "NON_ETABLI") await tx.chantier.update({ where: { id: chantierId }, data: { budgetStatut: "BROUILLON", budgetPreparePar: user.id } });
      if (valide) await evenementChantier(chantierId, "BUDGET", `Budget actualisé : nouvelle ligne « ${data.designation} » ${formatXOF(m)} — ${motif}.`, user.id, tx);
      await journaliser(user.id, "CREATION", "LigneBudget", l.id, { chantierId, montant: m, apresValidation: valide }, tx);
    });
    revalider(chantierId);
    return { succes: "Ligne ajoutée.", jeton: Date.now() };
  });
}

export async function modifierLigneBudget(ligneId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("budgets", "modifier");
    const l = await db.ligneBudget.findUnique({ where: { id: ligneId } });
    if (!l) throw new AccesRefuse("Ligne introuvable.");
    const c = await chantierPour(user, l.chantierId, "modifier");
    if (c.budgetStatut === "SOUMIS") throw new ErreurSaisie("Le budget est en cours de validation.");
    if (c.budgetStatut === "VALIDE") {
      // Révision : seul le montant actualisé change, avec un motif tracé dans l'historique du chantier.
      const nouveau = montant(fd, "montantActualise", { requis: true, libelle: "Montant actualisé" })!;
      const motif = texte(fd, "motif", { requis: true, libelle: "Motif de la révision", max: 500 })!;
      const avant = l.montantActualise ?? l.montantInitial;
      await db.$transaction(async (tx) => {
        await tx.ligneBudget.update({ where: { id: ligneId }, data: { montantActualise: nouveau, commentaire: motif } });
        await synchroniser(tx, l.chantierId);
        await evenementChantier(l.chantierId, "BUDGET", `Révision budgétaire « ${l.designation} » : ${formatXOF(avant)} → ${formatXOF(nouveau)} — ${motif}.`, user.id, tx);
        await journaliser(user.id, "REVISION", "LigneBudget", ligneId, { avant: avant.toString(), apres: nouveau, motif }, tx);
      });
      revalider(l.chantierId);
      return { succes: "Révision enregistrée." };
    }
    const data = {
      lot: texte(fd, "lot", { requis: true, libelle: "Lot", max: 150 })!,
      poste: choix<PosteBudget>(fd, "poste", POSTES_BUDGET, { requis: true, libelle: "Poste" })!,
      designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 300 })!,
      montantInitial: montant(fd, "montantInitial", { requis: true, libelle: "Montant" })!,
      commentaire: texte(fd, "commentaire", { max: 500 }),
    };
    await db.$transaction(async (tx) => {
      await tx.ligneBudget.update({ where: { id: ligneId }, data });
      await synchroniser(tx, l.chantierId);
      await journaliser(user.id, "MODIFICATION", "LigneBudget", ligneId, { avant: l.montantInitial.toString(), apres: data.montantInitial }, tx);
    });
    revalider(l.chantierId);
    return { succes: "Ligne enregistrée." };
  });
}

export async function supprimerLigneBudget(ligneId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("budgets", "modifier");
    const l = await db.ligneBudget.findUnique({ where: { id: ligneId } });
    if (!l) throw new AccesRefuse("Ligne introuvable.");
    const c = await chantierPour(user, l.chantierId, "modifier");
    if (c.budgetStatut === "SOUMIS" || c.budgetStatut === "VALIDE") throw new ErreurSaisie("Budget validé ou en validation : révisez le montant actualisé (à 0 si besoin) au lieu de supprimer.");
    await db.$transaction(async (tx) => {
      await tx.ligneBudget.delete({ where: { id: ligneId } });
      await synchroniser(tx, l.chantierId);
      await journaliser(user.id, "SUPPRESSION", "LigneBudget", ligneId, { designation: l.designation, montant: l.montantInitial.toString() }, tx);
    });
    revalider(l.chantierId);
    return { succes: "Ligne supprimée." };
  });
}

export async function soumettreBudget(chantierId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("budgets", "modifier");
    const c = await chantierPour(user, chantierId, "modifier");
    if (c.budgetStatut !== "BROUILLON") return { erreur: "Seul un budget en préparation peut être soumis." };
    const lignes = await db.ligneBudget.findMany({ where: { chantierId } });
    const t = totauxBudget(lignes);
    if (t.initial <= 0) return { erreur: "Le budget est vide." };
    await db.$transaction(async (tx) => {
      await tx.chantier.update({ where: { id: chantierId }, data: { budgetStatut: "SOUMIS", budgetPreparePar: user.id } });
      await evenementChantier(chantierId, "BUDGET", `Budget initial soumis à validation : ${formatXOF(t.initial)}.`, user.id, tx);
      await journaliser(user.id, "SOUMISSION", "Budget", chantierId, { total: t.initial }, tx);
    });
    revalider(chantierId);
    return { succes: "Budget soumis à validation." };
  });
}

export async function deciderBudget(chantierId: string, decision: "VALIDE" | "RENVOI", _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("budgets", "approuver");
    const c = await chantierPour(user, chantierId, "approuver");
    if (c.budgetStatut !== "SOUMIS") return { erreur: "Le budget n'est pas soumis à validation." };
    if (c.budgetPreparePar === user.id) return { erreur: "Vous avez préparé ce budget : sa validation doit être faite par une autre personne habilitée." };
    const motif = texte(fd, "motif", { max: 1000 });
    if (decision === "RENVOI" && !motif) return { erreur: "Indiquez le motif du renvoi." };
    await db.$transaction(async (tx) => {
      await tx.chantier.update({
        where: { id: chantierId },
        data: decision === "VALIDE" ? { budgetStatut: "VALIDE", budgetValidePar: user.id, budgetDateValidation: new Date() } : { budgetStatut: "BROUILLON" },
      });
      await evenementChantier(chantierId, "BUDGET", decision === "VALIDE" ? `Budget initial validé : ${formatXOF(c.budgetInitial)}. Il est désormais figé ; les évolutions passent par le budget actualisé.` : `Budget renvoyé en préparation : ${motif}.`, user.id, tx);
      await journaliser(user.id, decision === "VALIDE" ? "APPROBATION" : "RENVOI", "Budget", chantierId, { motif }, tx);
    });
    revalider(chantierId);
    return { succes: decision === "VALIDE" ? "Budget validé." : "Budget renvoyé." };
  });
}
