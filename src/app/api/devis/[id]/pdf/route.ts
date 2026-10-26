import { NextResponse } from "next/server";
import { devisAccessible } from "@/lib/acces";
import { utilisateurCourant } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { pdfDevis } from "@/lib/documents-generes";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await utilisateurCourant();
  if (!user) return new NextResponse("Session expirée.", { status: 401 });
  const { id } = await params;
  if (!(await devisAccessible(user, id))) return new NextResponse("Devis introuvable.", { status: 404 });
  const d = await db.devis.findUniqueOrThrow({ where: { id }, select: { numero: true, variante: true, version: true } });
  const pdf = await pdfDevis(id);
  await journaliser(user.id, "EXPORT_PDF", "Devis", id);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Devis_${d.numero}-${d.variante}_v${d.version}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
