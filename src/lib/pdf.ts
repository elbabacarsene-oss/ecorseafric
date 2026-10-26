import "server-only";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { texteWinAnsi } from "./pdf-texte";

// Génération de PDF côté serveur (pdf-lib, polices standard : aucun fichier externe).
// Format A4 portrait, marges 40 pt.

const A4: [number, number] = [595.28, 841.89];
const MARGE = 40;
const BLEU = rgb(0.043, 0.149, 0.31);
const VERT = rgb(0.09, 0.54, 0.28);
const GRIS = rgb(0.4, 0.45, 0.5);
const GRIS_CLAIR = rgb(0.93, 0.94, 0.95);

export type EnTeteEntreprise = {
  raisonSociale: string;
  lignes: string[]; // adresse, NINEA, RCCM, téléphone…
  logo?: { octets: Uint8Array; mime: string } | null;
};

export type Colonne = { titre: string; largeur: number; droite?: boolean };

export class DocumentPdf {
  doc!: PDFDocument;
  page!: PDFPage;
  y = 0;
  normal!: PDFFont;
  gras!: PDFFont;
  private logo: PDFImage | null = null;
  private pages: PDFPage[] = [];

  static async creer(entete: EnTeteEntreprise, titreDocument: string) {
    const d = new DocumentPdf();
    d.doc = await PDFDocument.create();
    d.doc.setTitle(texteWinAnsi(titreDocument));
    d.doc.setCreator("ECORSE AFRIC BTP Manager 360");
    d.doc.setProducer("ECORSE AFRIC BTP Manager 360");
    d.normal = await d.doc.embedFont(StandardFonts.Helvetica);
    d.gras = await d.doc.embedFont(StandardFonts.HelveticaBold);
    if (entete.logo) {
      try {
        d.logo = entete.logo.mime === "image/png" ? await d.doc.embedPng(entete.logo.octets) : entete.logo.mime === "image/jpeg" ? await d.doc.embedJpg(entete.logo.octets) : null;
      } catch {
        d.logo = null;
      }
    }
    d.entete = entete;
    d.nouvellePage();
    return d;
  }

  private entete!: EnTeteEntreprise;
  get largeurUtile() {
    return A4[0] - 2 * MARGE;
  }

