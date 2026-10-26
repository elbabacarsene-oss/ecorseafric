import "server-only";
import { filtreChantiers } from "@/lib/acces";
import type { UtilisateurConnecte } from "@/lib/auth";
import { db } from "@/lib/db";

export async function optionsDevis(user: UtilisateurConnecte) {
  const [clients, chantiers] = await Promise.all([
    db.intervenant.findMany({ where: { actif: true, categorie: "MAITRISE_OUVRAGE" }, select: { id: true, nom: true, prenom: true, code: true }, orderBy: { nom: "asc" } }),
    db.chantier.findMany({ where: filtreChantiers(user, "lire", "devis") ?? { id: "__aucun__" }, select: { id: true, code: true, nom: true }, orderBy: { code: "desc" } }),
  ]);
  return {
    clients: clients.map((c) => [c.id, `${c.nom}${c.prenom ? " " + c.prenom : ""} (${c.code})`] as [string, string]),
    chantiers: chantiers.map((c) => [c.id, `${c.code} · ${c.nom}`] as [string, string]),
  };
}
