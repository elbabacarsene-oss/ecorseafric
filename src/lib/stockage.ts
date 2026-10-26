import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { ErreurSaisie } from "./formulaire";
import { detecterType, FORMATS_ACCEPTES, nomFichierSur, type TypeFichier } from "./types-fichiers";

/**
 * Stockage des fichiers : en base PostgreSQL (table Fichier), donc couvert par les sauvegardes de la base
 * et servi uniquement par une route qui vérifie les droits. Taille maximale par fichier configurable
 * (TAILLE_MAX_FICHIER_MO, 4 Mo par défaut : limite des requêtes sur Vercel).
 */
export const TAILLE_MAX_MO = Number(process.env.TAILLE_MAX_FICHIER_MO ?? 4);

export type FichierRecu = { octets: Buffer; nom: string; type: TypeFichier; taille: number; empreinte: string };

export async function lireFichier(f: FormDataEntryValue | null, opts: { libelle?: string; imagesSeulement?: boolean } = {}): Promise<FichierRecu | null> {
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > TAILLE_MAX_MO * 1024 * 1024) {
    throw new ErreurSaisie(`« ${f.name} » dépasse la taille maximale de ${TAILLE_MAX_MO} Mo.`);
  }
  const octets = Buffer.from(await f.arrayBuffer());
  const type = detecterType(octets, f.name);
  if (!type) throw new ErreurSaisie(`Format de « ${f.name} » non accepté. Formats acceptés : ${FORMATS_ACCEPTES}.`);
  if (opts.imagesSeulement && !type.image) throw new ErreurSaisie(`« ${f.name} » n'est pas une image (JPEG, PNG ou WebP).`);
  return { octets, nom: nomFichierSur(f.name), type, taille: octets.length, empreinte: createHash("sha256").update(octets).digest("hex") };
}

export async function enregistrerFichier(tx: Prisma.TransactionClient, f: FichierRecu) {
  return tx.fichier.create({ data: { contenu: new Uint8Array(f.octets) }, select: { id: true } });
}
