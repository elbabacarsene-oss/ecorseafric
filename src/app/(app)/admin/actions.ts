"use server";

import { randomInt } from "node:crypto";
import type { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { hacherMotDePasse, verifierPermission } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { coche, email, ErreurSaisie, executer, texte } from "@/lib/formulaire";
import { estExterne, ROLES } from "@/lib/libelles";
import { choix } from "@/lib/formulaire";
import type { EtatAction } from "@/components/FormulaireAction";

/** Mot de passe provisoire lisible (sans caractères ambigus), à changer à la première connexion. */
function motDePasseProvisoire() {
  const lettres = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const chiffres = "23456789";
  let s = "";
  for (let i = 0; i < 9; i++) s += lettres[randomInt(lettres.length)];
  for (let i = 0; i < 3; i++) s += chiffres[randomInt(chiffres.length)];
  return s;
}

async function lireUtilisateur(fd: FormData) {
  const role = choix<Role>(fd, "role", ROLES, { requis: true, libelle: "Rôle" })!;
  const intervenantId = texte(fd, "intervenantId");
  if (estExterne(role) && !intervenantId) {
    throw new ErreurSaisie("Un compte externe (portail) doit être lié à une fiche intervenant : c'est elle qui détermine les chantiers ouverts.");
  }
  if (intervenantId && !(await db.intervenant.findUnique({ where: { id: intervenantId }, select: { id: true } }))) {
    throw new ErreurSaisie("Fiche intervenant introuvable.");
  }
  return {
    email: email(fd, "email", { requis: true, libelle: "E-mail" })!,
    nom: texte(fd, "nom", { requis: true, libelle: "Nom", max: 100 })!,
    prenom: texte(fd, "prenom", { requis: true, libelle: "Prénom", max: 100 })!,
    telephone: texte(fd, "telephone", { max: 40 }),
    role,
    intervenantId,
  };
}

export async function creerUtilisateur(_: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("utilisateurs", "creer");
    const data = await lireUtilisateur(fd);
    const mdp = motDePasseProvisoire();
    const u = await db.utilisateur.create({ data: { ...data, passwordHash: await hacherMotDePasse(mdp), doitChangerMdp: true } });
    await journaliser(user.id, "CREATION", "Utilisateur", u.id, { email: u.email, role: u.role });
    revalidatePath("/admin/utilisateurs");
    return {
      succes: `Compte créé pour ${u.email}. Mot de passe provisoire : ${mdp} — transmettez-le de façon sécurisée ; il ne sera plus affiché. L'utilisateur devra le changer à sa première connexion.`,
    };
  });
}

export async function modifierUtilisateur(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("utilisateurs", "modifier");
    const avant = await db.utilisateur.findUnique({ where: { id } });
    if (!avant) return { erreur: "Utilisateur introuvable." };
    const data = await lireUtilisateur(fd);
    const actif = coche(fd, "actif");
    if (id === user.id && (data.role !== avant.role || !actif)) {
      return { erreur: "Vous ne pouvez ni changer votre propre rôle ni désactiver votre propre compte." };
    }
    await db.$transaction(async (tx) => {
      await tx.utilisateur.update({ where: { id }, data: { ...data, actif } });
      // Un changement de rôle ou une désactivation ferme immédiatement les sessions ouvertes.
      if (data.role !== avant.role || !actif) await tx.session.deleteMany({ where: { userId: id } });
      await journaliser(user.id, "MODIFICATION", "Utilisateur", id, {
        role: avant.role !== data.role ? { avant: avant.role, apres: data.role } : undefined,
        actif: avant.actif !== actif ? { avant: avant.actif, apres: actif } : undefined,
        intervenantId: avant.intervenantId !== data.intervenantId ? { avant: avant.intervenantId, apres: data.intervenantId } : undefined,
      }, tx);
    });
    revalidatePath(`/admin/utilisateurs/${id}`);
    return { succes: "Compte mis à jour." };
  });
}

export async function reinitialiserMotDePasse(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("utilisateurs", "modifier");
    const mdp = motDePasseProvisoire();
    await db.$transaction(async (tx) => {
      await tx.utilisateur.update({ where: { id }, data: { passwordHash: await hacherMotDePasse(mdp), doitChangerMdp: true, tentativesEchouees: 0, verrouilleJusqua: null } });
      await tx.session.deleteMany({ where: { userId: id } });
      await journaliser(user.id, "REINITIALISATION_MOT_DE_PASSE", "Utilisateur", id, undefined, tx);
    });
    return { succes: `Nouveau mot de passe provisoire : ${mdp} — il ne sera plus affiché.` };
  });
}

const MIMES_LOGO = ["image/png", "image/jpeg", "image/webp"];

export async function modifierEntreprise(_: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("entreprise", "modifier");
    const data = {
      raisonSociale: texte(fd, "raisonSociale", { requis: true, libelle: "Raison sociale", max: 200 })!,
      formeJuridique: texte(fd, "formeJuridique", { max: 50 }),
      ninea: texte(fd, "ninea", { max: 40 }),
      rccm: texte(fd, "rccm", { max: 60 }),
      adresse: texte(fd, "adresse", { max: 300 }),
      ville: texte(fd, "ville", { max: 100 }),
      telephone: texte(fd, "telephone", { max: 40 }),
      email: email(fd, "email"),
      siteWeb: texte(fd, "siteWeb", { max: 200 }),
    };
    const fichier = fd.get("logo");
    let logo: { logo: Uint8Array<ArrayBuffer>; logoMime: string } | object = {};
    if (fichier instanceof File && fichier.size > 0) {
      if (!MIMES_LOGO.includes(fichier.type)) throw new ErreurSaisie("Logo : formats acceptés PNG, JPEG ou WebP.");
      if (fichier.size > 1_000_000) throw new ErreurSaisie("Logo : 1 Mo maximum.");
      const octets = new Uint8Array(await fichier.arrayBuffer());
      // Vérifie la signature du fichier, pas seulement le type déclaré par le navigateur.
      const png = octets[0] === 0x89 && octets[1] === 0x50;
      const jpg = octets[0] === 0xff && octets[1] === 0xd8;
      const webp = octets[8] === 0x57 && octets[9] === 0x45;
      if (!png && !jpg && !webp) throw new ErreurSaisie("Logo : le fichier n'est pas une image valide.");
      logo = { logo: octets, logoMime: png ? "image/png" : jpg ? "image/jpeg" : "image/webp" };
    }
    await db.entreprise.upsert({ where: { id: 1 }, create: { id: 1, ...data, ...logo }, update: { ...data, ...logo } });
    await journaliser(user.id, "MODIFICATION", "Entreprise", "1", { logo: "logo" in logo });
    revalidatePath("/", "layout");
    return { succes: "Paramètres de l'entreprise enregistrés." };
  });
}
