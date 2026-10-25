import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { db } from "./db";
import { portee, type Action, type Module, type Portee } from "./permissions";
import { estExterne } from "./libelles";

export const COOKIE_SESSION = "ecorse_session";
const DUREE_MAX_MS = 12 * 3600_000; // durée absolue d'une session
const INACTIVITE_MAX_MS = 2 * 3600_000; // déconnexion après 2 h d'inactivité
const MAX_TENTATIVES = 5;
const VERROUILLAGE_MS = 15 * 60_000;
export const LONGUEUR_MIN_MDP = 10;

export type UtilisateurConnecte = {
  id: string;
  email: string;
  nom: string;
  prenom: string;
  role: Role;
  intervenantId: string | null;
  externe: boolean;
  doitChangerMdp: boolean;
};

const empreinte = (jeton: string) => createHash("sha256").update(jeton).digest("hex");

export async function hacherMotDePasse(mdp: string) {
  return bcrypt.hash(mdp, 12);
}

export function motDePasseValide(mdp: string): string | null {
  if (mdp.length < LONGUEUR_MIN_MDP) return `Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MDP} caractères.`;
  if (!/[A-Za-z]/.test(mdp) || !/\d/.test(mdp)) return "Le mot de passe doit contenir des lettres et des chiffres.";
  return null;
}

async function infosClient() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  };
}

export async function ipClient() {
  return (await infosClient()).ip;
}

// Empreinte bcrypt factice : compare quand même un mot de passe si le compte n'existe pas,
// pour que le temps de réponse ne révèle pas l'existence d'un compte.
const HASH_FACTICE = "$2b$12$j/D0QhWoD3Vl8sjb85i0f.YHE7uhw7Y7.c2ZMec1c6pPlBShczm6u";

export async function connecter(email: string, mdp: string): Promise<{ ok: true; doitChangerMdp: boolean } | { ok: false; erreur: string }> {
  const { ip, userAgent } = await infosClient();
  const user = await db.utilisateur.findUnique({ where: { email: email.trim().toLowerCase() } });
  const erreurGenerique = { ok: false as const, erreur: "Adresse e-mail ou mot de passe incorrect." };

  if (!user) {
    await bcrypt.compare(mdp, HASH_FACTICE);
    await db.journalAudit.create({ data: { action: "ECHEC_CONNEXION", entite: "Utilisateur", details: { email }, ip } });
    return erreurGenerique;
  }
  if (user.verrouilleJusqua && user.verrouilleJusqua > new Date()) {
    return { ok: false, erreur: "Compte temporairement verrouillé après plusieurs échecs. Réessayez dans 15 minutes." };
  }
  const valide = await bcrypt.compare(mdp, user.passwordHash);
  if (!valide || !user.actif) {
    const tentatives = user.tentativesEchouees + 1;
    await db.utilisateur.update({
      where: { id: user.id },
      data: {
        tentativesEchouees: tentatives >= MAX_TENTATIVES ? 0 : tentatives,
        verrouilleJusqua: tentatives >= MAX_TENTATIVES ? new Date(Date.now() + VERROUILLAGE_MS) : user.verrouilleJusqua,
      },
    });
    await db.journalAudit.create({
      data: { userId: user.id, action: tentatives >= MAX_TENTATIVES ? "VERROUILLAGE_COMPTE" : "ECHEC_CONNEXION", entite: "Utilisateur", entiteId: user.id, ip },
    });
    return erreurGenerique;
  }

  const jeton = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DUREE_MAX_MS);
  await db.$transaction([
    db.session.create({ data: { id: empreinte(jeton), userId: user.id, expiresAt, ip, userAgent } }),
    db.utilisateur.update({ where: { id: user.id }, data: { tentativesEchouees: 0, verrouilleJusqua: null, derniereConnexion: new Date() } }),
    db.journalAudit.create({ data: { userId: user.id, action: "CONNEXION", entite: "Utilisateur", entiteId: user.id, ip } }),
  ]);
  (await cookies()).set(COOKIE_SESSION, jeton, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "1",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { ok: true, doitChangerMdp: user.doitChangerMdp };
}

export async function deconnecter() {
  const store = await cookies();
  const jeton = store.get(COOKIE_SESSION)?.value;
  if (jeton) {
    const s = await db.session.findUnique({ where: { id: empreinte(jeton) } });
    if (s) {
      await db.session.delete({ where: { id: s.id } });
      await db.journalAudit.create({ data: { userId: s.userId, action: "DECONNEXION", entite: "Utilisateur", entiteId: s.userId } });
    }
  }
  store.delete(COOKIE_SESSION);
}

/** Utilisateur de la requête courante (session vérifiée en base), ou null. */
export const utilisateurCourant = cache(async (): Promise<UtilisateurConnecte | null> => {
  const jeton = (await cookies()).get(COOKIE_SESSION)?.value;
  if (!jeton) return null;
  const session = await db.session.findUnique({ where: { id: empreinte(jeton) }, include: { user: true } });
  if (!session) return null;
  const maintenant = Date.now();
  if (session.expiresAt.getTime() < maintenant || session.lastSeenAt.getTime() + INACTIVITE_MAX_MS < maintenant || !session.user.actif) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (maintenant - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    nom: u.nom,
    prenom: u.prenom,
    role: u.role,
    intervenantId: u.intervenantId,
    externe: estExterne(u.role),
    doitChangerMdp: u.doitChangerMdp,
  };
});

export async function exigerUtilisateur(): Promise<UtilisateurConnecte> {
  const u = await utilisateurCourant();
  if (!u) redirect("/connexion");
  return u;
}

export class AccesRefuse extends Error {
  constructor(message = "Accès refusé") {
    super(message);
  }
}

/** Pour les pages : redirige vers /acces-refuse si l'utilisateur n'a pas le droit. */
export async function exigerPermission(module: Module, action: Action): Promise<{ user: UtilisateurConnecte; portee: Portee }> {
  const user = await exigerUtilisateur();
  const p = portee(user.role, module, action);
  if (!p) redirect("/acces-refuse");
  return { user, portee: p };
}

/** Pour les actions serveur : lève une erreur au lieu de rediriger. */
export async function verifierPermission(module: Module, action: Action): Promise<{ user: UtilisateurConnecte; portee: Portee }> {
  const user = await utilisateurCourant();
  if (!user) throw new AccesRefuse("Session expirée. Reconnectez-vous.");
  const p = portee(user.role, module, action);
  if (!p) throw new AccesRefuse("Vous n'avez pas l'autorisation d'effectuer cette opération.");
  return { user, portee: p };
}
