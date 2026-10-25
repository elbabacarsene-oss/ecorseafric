import "server-only";
import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { db } from "./db";
import type { UtilisateurConnecte } from "./auth";
import { portee, type Action, type Module } from "./permissions";

/**
 * Filtre Prisma limitant les chantiers à ceux que l'utilisateur peut voir pour une action donnée.
 * Renvoie null si l'utilisateur n'a aucun droit (aucun chantier).
 * Portée « affectes » : chantier où l'intervenant lié au compte a une affectation ;
 * pour un compte externe, l'affectation doit en plus ouvrir l'accès portail.
 */
export function filtreChantiers(user: UtilisateurConnecte, action: Action = "lire", module: Module = "chantiers"): Prisma.ChantierWhereInput | null {
  const p = portee(user.role, module, action);
  if (!p) return null;
  if (p === "tous") return {};
  if (!user.intervenantId) return { id: "__aucun__" };
  return {
    affectations: {
      some: { intervenantId: user.intervenantId, ...(user.externe ? { accesPortail: true } : {}) },
    },
  };
}

/** Vérifie côté serveur que l'utilisateur peut agir sur ce chantier ; sinon 404 (on ne révèle pas son existence). */
export async function chantierAccessible(user: UtilisateurConnecte, chantierId: string, action: Action = "lire", module: Module = "chantiers") {
  const filtre = filtreChantiers(user, action, module);
  if (!filtre) return false;
  const n = await db.chantier.count({ where: { AND: [{ id: chantierId }, filtre] } });
  return n > 0;
}

export async function exigerChantier(user: UtilisateurConnecte, chantierId: string, action: Action = "lire", module: Module = "chantiers") {
  if (!(await chantierAccessible(user, chantierId, action, module))) notFound();
}

export function peutSurChantier(user: UtilisateurConnecte, module: Module, action: Action) {
  return portee(user.role, module, action) !== null;
}
