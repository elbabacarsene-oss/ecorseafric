"use server";

import type { CategorieOuvrage, TypeComposant, Unite } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EtatAction } from "@/components/FormulaireAction";
import { verifierPermission } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { choix, coche, ErreurSaisie, executer, nombre, texte } from "@/lib/formulaire";
import { CATEGORIES_OUVRAGE, TYPES_COMPOSANT, UNITES } from "@/lib/libelles";

function lireOuvrage(fd: FormData) {
  return {
    categorie: choix<CategorieOuvrage>(fd, "categorie", CATEGORIES_OUVRAGE, { requis: true, libelle: "Catégorie" })!,
    designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 500 })!,
    unite: choix<Unite>(fd, "unite", UNITES, { requis: true, libelle: "Unité" })!,
    description: texte(fd, "description", { max: 4000 }),
  };
}

export async function creerOuvrage(_: EtatAction, fd: FormData): Promise<EtatAction> {
  let id = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("bibliotheque", "creer");
    const data = lireOuvrage(fd);
    const code = texte(fd, "code", { requis: true, libelle: "Code", max: 30 })!.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_\-.]*$/.test(code)) throw new ErreurSaisie("Le code ne doit contenir que des lettres, chiffres, tirets ou points.");
    const o = await db.ouvrage.create({ data: { ...data, code } });
    await journaliser(user.id, "CREATION", "Ouvrage", o.id, { code });
    id = o.id;
  });
  if (r?.erreur) return r;
  revalidatePath("/bibliotheque");
  redirect(`/bibliotheque/${id}`);
}

export async function modifierOuvrage(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("bibliotheque", "modifier");
    const data = { ...lireOuvrage(fd), actif: coche(fd, "actif") };
    await db.ouvrage.update({ where: { id }, data });
    await journaliser(user.id, "MODIFICATION", "Ouvrage", id, data);
    revalidatePath(`/bibliotheque/${id}`);
    return { succes: "Ouvrage enregistré." };
  });
}

export async function ajouterComposant(ouvrageId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("bibliotheque", "modifier");
    const n = await db.composantOuvrage.count({ where: { ouvrageId } });
    const c = await db.composantOuvrage.create({
      data: {
        ouvrageId,
        ordre: n + 1,
        type: choix<TypeComposant>(fd, "type", TYPES_COMPOSANT, { requis: true, libelle: "Nature" })!,
        designation: texte(fd, "designation", { requis: true, libelle: "Désignation", max: 300 })!,
        unite: choix<Unite>(fd, "unite", UNITES, { requis: true, libelle: "Unité" })!,
        quantite: nombre(fd, "quantite", { requis: true, libelle: "Quantité" })!,
        prixUnitaire: nombre(fd, "prixUnitaire", { requis: true, libelle: "Prix unitaire" })!,
      },
    });
    await journaliser(user.id, "CREATION", "ComposantOuvrage", c.id, { ouvrageId });
    revalidatePath(`/bibliotheque/${ouvrageId}`);
    return { succes: "Composant ajouté.", jeton: Date.now() };
  });
}

export async function supprimerComposant(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("bibliotheque", "modifier");
    const c = await db.composantOuvrage.delete({ where: { id } });
    await journaliser(user.id, "SUPPRESSION", "ComposantOuvrage", id, { ouvrageId: c.ouvrageId });
    revalidatePath(`/bibliotheque/${c.ouvrageId}`);
    return { succes: "Composant retiré." };
  });
}
