import { NextResponse } from "next/server";
import { chantierAccessible } from "@/lib/acces";
import { utilisateurCourant } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { pdfRapport } from "@/lib/documents-generes";
import { peut } from "@/lib/permissions";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await utilisateurCourant();
  if (!user) return new NextResponse("Session expirée.", { status: 401 });
  const { id } = await params;
  const r = await db.rapportJournalier.findUnique({ where: { id }, select: { chantierId: true, date: true, chantier: { select: { code: true } } } });
  if (!r || !peut(user.role, "rapports", "lire") || !(await chantierAccessible(user, r.chantierId, "lire", "rapports"))) {
    return new NextResponse("Rapport introuvable.", { status: 404 });
  }
  const pdf = await pdfRapport(id);
  await journaliser(user.id, "EXPORT_PDF", "RapportJournalier", id);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Rapport_${r.chantier.code}_${r.date.toISOString().slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
