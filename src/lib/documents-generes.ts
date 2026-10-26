import "server-only";
import ExcelJS from "exceljs";
import { db } from "./db";
import { montantLigne, prixUnitaireVente, totauxDevis } from "./devis-calculs";
import { formatDate, formatDateHeure, formatNombre } from "./format";
import { montantEnLettres } from "./lettres";
import { METEOS, STATUTS_DEVIS, STATUTS_RAPPORT, UNITES } from "./libelles";
import { DocumentPdf, type EnTeteEntreprise } from "./pdf";
import type { LigneMateriau, LigneMateriel, LignePersonnel, LigneTravaux } from "./rapports";

export async function enTeteEntreprise(): Promise<EnTeteEntreprise> {
  const e = await db.entreprise.findUnique({ where: { id: 1 } });
  const lignes = [
    [e?.adresse, e?.ville].filter(Boolean).join(", "),
    [e?.ninea && `NINEA ${e.ninea}`, e?.rccm && `RCCM ${e.rccm}`].filter(Boolean).join(" · "),
    [e?.telephone && `Tél. ${e.telephone}`, e?.email, e?.siteWeb].filter(Boolean).join(" · "),
  ].filter(Boolean);
  return {
    raisonSociale: e?.raisonSociale ?? "ECORSE AFRIC",
    lignes,
    logo: e?.logo && e.logoMime ? { octets: new Uint8Array(e.logo), mime: e.logoMime } : null,
  };
}

const nb = (v: { toString(): string } | number) => Number(v.toString()).toLocaleString("fr-SN", { maximumFractionDigits: 3 });

async function chargerDevis(id: string) {
  return db.devis.findUniqueOrThrow({
    where: { id },
    include: {
      client: true,
      chantier: { select: { code: true, nom: true } },
      lignes: { orderBy: { ordre: "asc" }, include: { sousDetail: true } },
    },
  });
}

function lotsDe<T extends { lot: string }>(lignes: T[]) {
  const lots: { lot: string; lignes: T[] }[] = [];
  for (const l of lignes) {
    const g = lots.find((x) => x.lot === l.lot);
    if (g) g.lignes.push(l);
    else lots.push({ lot: l.lot, lignes: [l] });
  }
  return lots;
}

