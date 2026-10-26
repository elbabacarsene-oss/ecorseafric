import "server-only";
import { db } from "@/lib/db";

export async function tachesDuChantier(chantierId: string): Promise<[string, string][]> {
  const t = await db.tachePlanning.findMany({ where: { chantierId, enfants: { none: {} }, type: "TACHE" }, select: { id: true, nom: true, avancement: true }, orderBy: { ordre: "asc" } });
  return t.map((x) => [x.id, `${x.nom} (${x.avancement} %)`]);
}
