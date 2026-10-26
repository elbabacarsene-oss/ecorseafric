"use server";

import type { Meteo } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/FormulaireAction";
import { chantierAccessible } from "@/lib/acces";
import { AccesRefuse, verifierPermission, type UtilisateurConnecte } from "@/lib/auth";
import { evenementChantier, journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { majEnveloppes } from "@/lib/planning-db";
import { aujourdhuiDakar, formatDate } from "@/lib/format";
import { choix, coche, date, ErreurSaisie, executer, texte } from "@/lib/formulaire";
import { METEOS } from "@/lib/libelles";
import { empreinteContenu, lireMateriaux, lireMateriel, lirePersonnel, lireTravaux, totauxPersonnel, type LigneTravaux } from "@/lib/rapports";

async function lireRapport(fd: FormData, chantierId: string) {
  const d = date(fd, "date", { requis: true, libelle: "Date" })!;
  if (d > aujourdhuiDakar()) throw new ErreurSaisie("Un rapport journalier ne peut pas être daté dans le futur.");
  const taches = await db.tachePlanning.findMany({ where: { chantierId }, select: { id: true } });
  const personnel = lirePersonnel(fd);
  const tot = totauxPersonnel(personnel);
  return {
    date: d,
    meteo: choix<Meteo>(fd, "meteo", METEOS),
    meteoDetails: texte(fd, "meteoDetails", { max: 200 }),
    personnel,
    effectifTotal: tot.effectif,
    heuresTravaillees: tot.heures,
    travaux: lireTravaux(fd, new Set(taches.map((t) => t.id))),
    materiauxConsommes: lireMateriaux(fd, "consommes"),
    materiauxLivres: lireMateriaux(fd, "livres"),
    materiel: lireMateriel(fd),
    travauxRealises: texte(fd, "travauxRealises", { max: 5000 }),
    incidents: texte(fd, "incidents", { max: 3000 }),
    difficultes: texte(fd, "difficultes", { max: 3000 }),
    instructions: texte(fd, "instructions", { max: 3000 }),
    observations: texte(fd, "observations", { max: 3000 }),
  };
}

async function rapportPour(user: UtilisateurConnecte, id: string, action: "modifier" | "approuver") {
  const r = await db.rapportJournalier.findUnique({ where: { id } });
  if (!r || !(await chantierAccessible(user, r.chantierId, action, "rapports"))) throw new AccesRefuse("Rapport introuvable ou non autorisé.");
  return r;
}

const revalider = (r: { id: string; chantierId: string }) => {
  revalidatePath("/rapports");
  revalidatePath(`/rapports/${r.id}`);
  revalidatePath(`/chantiers/${r.chantierId}`);
};

export async function creerRapport(_: EtatAction, fd: FormData): Promise<EtatAction> {
  let id = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("rapports", "creer");
    const chantierId = texte(fd, "chantierId", { requis: true, libelle: "Chantier" })!;
    if (!(await chantierAccessible(user, chantierId, "creer", "rapports"))) throw new AccesRefuse("Chantier non autorisé.");
    const data = await lireRapport(fd, chantierId);
    const existe = await db.rapportJournalier.findUnique({ where: { chantierId_date: { chantierId, date: data.date } }, select: { id: true } });
    if (existe) throw new ErreurSaisie(`Un rapport existe déjà pour ce chantier le ${formatDate(data.date)} : complétez-le plutôt que d'en créer un second.`);
    const soumettre = coche(fd, "soumettre");
    const rap = await db.rapportJournalier.create({
      data: { ...data, chantierId, redacteurId: user.id, statut: soumettre ? "SOUMIS" : "BROUILLON", soumisLe: soumettre ? new Date() : null },
    });
    await journaliser(user.id, "CREATION", "RapportJournalier", rap.id, { chantierId, date: data.date.toISOString().slice(0, 10), soumis: soumettre });
    id = rap.id;
    revalider(rap);
  });
  if (r?.erreur || !id) return r;
  redirect(`/rapports/${id}`);
}

