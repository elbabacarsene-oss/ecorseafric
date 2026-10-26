import { NextResponse } from "next/server";
import { documentAccessible } from "@/lib/acces";
import { utilisateurCourant } from "@/lib/auth";
import { journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { VERSION_EN_VIGUEUR } from "@/lib/libelles";
import { tamponnerPdf } from "@/lib/pdf";

const introuvable = () => new NextResponse("Fichier introuvable.", { status: 404 });

/**
 * Téléchargement d'une version de document : droits vérifiés à chaque requête (aucune URL publique).
 * Une version remplacée, en attente ou rejetée d'un PDF est servie avec un tampon visible sur chaque page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await utilisateurCourant();
  if (!user) return new NextResponse("Session expirée.", { status: 401 });
  const { id } = await params;
  const v = await db.versionDocument.findUnique({
    where: { id },
    include: { document: { select: { id: true, chantierId: true, devisId: true, partageExterne: true, titre: true, categorie: true } }, fichier: true },
  });
  if (!v || !(await documentAccessible(user, v.document, "lire"))) return introuvable();
  const enVigueur = VERSION_EN_VIGUEUR.includes(v.statut);
  // Portail : uniquement la version en vigueur.
  if (user.externe && !enVigueur) return introuvable();

  let contenu: Uint8Array = v.fichier.contenu;
  let nom = v.nomFichier;
  if (!enVigueur && v.mime === "application/pdf") {
    const texte =
      v.statut === "REMPLACE" ? `VERSION REMPLACÉE${v.remplaceLe ? ` LE ${formatDate(v.remplaceLe)}` : ""} — NE PAS UTILISER`
      : v.statut === "EN_ATTENTE" ? "EN ATTENTE D'APPROBATION — NON VALABLE POUR EXÉCUTION"
      : "VERSION REJETÉE — NE PAS UTILISER";
    const tamponne = await tamponnerPdf(contenu, texte);
    if (tamponne) contenu = tamponne;
  }
  if (!enVigueur) nom = nom.replace(/(\.[^.]+)?$/, (ext) => `_${v.statut === "REMPLACE" ? "REMPLACE" : v.statut === "EN_ATTENTE" ? "EN-ATTENTE" : "REJETE"}${ext}`);

  const url = new URL(req.url);
  const enLigne = url.searchParams.get("telecharger") !== "1" && (v.mime.startsWith("image/") || v.mime === "application/pdf");
  if (v.document.categorie !== "PHOTO") {
    await journaliser(user.id, "CONSULTATION", "VersionDocument", v.id, { documentId: v.document.id, numero: v.numero });
  }
  return new NextResponse(Buffer.from(contenu), {
    headers: {
      "Content-Type": v.mime,
      "Content-Length": String(contenu.length),
      "Content-Disposition": `${enLigne ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nom)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
