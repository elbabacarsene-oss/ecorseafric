import "server-only";
import type { Prisma } from "@prisma/client";

/** Prochain code annuel séquentiel : PREFIXE-AAAA-NNN (ex. CH-2026-004, DV-2026-012). */
async function prochain(dernier: string | null | undefined, prefixe: string) {
  const n = dernier ? Number(dernier.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(n).padStart(3, "0")}`;
}

export async function prochainCodeChantier(tx: Prisma.TransactionClient) {
  const prefixe = `CH-${new Date().getUTCFullYear()}-`;
  const d = await tx.chantier.findFirst({ where: { code: { startsWith: prefixe } }, orderBy: { code: "desc" }, select: { code: true } });
  return prochain(d?.code, prefixe);
}

export async function prochainNumeroDevis(tx: Prisma.TransactionClient) {
  const prefixe = `DV-${new Date().getUTCFullYear()}-`;
  const d = await tx.devis.findFirst({ where: { numero: { startsWith: prefixe } }, orderBy: { numero: "desc" }, select: { numero: true } });
  return prochain(d?.numero, prefixe);
}