/** PDF client du devis : quantités et prix de vente uniquement (aucun déboursé ni marge). */
export async function pdfDevis(id: string): Promise<Uint8Array> {
  const d = await chargerDevis(id);
  const t = totauxDevis(d.lignes, d);
  const pdf = await DocumentPdf.creer(await enTeteEntreprise(), `Devis ${d.numero}`);
  pdf.titre(`DEVIS N° ${d.numero}${d.variante !== "A" ? ` — variante ${d.variante}` : ""}${d.version > 1 ? ` — version ${d.version}` : ""}`);
  pdf.champs([
    ["Client", `${d.client.nom}${d.client.prenom ? " " + d.client.prenom : ""}${d.client.adresse ? `\n${d.client.adresse}` : ""}${d.client.ville ? `, ${d.client.ville}` : ""}`],
    ["Objet", d.objet],
    ["Date", formatDate(d.dateDevis)],
    ["Valable jusqu'au", formatDate(d.dateValidite)],
    ["Lieu des travaux", d.lieu ?? "—"],
    ["Délai d'exécution", d.delaiExecutionJours ? `${d.delaiExecutionJours} jours` : "—"],
  ]);
  pdf.espace(6);
  const cols = [
    { titre: "N°", largeur: 5 },
    { titre: "Désignation", largeur: 45 },
    { titre: "U", largeur: 6 },
    { titre: "Quantité", largeur: 11, droite: true },
    { titre: "P.U. HT", largeur: 15, droite: true },
    { titre: "Montant HT", largeur: 18, droite: true },
  ];
  const lignes: Parameters<DocumentPdf["tableau"]>[1] = [];
  let n = 0;
  for (const g of lotsDe(d.lignes)) {
    lignes.push({ cellules: ["", g.lot.toUpperCase(), "", "", "", ""], gras: true, fond: true });
    for (const l of g.lignes) {
      n++;
      lignes.push([String(n), l.designation, UNITES[l.unite], nb(l.quantite), formatNombre(prixUnitaireVente(l, d)), formatNombre(montantLigne(l, d))]);
    }
    lignes.push({ cellules: ["", `Sous-total ${g.lot}`, "", "", "", formatNombre(g.lignes.reduce((s, l) => s + montantLigne(l, d), 0))], gras: true });
  }
  pdf.tableau(cols, lignes);
  pdf.tableau(
    [{ titre: "Récapitulatif", largeur: 70 }, { titre: "Montant (F CFA)", largeur: 30, droite: true }],
    [
      { cellules: ["Total HT", formatNombre(t.totalHT)], gras: true },
      [`TVA ${nb(d.tauxTva)} %`, formatNombre(t.tva)],
      { cellules: ["Total TTC", formatNombre(t.totalTTC)], gras: true, fond: true },
    ],
    9,
  );
  pdf.texte(`Arrêté le présent devis à la somme de : ${montantEnLettres(t.totalTTC)} toutes taxes comprises.`, { gras: true });
  if (d.conditions) {
    pdf.sousTitre("Conditions");
    pdf.texte(d.conditions);
  }
  pdf.espace(16);
  pdf.champs([["Pour l'entreprise", "\n\n"], ["Bon pour accord du client (date, signature, cachet)", "\n\n"]]);
  if (!["VALIDE", "ENVOYE", "ACCEPTE"].includes(d.statut)) pdf.filigrane(d.statut === "REMPLACE" ? "VERSION REMPLACÉE" : `${STATUTS_DEVIS[d.statut].toUpperCase()} — NON VALIDÉ`);
  return pdf.terminer(`Devis ${d.numero}-${d.variante} v${d.version} · édité le ${formatDateHeure(new Date())}`);
}