export async function modifierRapport(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  const r = await executer(async () => {
    const { user } = await verifierPermission("rapports", "modifier");
    const rap = await rapportPour(user, id, "modifier");
    if (rap.statut !== "BROUILLON") throw new ErreurSaisie("Seul un rapport en brouillon peut être modifié.");
    const data = await lireRapport(fd, rap.chantierId);
    if (data.date.getTime() !== rap.date.getTime()) {
      const existe = await db.rapportJournalier.findUnique({ where: { chantierId_date: { chantierId: rap.chantierId, date: data.date } }, select: { id: true } });
      if (existe) throw new ErreurSaisie("Un autre rapport existe déjà à cette date.");
    }
    const soumettre = coche(fd, "soumettre");
    await db.rapportJournalier.update({ where: { id }, data: { ...data, ...(soumettre && { statut: "SOUMIS", soumisLe: new Date() }) } });
    await journaliser(user.id, "MODIFICATION", "RapportJournalier", id, { soumis: soumettre });
    revalider(rap);
  });
  if (r?.erreur) return r;
  redirect(`/rapports/${id}`);
}

export async function soumettreRapport(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("rapports", "modifier");
    const rap = await rapportPour(user, id, "modifier");
    if (rap.statut !== "BROUILLON") return { erreur: "Le rapport n'est pas en brouillon." };
    await db.rapportJournalier.update({ where: { id }, data: { statut: "SOUMIS", soumisLe: new Date(), motifRenvoi: null } });
    await journaliser(user.id, "SOUMISSION", "RapportJournalier", id);
    revalider(rap);
    return { succes: "Rapport soumis à validation." };
  });
}

export async function deciderRapport(id: string, decision: "VALIDE" | "RENVOI", _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("rapports", "approuver");
    const rap = await rapportPour(user, id, "approuver");
    if (rap.statut !== "SOUMIS") return { erreur: "Seul un rapport soumis peut être validé ou renvoyé." };
    if (rap.redacteurId === user.id) return { erreur: "Vous avez rédigé ce rapport : sa validation doit être faite par une autre personne habilitée." };
    if (decision === "RENVOI") {
      const motif = texte(fd, "motif", { requis: true, libelle: "Motif du renvoi", max: 1000 })!;
      await db.rapportJournalier.update({ where: { id }, data: { statut: "BROUILLON", motifRenvoi: motif } });
      await journaliser(user.id, "RENVOI", "RapportJournalier", id, { motif });
      revalider(rap);
      return { succes: "Rapport renvoyé pour correction." };
    }
    const valideLe = new Date();
    const photos = await db.document.findMany({ where: { rapportId: id }, select: { versions: { select: { empreinte: true } } } });
    const empreinte = empreinteContenu({
      chantierId: rap.chantierId, date: rap.date, redacteurId: rap.redacteurId, meteo: rap.meteo, meteoDetails: rap.meteoDetails,
      personnel: rap.personnel, travaux: rap.travaux, materiauxConsommes: rap.materiauxConsommes, materiauxLivres: rap.materiauxLivres,
      materiel: rap.materiel, travauxRealises: rap.travauxRealises, incidents: rap.incidents, difficultes: rap.difficultes,
      instructions: rap.instructions, observations: rap.observations, photos: photos.flatMap((p) => p.versions.map((v) => v.empreinte)).sort(),
      validePar: user.id, valideLe,
    });
    const travaux = (rap.travaux as LigneTravaux[]).filter((t) => t.tacheId && t.avancement !== null);
    await db.$transaction(async (tx) => {
      await tx.rapportJournalier.update({ where: { id }, data: { statut: "VALIDE", validePar: user.id, valideLe, empreinteValidation: empreinte, motifRenvoi: null } });
      // Report de l'avancement déclaré sur les tâches du planning
      for (const t of travaux) {
        const tache = await tx.tachePlanning.findUnique({ where: { id: t.tacheId! }, select: { chantierId: true, debutReel: true, avancement: true, _count: { select: { enfants: true } } } });
        if (!tache || tache.chantierId !== rap.chantierId || tache._count.enfants) continue;
        await tx.tachePlanning.update({
          where: { id: t.tacheId! },
          data: {
            avancement: t.avancement!,
            ...(!tache.debutReel && t.avancement! > 0 && { debutReel: rap.date }),
            ...(t.avancement === 100 && { finReelle: rap.date }),
          },
        });
      }
      if (travaux.length) await majEnveloppes(tx, rap.chantierId);
      await evenementChantier(rap.chantierId, "RAPPORT", `Rapport journalier du ${formatDate(rap.date)} validé (${rap.effectifTotal} personne(s))${travaux.length ? ` ; avancement reporté sur ${travaux.length} tâche(s)` : ""}${rap.incidents ? ". Incident signalé." : "."}`, user.id, tx);
      await journaliser(user.id, "APPROBATION", "RapportJournalier", id, { empreinte }, tx);
    });
    revalider(rap);
    revalidatePath(`/chantiers/${rap.chantierId}/planning`);
    return { succes: "Rapport validé." };
  });
}
