import { NextResponse } from "next/server";
import { devisAccessible } from "@/lib/acces";
import { utilisateurCourant } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { excelDevis } from "@/lib/documents-generes";
import { peut } from "@/lib/permissions";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await utilisateurCourant();
  if (!user) return new NextResponse("Session expirée.", { status: 401 });
  const { id } = await params;
  if (!(await devisAccessible(user, id))) return new NextResponse("Devis introuvable.", { status: 404 });
  const d = await db.devis.findUniqueOrThrow({ where: { id }, select: { numero: true, variante: true, version: true } });
  const avecCouts = peut(user.role, "devis_couts", "lire");
  const xlsx = await excelDevis(id, avecCouts);
  await journaliser(user.id, "EXPORT_EXCEL", "Devis", id, { avecCouts });
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Devis_${d.numero}-${d.variante}_v${d.version}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
