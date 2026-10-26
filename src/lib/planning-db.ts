import "server-only";
import type { Prisma } from "@prisma/client";
import { jourNum } from "./planning-calculs";

/** Les tâches récapitulatives prennent les dates extrêmes et l'avancement pondéré de leurs sous-tâches. */
export async function majEnveloppes(tx: Prisma.TransactionClient, chantierId: string) {
  for (let passe = 0; passe < 6; passe++) {
    const taches = await tx.tachePlanning.findMany({ where: { chantierId }, select: { id: true, parentId: true, debutPrevu: true, finPrevue: true, avancement: true, type: true } });
    let change = false;
    for (const p of taches) {
      const enfants = taches.filter((e) => e.parentId === p.id);
      if (!enfants.length) continue;
      const debut = new Date(Math.min(...enfants.map((e) => e.debutPrevu.getTime())));
      const fin = new Date(Math.max(...enfants.map((e) => e.finPrevue.getTime())));
      const poids = enfants.map((e) => (e.type === "JALON" ? 0 : jourNum(e.finPrevue) - jourNum(e.debutPrevu) + 1));
      const total = poids.reduce((s, x) => s + x, 0);
      const avancement = total ? Math.round(enfants.reduce((s, e, i) => s + e.avancement * poids[i], 0) / total) : 0;
      if (debut.getTime() !== p.debutPrevu.getTime() || fin.getTime() !== p.finPrevue.getTime() || avancement !== p.avancement) {
        await tx.tachePlanning.update({ where: { id: p.id }, data: { debutPrevu: debut, finPrevue: fin, avancement, type: "TACHE" } });
        change = true;
      }
    }
    if (!change) return;
  }
}

