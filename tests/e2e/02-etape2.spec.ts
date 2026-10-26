import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { totauxDevis } from "../../src/lib/devis-calculs";
import { formatXOF } from "../../src/lib/format";
import { COMPTES } from "./comptes";
import { connexion, db } from "./outils";

// Étape 2 : devis → validation → chantier → budget → planning → rapport journalier → documents.
const etat: { ouvrage?: string; devis?: string; chantier?: string; client?: string; tacheA?: string; tacheB?: string; rapport?: string; doc?: string; vA?: string; vB?: string } = {};

const jour = (n: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + n * 86_400_000).toISOString().slice(0, 10);
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
async function pdfPlan(texte: string) {
  const d = await PDFDocument.create();
  const p = d.addPage([595, 842]);
  p.drawText(texte, { x: 50, y: 780, size: 18, font: await d.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await d.save());
}
const accepterDialogues = (page: Page) => page.on("dialog", (d) => d.accept());

/** Fiche intervenant liée au compte (créée si besoin). */
async function lierCompte(cle: keyof typeof COMPTES, type: "METREUR" | "CONDUCTEUR_TRAVAUX" | "CHEF_CHANTIER" | "CLIENT_PARTICULIER") {
  const u = await db.utilisateur.findUniqueOrThrow({ where: { email: COMPTES[cle].email } });
  if (u.intervenantId) return u.intervenantId;
  const categorie = type === "CLIENT_PARTICULIER" ? "MAITRISE_OUVRAGE" : "PERSONNEL_INTERNE";
  const i = await db.intervenant.create({ data: { code: `TST-${cle.toUpperCase()}`, categorie, type, nom: COMPTES[cle].nom, prenom: COMPTES[cle].prenom } });
  await db.utilisateur.update({ where: { id: u.id }, data: { intervenantId: i.id } });
  return i.id;
}

test.describe.serial("Étape 2 – devis, budgets, planning, rapports, documents", () => {
  test.beforeAll(async () => {
    etat.client = await lierCompte("client", "CLIENT_PARTICULIER");
    await lierCompte("metreur", "METREUR");
    await lierCompte("conducteur", "CONDUCTEUR_TRAVAUX");
    await lierCompte("chef", "CHEF_CHANTIER");
  });

  test("bibliothèque : un ouvrage avec sous-détail donne un déboursé sec calculé", async ({ page }) => {
    await connexion(page, COMPTES.dt.email);
    await page.goto("/bibliotheque");
    await expect(page.getByText(/Aucun ouvrage dans la bibliothèque/)).toBeVisible();
    await page.goto("/bibliotheque/nouveau");
    await page.locator('[name="code"]').fill("ba-350");
    await page.locator('[name="categorie"]').selectOption("BETON_ARME");
    await page.locator('[name="designation"]').fill("Béton armé dosé à 350 kg/m³ pour semelles");
    await page.locator('[name="unite"]').selectOption("M3");
    await page.getByRole("button", { name: "Créer l'ouvrage" }).click();
    await expect(page).toHaveURL(/\/bibliotheque\/c[a-z0-9]+$/);
    etat.ouvrage = page.url().split("/").pop()!;
    const bloc = page.locator("details", { hasText: "Ajouter un composant" });
    await bloc.locator("summary").click();
    for (const [type, des, unite, q, pu] of [
      ["MATERIAU", "Ciment CPJ 42,5", "TONNE", "0,35", "85000"],
      ["MATERIAU", "Gravier concassé 8/16", "M3", "0,8", "15000"],
      ["MATERIAU", "Sable de dune", "M3", "0,4", "9000"],
      ["MAIN_OEUVRE", "Équipe béton", "HEURE", "6", "1500"],
    ]) {
      await bloc.locator('[name="type"]').selectOption(type);
      await bloc.locator('[name="designation"]').fill(des);
      await bloc.locator('[name="unite"]').selectOption(unite);
      await bloc.locator('[name="quantite"]').fill(q);
      await bloc.locator('[name="prixUnitaire"]').fill(pu);
      await bloc.getByRole("button", { name: "Ajouter" }).click();
      await expect(page.getByRole("cell", { name: des })).toBeVisible();
    }
    await expect(page.locator("tr", { hasText: "Déboursé sec unitaire" })).toContainText(/54\s350 F CFA/);
    await expect(page.getByText("BA-350 · Béton armé")).toBeVisible();
  });

  test("devis : lignes, import de quantités à vérifier, soumission, validation par une autre personne", async ({ page }) => {
    accepterDialogues(page);
    await connexion(page, COMPTES.metreur.email);
    await page.goto("/devis/nouveau");
    await page.locator('[name="objet"]').fill("Construction d'un bâtiment R+1 à Thiès");
    await page.locator('[name="typeProjet"]').selectOption("BATIMENT");
    await page.locator('[name="clientId"]').selectOption(etat.client!);
    await page.locator('[name="lieu"]').fill("Thiès, quartier Grand Standing");
    await page.locator('[name="delaiExecutionJours"]').fill("120");
    await page.locator('[name="tauxFraisChantier"]').fill("10");
    await page.locator('[name="tauxFraisGeneraux"]').fill("8");
    await page.locator('[name="tauxMarge"]').fill("12");
    await page.getByRole("button", { name: "Créer le devis" }).click();
    await expect(page).toHaveURL(/\/devis\/c[a-z0-9]+$/);
    etat.devis = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { name: /Devis DV-\d{4}-001/ })).toBeVisible();

    const ajout = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Ajouter une ligne$/ }) });
    await ajout.locator('[name="lot"]').fill("Gros œuvre");
    await ajout.locator('[name="ouvrageId"]').selectOption(etat.ouvrage!);
    await ajout.locator('[name="quantite"]').fill("12,5");
    await ajout.getByRole("button", { name: "Ajouter la ligne" }).click();
    await expect(page.getByRole("cell", { name: /Béton armé dosé à 350/ })).toBeVisible();

    const ajout2 = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Ajouter une ligne$/ }) });
    if ((await ajout2.getAttribute("open")) === null) await ajout2.locator("summary").click();
    await ajout2.locator('[name="lot"]').fill("Gros œuvre");
    await ajout2.locator('[name="designation"]').fill("Coffrage bois pour poteaux");
    await ajout2.locator('[name="unite"]').selectOption("M2");
    await ajout2.locator('[name="quantite"]').fill("40");
    await ajout2.locator('[name="debourseSecUnitaire"]').fill("3500");
    await ajout2.getByRole("button", { name: "Ajouter la ligne" }).click();
    await expect(page.getByRole("cell", { name: /Coffrage bois pour poteaux/ })).toBeVisible();

    const imp = page.locator("details", { hasText: "Importer un tableau de quantités" });
    await imp.locator("summary").click();
    await imp.locator("#fichier-import").setInputFiles({
      name: "metre-terrassement.csv", mimeType: "text/csv",
      buffer: Buffer.from("Lot;Désignation;Unité;Quantité;Déboursé sec unitaire\nTerrassement;Fouilles en rigole;m3;18;4 000\nTerrassement;Remblai compacté;m³;10;2500\n"),
    });
    await imp.getByRole("button", { name: "Importer" }).click();
    await expect(page.getByText(/2 ligne\(s\) importée\(s\)/)).toBeVisible();
    await expect(page.getByText("2 quantité(s) importée(s) à vérifier")).toBeVisible();

    await page.getByRole("button", { name: "Soumettre à validation interne" }).click();
    await expect(page.locator("p[role=alert]").first()).toContainText("n'ont pas été vérifiées par une personne");
    for (const reste of [1, 0]) {
      await page.getByRole("button", { name: "Quantité vérifiée" }).first().click();
      await expect(page.getByRole("button", { name: "Quantité vérifiée" })).toHaveCount(reste);
    }

    // Totaux affichés = calcul indépendant à partir des données enregistrées
    const d = await db.devis.findUniqueOrThrow({ where: { id: etat.devis }, include: { lignes: true } });
    const t = totauxDevis(d.lignes, d);
    expect(t.debourseSec).toBe(Math.round(12.5 * 54350 + 40 * 3500 + 18 * 4000 + 10 * 2500));
    await expect(page.locator("tr", { hasText: "Total HT" }).last()).toContainText(formatXOF(t.totalHT));
    await expect(page.getByText(formatXOF(t.totalTTC)).first()).toBeVisible();
    await expect(page.getByText(formatXOF(t.coutRevient)).first()).toBeVisible();

    await page.getByRole("button", { name: "Soumettre à validation interne" }).click();
    await expect(page.getByText("Soumis à validation", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("En attente de validation par une autre personne habilitée.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Valider le devis" })).toHaveCount(0);

    const ctx = await page.context().browser()!.newContext();
    const dt = await ctx.newPage();
    accepterDialogues(dt);
    await connexion(dt, COMPTES.dt.email);
    await expect(dt.getByText(/Devis DV-\d{4}-001-A v1 à valider/)).toBeVisible();
    await dt.goto(`/devis/${etat.devis}`);
    await dt.getByRole("button", { name: "Valider le devis" }).click();
    await expect(dt.getByText("Validé en interne", { exact: true }).first()).toBeVisible();
    await ctx.close();
  });

  test("devis : exports PDF et Excel, envoi, acceptation, puis versions verrouillées", async ({ page }) => {
    accepterDialogues(page);
    await connexion(page, COMPTES.metreur.email);
    const pdf = await page.request.get(`/api/devis/${etat.devis}/pdf`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const xlsx = await page.request.get(`/api/devis/${etat.devis}/excel`);
    expect(xlsx.status()).toBe(200);
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");

    await page.goto(`/devis/${etat.devis}`);
    await page.getByRole("button", { name: "Marquer comme envoyé au client" }).click();
    await expect(page.getByText("Envoyé au client", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Le client a accepté" }).click();
    await expect(page.getByText("Accepté", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Créer une nouvelle version" })).toHaveCount(0);
    // Le métreur ne peut pas créer le chantier (réservé à la direction)
    await expect(page.getByText("La création du chantier est réservée à la direction.")).toBeVisible();
  });

  test("devis accepté → chantier : marché, budget détaillé et devis conservés", async ({ page }) => {
    accepterDialogues(page);
    await connexion(page, COMPTES.dt.email);
    await page.goto(`/devis/${etat.devis}`);
    await page.locator('[name="ville"]').fill("Thiès");
    await page.locator('[name="region"]').selectOption("THIES");
    await page.locator('[name="dateDemarrage"]').fill(jour(-20));
    await page.getByRole("button", { name: "Créer le chantier" }).click();
    await expect(page).toHaveURL(/\/chantiers\/c[a-z0-9]+\/budget$/);
    etat.chantier = page.url().split("/")[4];

    const d = await db.devis.findUniqueOrThrow({ where: { id: etat.devis }, include: { lignes: true } });
    const t = totauxDevis(d.lignes, d);
    const c = await db.chantier.findUniqueOrThrow({ where: { id: etat.chantier } });
    expect(Number(c.montantMarche)).toBe(t.totalHT);
    expect(Number(c.budgetInitial)).toBe(t.coutRevient);
    expect(c.dateFinContractuelle!.toISOString().slice(0, 10)).toBe(jour(-20 + 119));
    expect(d.chantierId).toBe(etat.chantier);
    await expect(page.locator(".carte", { hasText: "Budget initial" }).first()).toContainText(formatXOF(t.coutRevient));
    await expect(page.getByRole("cell", { name: "Main-d'œuvre", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Frais de chantier", exact: true })).toBeVisible();

    // Le DT a préparé le budget : il le soumet mais ne peut pas le valider lui-même
    await page.getByRole("button", { name: "Soumettre le budget à validation" }).click();
    await expect(page.getByText("Soumis à validation", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Valider le budget initial" })).toHaveCount(0);

    // Chantier démarré ; équipe et portail client (préparation des tests suivants)
    await db.chantier.update({ where: { id: etat.chantier }, data: { statut: "EN_COURS" } });
    for (const cle of ["conducteur", "chef"] as const) {
      const u = await db.utilisateur.findUniqueOrThrow({ where: { email: COMPTES[cle].email } });
      await db.affectationChantier.create({ data: { chantierId: etat.chantier, intervenantId: u.intervenantId!, roleChantier: cle === "chef" ? "Chef d'équipe" : "Conducteur adjoint" } });
    }
    await db.affectationChantier.updateMany({ where: { chantierId: etat.chantier, intervenantId: etat.client }, data: { accesPortail: true } });
  });

  test("budget : validation par la direction, budget initial figé, révision motivée", async ({ page }) => {
    accepterDialogues(page);
    await connexion(page, COMPTES.dg.email);
    await page.goto("/");
    await expect(page.getByText(/: budget à valider/)).toBeVisible();
    await page.goto(`/chantiers/${etat.chantier}/budget`);
    await page.getByRole("button", { name: "Valider le budget initial" }).click();
    await expect(page.getByText("Validé", { exact: true }).first()).toBeVisible();
    const initial = Number((await db.chantier.findUniqueOrThrow({ where: { id: etat.chantier } })).budgetInitial);

    const ligne = page.locator("tr", { hasText: "Frais de chantier" }).first();
    await ligne.locator("summary", { hasText: "Réviser" }).click();
    const avant = Number((await db.ligneBudget.findFirstOrThrow({ where: { chantierId: etat.chantier, poste: "FRAIS_CHANTIER" } })).montantInitial);
    await ligne.locator('[name="montantActualise"]').fill(String(avant + 1_000_000));
    await ligne.locator('[name="motif"]').fill("Location d'un groupe électrogène supplémentaire");
    await ligne.getByRole("button", { name: "Enregistrer la révision" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Révision enregistrée." }).first()).toBeVisible();
    await expect(page.locator(".carte", { hasText: "Écart" }).first()).toContainText(/1\s000\s000 F CFA/);
    await expect(page.getByText("Le budget actualisé dépasse le budget initial")).toBeVisible();
    const c = await db.chantier.findUniqueOrThrow({ where: { id: etat.chantier } });
    expect(Number(c.budgetInitial)).toBe(initial); // figé
    expect(Number(c.budgetActualise)).toBe(initial + 1_000_000);
    await page.goto(`/chantiers/${etat.chantier}`);
    await expect(page.getByText(/Révision budgétaire « .* » .* Location d'un groupe électrogène/)).toBeVisible();
  });

  test("planning : tâches, dépendance, recalcul, référence, chemin critique et retard signalé", async ({ page }) => {
    accepterDialogues(page);
    await connexion(page, COMPTES.conducteur.email);
    await page.goto(`/chantiers/${etat.chantier}/planning`);
    await expect(page.getByText("Aucune tâche planifiée.")).toBeVisible();
    const form = page.locator("details", { hasText: "Ajouter une tâche ou un jalon" });
    const ajouterTache = async (nom: string, debut: string, fin: string | null, opts: { jalon?: boolean; importante?: boolean; lot?: string } = {}) => {
      if ((await form.getAttribute("open")) === null) await form.locator("summary").click();
      await form.locator('[name="nom"]').fill(nom);
      await form.locator('[name="type"]').selectOption(opts.jalon ? "JALON" : "TACHE");
      await form.locator('[name="debutPrevu"]').fill(debut);
      if (fin) await form.locator('[name="finPrevue"]').fill(fin);
      if (opts.lot) await form.locator('[name="lot"]').fill(opts.lot);
      if (opts.importante) await form.getByLabel("Tâche importante (alerte si retard)").check();
      await form.getByRole("button", { name: "Ajouter" }).click();
      await expect(page.locator("#" + "x").or(page.getByRole("cell", { name: new RegExp(nom) })).first()).toBeVisible();
    };
    await ajouterTache("Implantation et terrassement", jour(-20), jour(-10), { importante: true, lot: "Terrassement" });
    await ajouterTache("Fondations", jour(-12), jour(5), { lot: "Gros œuvre" });
    await ajouterTache("Fin des fondations", jour(8), null, { jalon: true });
    const taches = await db.tachePlanning.findMany({ where: { chantierId: etat.chantier }, orderBy: { ordre: "asc" } });
    [etat.tacheA, etat.tacheB] = [taches[0].id, taches[1].id];

    const ligneB = page.locator(`#tache-${etat.tacheB}`);
    await ligneB.locator("summary", { hasText: "+ enchaînement" }).click();
    await ligneB.locator('[name="predecesseurId"]').selectOption(etat.tacheA!);
    await ligneB.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("1 enchaînement(s) non respecté(s) :")).toBeVisible();
    await page.getByRole("button", { name: "Décaler les tâches concernées" }).click();
    await expect(page.getByText("1 enchaînement(s) non respecté(s) :")).toHaveCount(0);
    const b = await db.tachePlanning.findUniqueOrThrow({ where: { id: etat.tacheB } });
    expect(b.debutPrevu.toISOString().slice(0, 10)).toBe(jour(-9));
    expect(b.finPrevue.toISOString().slice(0, 10)).toBe(jour(8)); // durée de 18 jours conservée

    await page.getByRole("button", { name: "Figer comme planning de référence" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Planning de référence enregistré." }).first()).toBeVisible();
    await expect(page.locator(`#tache-${etat.tacheA}`)).toContainText("critique");
    await expect(page.locator(`#tache-${etat.tacheA}`)).toContainText("retard 10 j");
    await expect(page.getByRole("button", { name: "Semaines" })).toBeVisible(); // Gantt affiché
    await page.reload();
    await expect(page.locator(".carte", { hasText: "Tâches en retard" }).first()).toContainText("1");

    // Le directeur technique est alerté sur son tableau de bord
    await connexion(page, COMPTES.dt.email);
    await expect(page.getByText(/tâche importante « Implantation et terrassement » en retard/)).toBeVisible();
  });

  test("rapport journalier sur smartphone : saisie, photo, validation par un autre responsable, report d'avancement", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const chef = await ctx.newPage();
    accepterDialogues(chef);
    await connexion(chef, COMPTES.chef.email);
    await chef.goto(`/rapports/nouveau?chantier=${etat.chantier}`);
    await chef.locator('[name="meteo"]').selectOption("HARMATTAN");
    await chef.locator('[name="personnel.specialite"]').first().fill("Maçons");
    await chef.locator('[name="personnel.nombre"]').first().fill("6");
    await chef.getByRole("button", { name: "+ spécialité" }).click();
    await chef.locator('[name="personnel.specialite"]').nth(1).fill("Manœuvres");
    await chef.locator('[name="personnel.nombre"]').nth(1).fill("4");
    await chef.locator('[name="personnel.heures"]').nth(1).fill("8");
    await chef.getByRole("button", { name: "+ ouvrage exécuté" }).click();
    await chef.locator('[name="travaux.designation"]').fill("Fouilles en rigole");
    await chef.locator('[name="travaux.unite"]').selectOption("M3");
    await chef.locator('[name="travaux.quantite"]').fill("12");
    await chef.locator('[name="travaux.tacheId"]').selectOption(etat.tacheA!);
    await chef.locator('[name="travaux.avancement"]').fill("100");
    await chef.getByRole("button", { name: "+ matériau consommé" }).click();
    await chef.locator('[name="consommes.designation"]').fill("Ciment CPJ 42,5");
    await chef.locator('[name="consommes.unite"]').selectOption("TONNE");
    await chef.locator('[name="consommes.quantite"]').fill("1,5");
    await chef.locator('[name="incidents"]').fill("Coupure d'eau de 2 heures le matin.");
    await chef.getByLabel("Soumettre à validation dès l'enregistrement").check();
    await chef.getByRole("button", { name: "Enregistrer le rapport" }).click();
    await expect(chef).toHaveURL(/\/rapports\/c[a-z0-9]+$/);
    etat.rapport = chef.url().split("/").pop()!;
    await expect(chef.getByText("10 personne(s)")).toBeVisible();
    await expect(chef.getByText("80 h")).toBeVisible();
    await chef.locator('[name="photos"]').setInputFiles({ name: "fouilles.png", mimeType: "image/png", buffer: PNG });
    await chef.locator('[name="legende"]').fill("Fouilles terminées");
    await chef.getByRole("button", { name: "Envoyer les photos" }).click();
    await expect(chef.getByRole("status").filter({ hasText: "1 photo(s) enregistrée(s)." }).first()).toBeVisible();
    await expect(chef.getByText(/En attente de validation par le conducteur/)).toBeVisible();
    await expect(chef.getByRole("button", { name: "Valider le rapport" })).toHaveCount(0);
    expect(await chef.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // Un second rapport le même jour est refusé
    await chef.goto(`/rapports/nouveau?chantier=${etat.chantier}`);
    await chef.locator('[name="personnel.specialite"]').first().fill("Ferrailleurs");
    await chef.getByRole("button", { name: "Enregistrer le rapport" }).click();
    await expect(chef.locator("p[role=alert]")).toContainText("Un rapport existe déjà");
    await ctx.close();

    const ctx2 = await browser.newContext();
    const cond = await ctx2.newPage();
    accepterDialogues(cond);
    await connexion(cond, COMPTES.conducteur.email);
    await cond.goto(`/rapports/${etat.rapport}`);
    await cond.getByRole("button", { name: "Valider le rapport" }).click();
    await expect(cond.getByText("Validé", { exact: true }).first()).toBeVisible();
    await expect(cond.getByText(/Empreinte SHA-256 : [0-9a-f]{64}/)).toBeVisible();
    await expect(cond.getByRole("link", { name: "Modifier" })).toHaveCount(0);
    const a = await db.tachePlanning.findUniqueOrThrow({ where: { id: etat.tacheA } });
    expect(a.avancement).toBe(100);
    expect(a.finReelle).not.toBeNull();
    const pdf = await cond.request.get(`/api/rapports/${etat.rapport}/pdf`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await cond.goto(`/chantiers/${etat.chantier}/planning`);
    await expect(cond.locator(`#tache-${etat.tacheA}`)).not.toContainText(/retard \d+ j/);
    await ctx2.close();
  });

  test("documents : approbation par un tiers, plan remplacé tamponné, partage portail limité", async ({ page, browser }) => {
    accepterDialogues(page);
    await connexion(page, COMPTES.conducteur.email);
    await page.goto(`/chantiers/${etat.chantier}`);
    const depot = page.locator("details", { hasText: "Déposer un document" });
    await depot.locator("summary").click();
    // Un fichier HTML déguisé en PDF est refusé
    await depot.locator('[name="fichier"]').setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
    await depot.locator('[name="categorie"]').selectOption("PLAN");
    await depot.getByRole("button", { name: "Déposer" }).click();
    await expect(depot.locator("p[role=alert]")).toContainText("non accepté");
    await expect(depot.locator('[name="categorie"]')).toHaveValue("PLAN"); // la saisie est conservée après un refus
    // Un PDF de 3,5 Mo est accepté par le serveur ; au-delà de 4 Mo, message explicite (pas d'erreur technique)
    const gros = (mo: number) => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(Math.round(mo * 1024 * 1024), 32)]);
    await depot.locator('[name="fichier"]').setInputFiles({ name: "trop-gros.pdf", mimeType: "application/pdf", buffer: gros(4.2) });
    await depot.getByRole("button", { name: "Déposer" }).click();
    await expect(depot.locator("p[role=alert]")).toContainText("dépasse la taille maximale de 4 Mo");
    await depot.locator('[name="fichier"]').setInputFiles({ name: "note-de-calcul.pdf", mimeType: "application/pdf", buffer: gros(3.5) });
    await depot.locator('[name="categorie"]').selectOption("RAPPORT");
    await depot.locator('[name="titre"]').fill("Note de calcul fondations");
    await depot.getByRole("button", { name: "Déposer" }).click();
    await expect(depot.getByRole("status").filter({ hasText: "Document enregistré." })).toBeVisible();
    await page.reload();
    await depot.locator("summary").click();

    const planA = await pdfPlan("Plan de fondations - indice A");
    await depot.locator('[name="fichier"]').setInputFiles({ name: "PL-FON-01_A.pdf", mimeType: "application/pdf", buffer: planA });
    await depot.locator('[name="categorie"]').selectOption("PLAN");
    await depot.locator('[name="titre"]').fill("Plan de fondations");
    await depot.locator('[name="reference"]').fill("PL-FON-01");
    await depot.locator('[name="indice"]').fill("A");
    await depot.getByLabel("Client", { exact: true }).check();
    await depot.getByRole("button", { name: "Déposer" }).click();
    await expect(depot.getByRole("status").filter({ hasText: "Document enregistré." })).toBeVisible();
    const doc = await db.document.findFirstOrThrow({ where: { titre: "Plan de fondations" }, include: { versions: true } });
    etat.doc = doc.id;
    etat.vA = doc.versions[0].id;
    expect(doc.versions[0].statut).toBe("EN_ATTENTE");
    await page.goto(`/documents/${etat.doc}`);
    await expect(page.getByText("En attente d'une autre personne habilitée").or(page.getByText("Aucune version n'est en vigueur")).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);

    // Le client ne voit rien tant que le plan n'est pas approuvé
    const ctxC = await browser.newContext();
    const client = await ctxC.newPage();
    await connexion(client, COMPTES.client.email);
    await client.goto(`/chantiers/${etat.chantier}`);
    await expect(client.getByText("Documents partagés (0)")).toBeVisible();
    expect((await client.request.get(`/api/fichiers/${etat.vA}`)).status()).toBe(404);

    const ctxD = await browser.newContext();
    const dt = await ctxD.newPage();
    accepterDialogues(dt);
    await connexion(dt, COMPTES.dt.email);
    await expect(dt.getByText(/Plan de fondations : version n°1 à approuver/)).toBeVisible();
    await dt.goto(`/documents/${etat.doc}`);
    await dt.getByRole("button", { name: "Approuver" }).click();
    await expect(dt.getByText("Approuvée — en vigueur", { exact: true }).first()).toBeVisible();

    await client.goto(`/chantiers/${etat.chantier}`);
    await expect(client.getByRole("cell", { name: /Plan de fondations/ })).toBeVisible();
    expect((await client.request.get(`/api/fichiers/${etat.vA}`)).status()).toBe(200);
    await expect(client.getByText("Photos (0)")).toBeVisible(); // la photo du chantier n'est pas partagée

    // Indice B : déposé par le conducteur, approuvé par le DT ; l'indice A devient « remplacé »
    await page.goto(`/documents/${etat.doc}`);
    await page.locator('[name="fichier"]').first().setInputFiles({ name: "PL-FON-01_B.pdf", mimeType: "application/pdf", buffer: await pdfPlan("Plan de fondations - indice B") });
    await page.locator('[name="indice"]').fill("B");
    await page.locator('[name="commentaire"]').fill("Semelles filantes élargies");
    await page.getByRole("button", { name: "Déposer la version" }).click();
    await expect(page.getByRole("status").filter({ hasText: "en vigueur après approbation" }).first()).toBeVisible();
    await dt.reload();
    await dt.getByRole("button", { name: "Approuver" }).click();
    await expect(dt.getByText("Approuvée — en vigueur", { exact: true }).first()).toBeVisible();
    await expect(dt.locator("tr", { hasText: "PL-FON-01_A.pdf" })).toContainText("Remplacée — ne plus utiliser");
    etat.vB = (await db.versionDocument.findFirstOrThrow({ where: { documentId: etat.doc, numero: 2 } })).id;

    const ancien = await dt.request.get(`/api/fichiers/${etat.vA}`);
    expect(ancien.status()).toBe(200);
    expect(ancien.headers()["content-disposition"]).toContain("_REMPLACE.pdf");
    const corps = await ancien.body();
    expect(corps.subarray(0, 5).toString()).toBe("%PDF-");
    expect(corps.length).not.toBe(planA.length); // tampon apposé

    // Portail : uniquement la version en vigueur, jamais l'historique
    expect((await client.request.get(`/api/fichiers/${etat.vA}`)).status()).toBe(404);
    expect((await client.request.get(`/api/fichiers/${etat.vB}`)).status()).toBe(200);
    await client.goto(`/documents/${etat.doc}`);
    await expect(client.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    await client.goto("/devis");
    await expect(client).toHaveURL(/acces-refuse/);
    await ctxC.close();
    await ctxD.close();
  });

  test("cloisonnement : un utilisateur non affecté n'atteint ni le planning, ni le budget, ni les rapports d'un autre chantier", async ({ page }) => {
    const autre = await db.chantier.findFirstOrThrow({ where: { code: "CLO-TOUBA-01" } });
    const mermoz = await db.chantier.findFirstOrThrow({ where: { nom: "Immeuble R+4 Mermoz" } });
    await connexion(page, COMPTES.metreur.email);
    for (const url of [`/chantiers/${mermoz.id}/planning`, `/chantiers/${mermoz.id}/budget`]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    }
    await connexion(page, COMPTES.chef.email);
    await page.goto(`/chantiers/${etat.chantier}/budget`);
    await expect(page).toHaveURL(/acces-refuse/);
    await page.goto(`/rapports/nouveau?chantier=${mermoz.id}`);
    await expect(page.locator('[name="chantierId"] option', { hasText: "Mermoz" })).toHaveCount(0);
    await page.goto(`/chantiers/${autre.id}/planning`);
    await expect(page.getByRole("heading", { name: /Planning · CLO-TOUBA-01/ })).toBeVisible();
    // Le journal d'audit trace les nouvelles opérations
    await connexion(page, COMPTES.admin.email);
    await page.goto("/admin/journal");
    for (const a of ["IMPORT", "VERIFICATION", "TRANSFORMATION", "REVISION", "RECALCUL"]) {
      await expect(page.getByRole("cell", { name: a, exact: true }).first()).toBeVisible();
    }
  });
});
