"use server";

import type { CategorieIntervenant, Prisma, Region, TypeIntervenant } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifierPermission } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { choix, coche, email, executer, texte } from "@/lib/formulaire";
import { categorieDuType, PREFIXE_CODE, REGIONS, TYPES_INTERVENANT } from "@/lib/libelles";
import type { EtatAction } from "@/components/FormulaireAction";

function lireIntervenant(fd: FormData) {
  const type = choix<TypeIntervenant>(fd, "type", TYPES_INTERVENANT, { requis: true, libelle: "Type" })!;
  return {
    type,
    categorie: categorieDuType(type),
    personneMorale: coche(fd, "personneMorale"),
    nom: texte(fd, "nom", { requis: true, libelle: "Nom / raison sociale", max: 200 })!,
    prenom: texte(fd, "prenom", { max: 100 }),
    fonction: texte(fd, "fonction", { max: 150 }),
    entreprise: texte(fd, "entreprise", { max: 200 }),
    telephone: texte(fd, "telephone", { max: 40 }),
    telephone2: texte(fd, "telephone2", { max: 40 }),
    email: email(fd, "email", { libelle: "E-mail" }),
    adresse: texte(fd, "adresse", { max: 300 }),
    ville: texte(fd, "ville", { max: 100 }),
    region: choix<Region>(fd, "region", REGIONS),
    ninea: texte(fd, "ninea", { max: 40 }),
    rccm: texte(fd, "rccm", { max: 60 }),
    notes: texte(fd, "notes", { max: 4000 }),
  };
}

async function prochainCode(categorie: CategorieIntervenant, tx: Prisma.TransactionClient) {
  const prefixe = PREFIXE_CODE[categorie];
  const dernier = await tx.intervenant.findFirst({ where: { code: { startsWith: prefixe + "-" } }, orderBy: { code: "desc" }, select: { code: true } });
  const n = dernier ? Number(dernier.code.split("-")[1]) + 1 : 1;
  return `${prefixe}-${String(n).padStart(4, "0")}`;
}

export async function creerIntervenant(_: EtatAction, fd: FormData): Promise<EtatAction> {
  let id = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("intervenants", "creer");
    const data = lireIntervenant(fd);
    for (let essai = 0; essai < 3 && !id; essai++) {
      try {
        id = await db.$transaction(async (tx) => {
          const code = await prochainCode(data.categorie, tx);
          const i = await tx.intervenant.create({ data: { ...data, code } });
          await journaliser(user.id, "CREATION", "Intervenant", i.id, { code, nom: data.nom }, tx);
          return i.id;
        });
      } catch (e) {
        if (essai === 2) throw e; // conflit de code concurrent : on réessaie
      }
    }
  });
  if (r?.erreur || !id) return r;
  revalidatePath("/intervenants");
  redirect(`/intervenants/${id}`);
}

export async function modifierIntervenant(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  const r = await executer(async () => {
    const { user } = await verifierPermission("intervenants", "modifier");
    const avant = await db.intervenant.findUnique({ where: { id } });
    if (!avant) return { erreur: "Intervenant introuvable." };
    const data = lireIntervenant(fd);
    await db.$transaction(async (tx) => {
      await tx.intervenant.update({ where: { id }, data });
      const modifs = Object.fromEntries(
        Object.entries(data).filter(([k, v]) => String(avant[k as keyof typeof avant] ?? "") !== String(v ?? "")).map(([k, v]) => [k, { avant: avant[k as keyof typeof avant] as string | null, apres: v }]),
      );
      await journaliser(user.id, "MODIFICATION", "Intervenant", id, modifs as Prisma.InputJsonValue, tx);
    });
  });
  if (r?.erreur) return r;
  revalidatePath(`/intervenants/${id}`);
  redirect(`/intervenants/${id}`);
}

export async function basculerActifIntervenant(id: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("intervenants", "supprimer");
    const i = await db.intervenant.findUnique({ where: { id } });
    if (!i) return { erreur: "Intervenant introuvable." };
    await db.intervenant.update({ where: { id }, data: { actif: !i.actif } });
    await journaliser(user.id, i.actif ? "DESACTIVATION" : "REACTIVATION", "Intervenant", id);
    revalidatePath(`/intervenants/${id}`);
    return { succes: i.actif ? "Intervenant désactivé." : "Intervenant réactivé." };
  });
}
