"use server";

import type { TypeTache } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { EtatAction } from "@/components/FormulaireAction";
import { chantierAccessible } from "@/lib/acces";
import { AccesRefuse, verifierPermission, type UtilisateurConnecte } from "@/lib/auth";
import { evenementChantier, journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { majEnveloppes } from "@/lib/planning-db";
import { formatDate } from "@/lib/format";
import { coche, date, entier, ErreurSaisie, executer, texte } from "@/lib/formulaire";
import { cheminCritique, jourNum, trouverCycle } from "@/lib/planning-calculs";

type Act = "creer" | "modifier" | "supprimer";

async function tachePour(user: UtilisateurConnecte, id: string, action: Act) {
  const t = await db.tachePlanning.findUnique({ where: { id }, include: { _count: { select: { enfants: true } } } });
  if (!t || !(await chantierAccessible(user, t.chantierId, action, "planning"))) throw new AccesRefuse("Tâche introuvable ou non autorisée.");
  return t;
}

const revalider = (chantierId: string) => {
  revalidatePath(`/chantiers/${chantierId}/planning`);
  revalidatePath(`/chantiers/${chantierId}`);
  revalidatePath("/");
};

async function lireTache(fd: FormData, chantierId: string, tacheId?: string) {
  const type = (texte(fd, "type") === "JALON" ? "JALON" : "TACHE") as TypeTache;
  const debutPrevu = date(fd, "debutPrevu", { requis: true, libelle: type === "JALON" ? "Date du jalon" : "Début prévu" })!;
  const finPrevue = type === "JALON" ? debutPrevu : date(fd, "finPrevue", { requis: true, libelle: "Fin prévue" })!;
  if (finPrevue < debutPrevu) throw new ErreurSaisie("La fin prévue doit être postérieure ou égale au début prévu.");
  const parentId = texte(fd, "parentId");
  if (parentId) {
    if (parentId === tacheId) throw new ErreurSaisie("Une tâche ne peut pas être sa propre tâche parente.");
    const p = await db.tachePlanning.findUnique({ where: { id: parentId }, include: { _count: { select: { predecesseurs: true, successeurs: true } } } });
    if (!p || p.chantierId !== chantierId) throw new ErreurSaisie("Tâche parente introuvable.");
    if (p.type === "JALON") throw new ErreurSaisie("Un jalon ne peut pas avoir de sous-tâches.");
    if (p._count.predecesseurs + p._count.successeurs > 0) throw new ErreurSaisie("La tâche parente a des dépendances : placez les dépendances sur les sous-tâches.");
    // Pas de boucle parent → enfant
    let x: string | null = p.parentId;
    while (x) {
      if (x === tacheId) throw new ErreurSaisie("Cette tâche parente est déjà une sous-tâche de la tâche modifiée.");
      x = (await db.tachePlanning.findUnique({ where: { id: x }, select: { parentId: true } }))?.parentId ?? null;
    }
  }
  const intervenant = async (nom: string) => {
    const id = texte(fd, nom);
    if (id && !(await db.intervenant.findUnique({ where: { id }, select: { id: true } }))) throw new ErreurSaisie("Intervenant introuvable.");
    return id;
  };
  return {
    nom: texte(fd, "nom", { requis: true, libelle: "Nom", max: 200 })!,
    type,
    parentId,
    lot: texte(fd, "lot", { max: 150 }),
    corpsEtat: texte(fd, "corpsEtat", { max: 150 }),
    equipe: texte(fd, "equipe", { max: 150 }),
    responsableId: await intervenant("responsableId"),
    intervenantId: await intervenant("intervenantId"),
    debutPrevu,
    finPrevue,
    importante: coche(fd, "importante"),
    ressources: texte(fd, "ressources", { max: 500 }),
  };
}

export async function creerTache(chantierId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "creer");
    if (!(await chantierAccessible(user, chantierId, "creer", "planning"))) throw new AccesRefuse("Chantier non autorisé.");
    const data = await lireTache(fd, chantierId);
    await db.$transaction(async (tx) => {
      const m = await tx.tachePlanning.aggregate({ where: { chantierId }, _max: { ordre: true } });
      const t = await tx.tachePlanning.create({ data: { ...data, chantierId, ordre: (m._max.ordre ?? 0) + 1 } });
      await majEnveloppes(tx, chantierId);
      await journaliser(user.id, "CREATION", "TachePlanning", t.id, { chantierId, nom: data.nom }, tx);
    });
    revalider(chantierId);
    return { succes: data.type === "JALON" ? "Jalon ajouté." : "Tâche ajoutée.", jeton: Date.now() };
  });
}

