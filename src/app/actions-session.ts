"use server";

import { redirect } from "next/navigation";
import { connecter, deconnecter, exigerUtilisateur, hacherMotDePasse, motDePasseValide } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import type { EtatAction } from "@/components/FormulaireAction";

export async function actionConnexion(_: EtatAction, fd: FormData): Promise<EtatAction> {
  const email = String(fd.get("email") ?? "");
  const mdp = String(fd.get("motDePasse") ?? "");
  if (!email || !mdp) return { erreur: "Saisissez votre adresse e-mail et votre mot de passe." };
  const r = await connecter(email, mdp);
  if (!r.ok) return { erreur: r.erreur };
  redirect(r.doitChangerMdp ? "/changer-mot-de-passe" : "/");
}

export async function actionDeconnexion() {
  await deconnecter();
  redirect("/connexion");
}

export async function actionChangerMotDePasse(_: EtatAction, fd: FormData): Promise<EtatAction> {
  const user = await exigerUtilisateur();
  const actuel = String(fd.get("actuel") ?? "");
  const nouveau = String(fd.get("nouveau") ?? "");
  const confirmation = String(fd.get("confirmation") ?? "");
  const u = await db.utilisateur.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await bcrypt.compare(actuel, u.passwordHash))) return { erreur: "Le mot de passe actuel est incorrect." };
  const invalide = motDePasseValide(nouveau);
  if (invalide) return { erreur: invalide };
  if (nouveau !== confirmation) return { erreur: "La confirmation ne correspond pas au nouveau mot de passe." };
  if (nouveau === actuel) return { erreur: "Le nouveau mot de passe doit être différent de l'actuel." };
  await db.utilisateur.update({ where: { id: user.id }, data: { passwordHash: await hacherMotDePasse(nouveau), doitChangerMdp: false } });
  await journaliser(user.id, "CHANGEMENT_MOT_DE_PASSE", "Utilisateur", user.id);
  if (u.doitChangerMdp) redirect("/");
  return { succes: "Mot de passe modifié." };
}
