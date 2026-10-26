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

// ═════════════ Étape 2 ═════════════

/** Devis visibles : tous (portée « tous »), ou ceux des chantiers affectés et ceux que l'on a préparés. */
export function filtreDevis(user: UtilisateurConnecte, action: Action = "lire"): Prisma.DevisWhereInput | null {
  const p = portee(user.role, "devis", action);
  if (!p || user.externe) return null;
  if (p === "tous") return {};
  return { OR: [{ chantier: filtreChantiers(user, action, "devis")! }, { preparePar: user.id }] };
}

export async function devisAccessible(user: UtilisateurConnecte, devisId: string, action: Action = "lire") {
  const f = filtreDevis(user, action);
  if (!f) return false;
  return (await db.devis.count({ where: { AND: [{ id: devisId }, f] } })) > 0;
}

/** Documents visibles dans la bibliothèque. Les comptes externes ne voient que ce qui est partagé avec leur rôle. */
export function filtreDocuments(user: UtilisateurConnecte, action: Action = "lire"): Prisma.DocumentWhereInput | null {
  const p = portee(user.role, "documents", action);
  if (!p) return null;
  const chantiers = filtreChantiers(user, action, "documents")!;
  if (user.externe) return { chantier: chantiers, partageExterne: { has: user.role }, archive: false };
  if (p === "tous") return {};
  return { chantier: chantiers };
}

type DocAcces = { chantierId: string | null; devisId: string | null; partageExterne: string[] };

/** Contrôle d'accès à un document (et donc à ses fichiers). */
export async function documentAccessible(user: UtilisateurConnecte, doc: DocAcces, action: Action = "lire") {
  const p = portee(user.role, "documents", action);
  if (!p) return false;
  if (user.externe) {
    return action === "lire" && !!doc.chantierId && doc.partageExterne.includes(user.role) && (await chantierAccessible(user, doc.chantierId, "lire", "documents"));
  }
  if (doc.chantierId) return chantierAccessible(user, doc.chantierId, action, "documents");
  if (doc.devisId) return devisAccessible(user, doc.devisId, action === "lire" ? "lire" : "modifier");
  return p === "tous";
}
