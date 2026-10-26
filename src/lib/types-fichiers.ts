// Détection du type réel d'un fichier déposé (signature binaire + extension). Pur, testé unitairement.
// Seuls les formats utiles au BTP sont acceptés ; HTML, SVG, exécutables et scripts sont refusés.

export type TypeFichier = { mime: string; ext: string; image: boolean; affichableEnLigne: boolean };

const T = (mime: string, ext: string, image = false, affichableEnLigne = false): TypeFichier => ({ mime, ext, image, affichableEnLigne });

const commencePar = (b: Uint8Array, sig: number[], decalage = 0) => sig.every((x, i) => b[decalage + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const FORMATS_ACCEPTES = "PDF, JPEG, PNG, WebP, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), DWG, CSV, TXT";

export function detecterType(b: Uint8Array, nomFichier: string): TypeFichier | null {
  const ext = (nomFichier.split(".").pop() ?? "").toLowerCase();
  if (commencePar(b, ascii("%PDF-"))) return T("application/pdf", "pdf", false, true);
  if (commencePar(b, [0xff, 0xd8, 0xff])) return T("image/jpeg", "jpg", true, true);
  if (commencePar(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return T("image/png", "png", true, true);
  if (commencePar(b, ascii("RIFF")) && commencePar(b, ascii("WEBP"), 8)) return T("image/webp", "webp", true, true);
  if (commencePar(b, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "docx") return T("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx");
    if (ext === "xlsx") return T("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");
    if (ext === "pptx") return T("application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx");
    return null;
  }
  if (commencePar(b, ascii("AC10")) && ext === "dwg") return T("application/acad", "dwg");
  if (ext === "csv" || ext === "txt") {
    // Texte brut : pas d'octet nul dans les premiers Ko
    if (b.subarray(0, 4096).includes(0)) return null;
    return T(ext === "csv" ? "text/csv" : "text/plain", ext);
  }
  return null;
}

/** Nom de fichier sûr pour l'en-tête Content-Disposition. */
export function nomFichierSur(nom: string): string {
  const n = nom.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (n || "fichier").slice(0, 150);
}