export async function modifierTache(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "modifier");
    const t = await tachePour(user, id, "modifier");
    const data = await lireTache(fd, t.chantierId, id);
    const debutReel = date(fd, "debutReel", { libelle: "Début réel" });
    const finReelle = date(fd, "finReelle", { libelle: "Fin réelle" });
    if (debutReel && finReelle && finReelle < debutReel) throw new ErreurSaisie("La fin réelle doit suivre le début réel.");
    const avancement = t._count.enfants ? t.avancement : finReelle ? 100 : entier(fd, "avancement", { libelle: "Avancement", min: 0 });
    if (avancement > 100) throw new ErreurSaisie("L'avancement ne peut pas dépasser 100 %.");
    await db.$transaction(async (tx) => {
      await tx.tachePlanning.update({
        where: { id },
        data: { ...data, ...(t._count.enfants ? { debutPrevu: t.debutPrevu, finPrevue: t.finPrevue, type: "TACHE" } : {}), debutReel, finReelle, avancement },
      });
      await majEnveloppes(tx, t.chantierId);
      const glissement = jourNum(data.finPrevue) - jourNum(t.finPrevue);
      if (t.importante && glissement > 0 && !t._count.enfants) {
        await evenementChantier(t.chantierId, "PLANNING", `Tâche importante « ${t.nom} » décalée de ${glissement} jour(s) : fin prévue ${formatDate(data.finPrevue)}.`, user.id, tx);
      }
      await journaliser(user.id, "MODIFICATION", "TachePlanning", id, { avant: { fin: t.finPrevue.toISOString().slice(0, 10), avancement: t.avancement }, apres: { fin: data.finPrevue.toISOString().slice(0, 10), avancement } }, tx);
    });
    revalider(t.chantierId);
    return { succes: "Tâche enregistrée." };
  });
}

export async function supprimerTache(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "supprimer");
    const t = await tachePour(user, id, "supprimer");
    await db.$transaction(async (tx) => {
      await tx.tachePlanning.delete({ where: { id } }); // sous-tâches et dépendances supprimées en cascade
      await majEnveloppes(tx, t.chantierId);
      await journaliser(user.id, "SUPPRESSION", "TachePlanning", id, { nom: t.nom, sousTaches: t._count.enfants }, tx);
    });
    revalider(t.chantierId);
    return { succes: "Tâche supprimée." };
  });
}

export async function ajouterDependance(successeurId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "modifier");
    const s = await tachePour(user, successeurId, "modifier");
    const predecesseurId = texte(fd, "predecesseurId", { requis: true, libelle: "Tâche précédente" })!;
    const decalageJours = entier(fd, "decalageJours", { libelle: "Décalage", min: -365 });
    const p = await tachePour(user, predecesseurId, "modifier");
    if (p.chantierId !== s.chantierId || p.id === s.id) throw new ErreurSaisie("Dépendance invalide.");
    if (p._count.enfants || s._count.enfants) throw new ErreurSaisie("Les dépendances se placent entre tâches élémentaires (sans sous-tâches).");
    const taches = await db.tachePlanning.findMany({ where: { chantierId: s.chantierId }, select: { id: true } });
    const deps = await db.dependanceTache.findMany({ where: { successeur: { chantierId: s.chantierId } } });
    const cycle = trouverCycle(taches.map((x) => x.id), [...deps, { predecesseurId, successeurId, decalageJours }]);
    if (cycle) throw new ErreurSaisie("Cette dépendance créerait une boucle dans le planning.");
    await db.dependanceTache.create({ data: { predecesseurId, successeurId, decalageJours } });
    await journaliser(user.id, "CREATION", "DependanceTache", successeurId, { predecesseurId, decalageJours });
    revalider(s.chantierId);
    return { succes: "Dépendance ajoutée.", jeton: Date.now() };
  });
}