/** Classeur Excel du devis. Les montants sont des formules (quantité × prix) pour rester vérifiables. */
export async function excelDevis(id: string, avecCouts: boolean): Promise<Buffer> {
  const d = await chargerDevis(id);
  const t = totauxDevis(d.lignes, d);
  const wb = new ExcelJS.Workbook();
  wb.creator = "ECORSE AFRIC BTP Manager 360";
  const ws = wb.addWorksheet("Devis", { views: [{ state: "frozen", ySplit: 6 }] });
  ws.columns = [
    { width: 6 }, { width: 55 }, { width: 8 }, { width: 12 },
    ...(avecCouts ? [{ width: 16 }] : []), { width: 16 }, { width: 18 },
  ];
  ws.addRow([`Devis ${d.numero} — variante ${d.variante} — version ${d.version} (${STATUTS_DEVIS[d.statut]})`]).font = { bold: true, size: 13 };
  ws.addRow([`Client : ${d.client.nom}${d.client.prenom ? " " + d.client.prenom : ""}`]);
  ws.addRow([`Objet : ${d.objet}`]);
  ws.addRow([`Date : ${formatDate(d.dateDevis)} · TVA ${nb(d.tauxTva)} %${avecCouts ? ` · FC ${nb(d.tauxFraisChantier)} % · FG ${nb(d.tauxFraisGeneraux)} % · marge ${nb(d.tauxMarge)} %` : ""}`]);
  ws.addRow([]);
  const entete = ["N°", "Désignation", "Unité", "Quantité", ...(avecCouts ? ["DS unitaire"] : []), "P.U. HT", "Montant HT"];
  const h = ws.addRow(entete);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B264F" } }));
  const colQ = "D";
  const colPU = avecCouts ? "F" : "E";
  const colM = avecCouts ? "G" : "F";
  const sousTotaux: string[] = [];
  let n = 0;
  for (const g of lotsDe(d.lignes)) {
    const r = ws.addRow(["", g.lot]);
    r.font = { bold: true };
    const debut = r.number + 1;
    for (const l of g.lignes) {
      n++;
      const row = ws.addRow([n, l.designation, UNITES[l.unite], Number(l.quantite), ...(avecCouts ? [Number(l.debourseSecUnitaire)] : []), prixUnitaireVente(l, d)]);
      row.getCell(colM).value = { formula: `ROUND(${colQ}${row.number}*${colPU}${row.number},0)`, result: montantLigne(l, d) };
    }
    const fin = ws.lastRow!.number;
    const st = ws.addRow(["", `Sous-total ${g.lot}`]);
    st.font = { bold: true };
    st.getCell(colM).value = { formula: `SUM(${colM}${debut}:${colM}${fin})`, result: g.lignes.reduce((s, l) => s + montantLigne(l, d), 0) };
    sousTotaux.push(`${colM}${st.number}`);
  }
  ws.addRow([]);
  const ht = ws.addRow(["", "Total HT"]);
  ht.getCell(colM).value = { formula: sousTotaux.length ? sousTotaux.join("+") : "0", result: t.totalHT };
  const tva = ws.addRow(["", `TVA ${nb(d.tauxTva)} %`]);
  tva.getCell(colM).value = { formula: `ROUND(${colM}${ht.number}*${Number(d.tauxTva) / 100},0)`, result: t.tva };
  const ttc = ws.addRow(["", "Total TTC"]);
  ttc.getCell(colM).value = { formula: `${colM}${ht.number}+${colM}${tva.number}`, result: t.totalTTC };
  for (const r of [ht, tva, ttc]) r.font = { bold: true };
  for (const c of ["D", "E", "F", "G"]) ws.getColumn(c).numFmt = c === "D" ? "#,##0.###" : "#,##0";
  if (avecCouts) {
    ws.addRow([]);
    for (const [l, v] of [
      ["Déboursé sec", t.debourseSec], ["Frais de chantier", t.fraisChantier], ["Frais généraux", t.fraisGeneraux],
      ["Coût de revient", t.coutRevient], ["Marge", t.marge],
    ] as const) {
      const r = ws.addRow(["", l]);
      r.getCell(colM).value = v;
      r.font = { italic: true };
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF du rapport journalier, photos comprises. */
export async function pdfRapport(id: string): Promise<Uint8Array> {
  const r = await db.rapportJournalier.findUniqueOrThrow({
    where: { id },
    include: {
      chantier: { select: { code: true, nom: true, ville: true } },
      redacteur: { select: { prenom: true, nom: true } },
      validateur: { select: { prenom: true, nom: true } },
      documents: { where: { categorie: "PHOTO", archive: false }, include: { versions: { where: { statut: { in: ["EN_VIGUEUR", "APPROUVE"] } }, take: 1, include: { fichier: true } } } },
    },
  });
  const pdf = await DocumentPdf.creer(await enTeteEntreprise(), `Rapport journalier ${r.chantier.code} ${formatDate(r.date)}`);
  pdf.titre(`RAPPORT JOURNALIER DE CHANTIER — ${formatDate(r.date)}`);
  pdf.champs([
    ["Chantier", `${r.chantier.code} · ${r.chantier.nom}${r.chantier.ville ? ` (${r.chantier.ville})` : ""}`],
    ["Responsable du rapport", `${r.redacteur.prenom} ${r.redacteur.nom}`],
    ["Météo", `${r.meteo ? METEOS[r.meteo] : "—"}${r.meteoDetails ? ` · ${r.meteoDetails}` : ""}`],
    ["Effectif présent / heures", `${r.effectifTotal} personne(s) · ${nb(r.heuresTravaillees)} h`],
    ["Statut", STATUTS_RAPPORT[r.statut]],
    ["Validation", r.validateur ? `${r.validateur.prenom} ${r.validateur.nom}, ${formatDateHeure(r.valideLe)}` : "Non validé"],
  ]);
  const personnel = r.personnel as LignePersonnel[];
  if (personnel.length) {
    pdf.sousTitre("Personnel par spécialité");
    pdf.tableau([{ titre: "Spécialité", largeur: 60 }, { titre: "Nombre", largeur: 20, droite: true }, { titre: "Heures / pers.", largeur: 20, droite: true }],
      personnel.map((p) => [p.specialite, String(p.nombre), nb(p.heures)]));
  }
  const travaux = r.travaux as LigneTravaux[];
  pdf.sousTitre("Travaux réalisés");
  if (r.travauxRealises) pdf.texte(r.travauxRealises);
  if (travaux.length) {
    pdf.tableau([{ titre: "Ouvrage / tâche", largeur: 55 }, { titre: "Unité", largeur: 10 }, { titre: "Quantité", largeur: 15, droite: true }, { titre: "Avancement", largeur: 20, droite: true }],
      travaux.map((t) => [t.designation, t.unite ? UNITES[t.unite] : "", t.quantite !== null ? nb(t.quantite) : "", t.avancement !== null ? `${t.avancement} %` : ""]));
  }
  const tabMat = (titre: string, l: LigneMateriau[]) => {
    if (!l.length) return;
    pdf.sousTitre(titre);
    pdf.tableau([{ titre: "Matériau", largeur: 50 }, { titre: "Unité", largeur: 10 }, { titre: "Quantité", largeur: 15, droite: true }, { titre: "Fournisseur", largeur: 25 }],
      l.map((m) => [m.designation, UNITES[m.unite], nb(m.quantite), m.fournisseur ?? ""]));
  };
  tabMat("Matériaux consommés", r.materiauxConsommes as LigneMateriau[]);
  tabMat("Matériaux livrés", r.materiauxLivres as LigneMateriau[]);
  const materiel = r.materiel as LigneMateriel[];
  if (materiel.length) {
    pdf.sousTitre("Matériel et engins");
    pdf.tableau([{ titre: "Matériel", largeur: 55 }, { titre: "Heures", largeur: 15, droite: true }, { titre: "État", largeur: 30 }],
      materiel.map((m) => [m.designation, m.heures !== null ? nb(m.heures) : "", { UTILISE: "Utilisé", DISPONIBLE: "Disponible, non utilisé", EN_PANNE: "En panne" }[m.etat]]));
  }
  for (const [titre, v] of [["Incidents", r.incidents], ["Difficultés", r.difficultes], ["Instructions reçues / données", r.instructions], ["Observations", r.observations]] as const) {
    if (v) {
      pdf.sousTitre(titre);
      pdf.texte(v);
    }
  }
  const photos = r.documents.filter((p) => p.versions[0]);
  if (photos.length) {
    pdf.sousTitre(`Photos (${photos.length})`);
    await pdf.imagesParDeux(
      photos
        .map((p) => ({ v: p.versions[0], titre: p.titre }))
        .filter(({ v }) => v.mime === "image/jpeg" || v.mime === "image/png")
        .map(({ v, titre }) => ({ octets: new Uint8Array(v.fichier.contenu), mime: v.mime, legende: titre })),
    );
  }
  if (r.statut === "VALIDE" && r.empreinteValidation) {
    pdf.espace(10);
    pdf.texte(`Validé électroniquement par ${r.validateur?.prenom} ${r.validateur?.nom} le ${formatDateHeure(r.valideLe)}. Empreinte SHA-256 du contenu validé : ${r.empreinteValidation}`, { taille: 7.5 });
  } else {
    pdf.filigrane(`${STATUTS_RAPPORT[r.statut].toUpperCase()} — NON VALIDÉ`);
  }
  return pdf.terminer(`Rapport ${r.chantier.code} du ${formatDate(r.date)} · édité le ${formatDateHeure(new Date())}`);
}