  nouvellePage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    let y = A4[1] - MARGE;
    let x = MARGE;
    if (this.logo) {
      const h = 42;
      const w = (this.logo.width / this.logo.height) * h;
      this.page.drawImage(this.logo, { x, y: y - h, width: Math.min(w, 120), height: h });
      x += Math.min(w, 120) + 10;
    }
    this.page.drawText(texteWinAnsi(this.entete.raisonSociale), { x, y: y - 12, size: 13, font: this.gras, color: BLEU });
    let yl = y - 25;
    for (const l of this.entete.lignes.slice(0, 3)) {
      this.page.drawText(texteWinAnsi(l), { x, y: yl, size: 7.5, font: this.normal, color: GRIS });
      yl -= 9;
    }
    y -= 52;
    this.page.drawLine({ start: { x: MARGE, y }, end: { x: A4[0] - MARGE, y }, thickness: 1.5, color: VERT });
    this.y = y - 16;
  }

  /** S'assure qu'il reste `h` points sur la page, sinon passe à la suivante. */
  place(h: number) {
    if (this.y - h < MARGE + 20) this.nouvellePage();
  }

  coupe(texte: string, largeur: number, taille = 9, police = this.normal): string[] {
    const res: string[] = [];
    for (const para of texteWinAnsi(texte).split("\n")) {
      const mots = para.split(/\s+/);
      let ligne = "";
      for (const m of mots) {
        const essai = ligne ? `${ligne} ${m}` : m;
        if (police.widthOfTextAtSize(essai, taille) <= largeur) ligne = essai;
        else {
          if (ligne) res.push(ligne);
          // mot trop long : coupe brutale
          let reste = m;
          while (police.widthOfTextAtSize(reste, taille) > largeur && reste.length > 1) {
            let i = reste.length;
            while (i > 1 && police.widthOfTextAtSize(reste.slice(0, i), taille) > largeur) i--;
            res.push(reste.slice(0, i));
            reste = reste.slice(i);
          }
          ligne = reste;
        }
      }
      res.push(ligne);
    }
    return res;
  }

  texte(t: string, opts: { taille?: number; gras?: boolean; couleur?: ReturnType<typeof rgb>; x?: number; largeur?: number; interligne?: number } = {}) {
    const taille = opts.taille ?? 9;
    const police = opts.gras ? this.gras : this.normal;
    const x = opts.x ?? MARGE;
    const lignes = this.coupe(t, opts.largeur ?? this.largeurUtile - (x - MARGE), taille, police);
    const pas = opts.interligne ?? taille * 1.35;
    for (const l of lignes) {
      this.place(pas);
      this.page.drawText(l, { x, y: this.y - taille, size: taille, font: police, color: opts.couleur ?? rgb(0.1, 0.1, 0.12) });
      this.y -= pas;
    }
  }

  titre(t: string, taille = 14) {
    this.place(taille + 10);
    this.texte(t, { taille, gras: true, couleur: BLEU });
    this.y -= 4;
  }

  sousTitre(t: string) {
    this.place(30);
    this.y -= 6;
    this.texte(t, { taille: 10.5, gras: true, couleur: VERT });
    this.y -= 2;
  }

  espace(h = 8) {
    this.y -= h;
  }

  /** Paires libellé / valeur sur deux colonnes. */
  champs(paires: [string, string][]) {
    const l = this.largeurUtile / 2;
    for (let i = 0; i < paires.length; i += 2) {
      this.place(22);
      const yDebut = this.y;
      let yMin = this.y;
      for (let j = 0; j < 2 && i + j < paires.length; j++) {
        const [lib, val] = paires[i + j];
        this.y = yDebut;
        this.texte(lib.toUpperCase(), { taille: 6.5, couleur: GRIS, x: MARGE + j * l, largeur: l - 10 });
        this.texte(val || "—", { taille: 9, x: MARGE + j * l, largeur: l - 10 });
        yMin = Math.min(yMin, this.y);
      }
      this.y = yMin - 3;
    }
  }

  tableau(colonnes: Colonne[], lignes: (string[] | { cellules: string[]; gras?: boolean; fond?: boolean })[], taille = 8) {
    const total = colonnes.reduce((s, c) => s + c.largeur, 0);
    const largeurs = colonnes.map((c) => (c.largeur / total) * this.largeurUtile);
    const dessinerEnTete = () => {
      this.place(18);
      this.page.drawRectangle({ x: MARGE, y: this.y - 14, width: this.largeurUtile, height: 14, color: BLEU });
      let x = MARGE;
      colonnes.forEach((c, i) => {
        const t = texteWinAnsi(c.titre);
        const w = this.gras.widthOfTextAtSize(t, 7);
        this.page.drawText(t, { x: c.droite ? x + largeurs[i] - 3 - w : x + 3, y: this.y - 10, size: 7, font: this.gras, color: rgb(1, 1, 1) });
        x += largeurs[i];
      });
      this.y -= 14;
    };
    dessinerEnTete();
    for (const brut of lignes) {
      const l = Array.isArray(brut) ? { cellules: brut } : brut;
      const police = l.gras ? this.gras : this.normal;
      const coupes = l.cellules.map((c, i) => this.coupe(c ?? "", largeurs[i] - 6, taille, police));
      const h = Math.max(...coupes.map((c) => c.length)) * (taille + 2.5) + 4;
      if (this.y - h < MARGE + 20) {
        this.nouvellePage();
        dessinerEnTete();
      }
      if (l.fond) this.page.drawRectangle({ x: MARGE, y: this.y - h, width: this.largeurUtile, height: h, color: GRIS_CLAIR });
      let x = MARGE;
      coupes.forEach((lignesCellule, i) => {
        lignesCellule.forEach((t, k) => {
          const w = police.widthOfTextAtSize(t, taille);
          this.page.drawText(t, {
            x: colonnes[i].droite ? x + largeurs[i] - 3 - w : x + 3,
            y: this.y - 2 - (k + 1) * (taille + 2.5) + 2,
            size: taille,
            font: police,
          });
        });
        x += largeurs[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: MARGE, y: this.y }, end: { x: A4[0] - MARGE, y: this.y }, thickness: 0.3, color: rgb(0.8, 0.82, 0.85) });
    }
    this.y -= 6;
  }

  /** Photos deux par deux, avec légende ; une ligne de photos n'est jamais coupée entre deux pages. */
  async imagesParDeux(images: { octets: Uint8Array; mime: string; legende: string }[]) {
    const moitie = this.largeurUtile / 2 - 6;
    const HMAX = 220;
    for (let i = 0; i < images.length; i += 2) {
      this.place(HMAX + 20);
      const y0 = this.y;
      let hMax = 0;
      for (let j = 0; j < 2 && i + j < images.length; j++) {
        const im = images[i + j];
        let img: PDFImage;
        try {
          img = im.mime === "image/png" ? await this.doc.embedPng(im.octets) : await this.doc.embedJpg(im.octets);
        } catch {
          continue;
        }
        let w = moitie;
        let h = (img.height / img.width) * w;
        if (h > HMAX) {
          h = HMAX;
          w = (img.width / img.height) * h;
        }
        const x = MARGE + j * (moitie + 12);
        this.page.drawImage(img, { x, y: y0 - h, width: w, height: h });
        this.page.drawText(texteWinAnsi(im.legende).slice(0, 70), { x, y: y0 - h - 10, size: 7, font: this.normal, color: GRIS });
        hMax = Math.max(hMax, h + 16);
      }
      this.y = y0 - hMax - 4;
    }
  }

  /** Filigrane diagonal sur toutes les pages (ex. « BROUILLON — NON VALIDÉ »). */
  filigrane(t: string) {
    for (const p of this.pages) filigranePage(p, this.gras, t);
  }

  async terminer(piedDePage: string): Promise<Uint8Array> {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      const t = texteWinAnsi(`${piedDePage} · page ${i + 1}/${n}`);
      p.drawText(t, { x: MARGE, y: MARGE - 15, size: 7, font: this.normal, color: GRIS });
    });
    return this.doc.save();
  }
}

