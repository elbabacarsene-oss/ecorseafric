import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { ipClient } from "./auth";

export async function journaliser(
  userId: string | null,
  action: string,
  entite: string,
  entiteId: string | null,
  details?: Prisma.InputJsonValue,
  tx: Prisma.TransactionClient = db,
) {
  await tx.journalAudit.create({ data: { userId, action, entite, entiteId, details, ip: await ipClient() } });
}

export async function evenementChantier(
  chantierId: string,
  type: string,
  description: string,
  userId: string | null,
  tx: Prisma.TransactionClient = db,
) {
  await tx.evenementChantier.create({ data: { chantierId, type, description, userId } });
}