export async function supprimerDependance(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "modifier");
    const d = await db.dependanceTache.findUnique({ where: { id } });
    if (!d) throw new AccesRefuse("Dépendance introuvable.");
    const s = await tachePour(user, d.successeurId, "modifier");
    await db.dependanceTache.delete({ where: { id } });
    await journaliser(user.id, "SUPPRESSION", "DependanceTache", id, { predecesseurId: d.predecesseurId, successeurId: d.successeurId });
    revalider(s.chantierId);
    return { succes: "Dépendance retirée." };
  });
}

/** Décale les tâches qui ne respectent pas leurs dépendances (sans jamais avancer une tâche). */
export async function recalculerPlanning(chantierId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "modifier");
    if (!(await chantierAccessible(user, chantierId, "modifier", "planning"))) throw new AccesRefuse("Chantier non autorisé.");
    const taches = await db.tachePlanning.findMany({ where: { chantierId }, include: { _count: { select: { enfants: true } } } });
    const feuilles = taches.filter((t) => !t._count.enfants);
    const deps = await db.dependanceTache.findMany({ where: { successeur: { chantierId } } });
    const r = cheminCritique(feuilles, deps);
    const deplacees = feuilles.filter((t) => r.dates.get(t.id)!.debut.getTime() !== t.debutPrevu.getTime());
    if (!deplacees.length) return { succes: "Toutes les dépendances sont respectées : aucune date modifiée." };
    await db.$transaction(async (tx) => {
      for (const t of deplacees) {
        const d = r.dates.get(t.id)!;
        await tx.tachePlanning.update({ where: { id: t.id }, data: { debutPrevu: d.debut, finPrevue: d.fin } });
      }
      await majEnveloppes(tx, chantierId);
      await evenementChantier(chantierId, "PLANNING", `Planning recalculé : ${deplacees.length} tâche(s) décalée(s) pour respecter les enchaînements (${deplacees.map((t) => t.nom).slice(0, 5).join(", ")}${deplacees.length > 5 ? "…" : ""}).`, user.id, tx);
      await journaliser(user.id, "RECALCUL", "Planning", chantierId, { taches: deplacees.map((t) => t.id) }, tx);
    });
    revalider(chantierId);
    return { succes: `${deplacees.length} tâche(s) décalée(s).` };
  });
}

/** Fige le planning actuel comme planning de référence (initial) pour mesurer les écarts. */
export async function figerReference(chantierId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("planning", "modifier");
    if (!(await chantierAccessible(user, chantierId, "modifier", "planning"))) throw new AccesRefuse("Chantier non autorisé.");
    const n = await db.tachePlanning.count({ where: { chantierId } });
    if (!n) return { erreur: "Le planning est vide." };
    const c = await db.chantier.findUniqueOrThrow({ where: { id: chantierId }, select: { planningReferenceLe: true } });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "TachePlanning" SET "debutReference" = "debutPrevu", "finReference" = "finPrevue" WHERE "chantierId" = ${chantierId}`;
      await tx.chantier.update({ where: { id: chantierId }, data: { planningReferenceLe: new Date() } });
      await evenementChantier(chantierId, "PLANNING", c.planningReferenceLe ? `Nouveau planning de référence figé (le précédent datait du ${formatDate(c.planningReferenceLe)}).` : "Planning de référence figé.", user.id, tx);
      await journaliser(user.id, "REFERENCE", "Planning", chantierId, { taches: n }, tx);
    });
    revalider(chantierId);
    return { succes: "Planning de référence enregistré." };
  });
}