function filigranePage(p: PDFPage, police: PDFFont, t: string) {
  const { width, height } = p.getSize();
  const texte = texteWinAnsi(t);
  const taille = Math.min(48, (Math.hypot(width, height) * 0.8) / Math.max(1, police.widthOfTextAtSize(texte, 1)));
  const w = police.widthOfTextAtSize(texte, taille);
  const angle = Math.atan2(height, width);
  p.drawText(texte, {
    x: width / 2 - (Math.cos(angle) * w) / 2,
    y: height / 2 - (Math.sin(angle) * w) / 2,
    size: taille,
    font: police,
    color: rgb(0.85, 0.1, 0.1),
    opacity: 0.28,
    rotate: degrees((angle * 180) / Math.PI),
  });
}

/**
 * Appose un tampon sur chaque page d'un PDF existant (ex. plan remplacé). Renvoie null si le PDF ne peut pas
 * être modifié (chiffré ou endommagé) : l'appelant sert alors l'original avec un avertissement dans le nom.
 */
export async function tamponnerPdf(octets: Uint8Array, texte: string): Promise<Uint8Array | null> {
  try {
    const doc = await PDFDocument.load(octets, { ignoreEncryption: false, updateMetadata: false });
    const police = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const p of doc.getPages()) {
      filigranePage(p, police, texte);
      const { width, height } = p.getSize();
      p.drawRectangle({ x: 10, y: height - 30, width: width - 20, height: 22, color: rgb(1, 0.95, 0.95), borderColor: rgb(0.85, 0.1, 0.1), borderWidth: 1 });
      p.drawText(texteWinAnsi(texte), { x: 16, y: height - 23, size: 10, font: police, color: rgb(0.75, 0.05, 0.05) });
    }
    return await doc.save();
  } catch {
    return null;
  }
}
