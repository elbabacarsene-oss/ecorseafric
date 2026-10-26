import { expect, test, type Page } from "@playwright/test";
import { COMPTES } from "./comptes";
import { connexion, db, deconnexion } from "./outils";

const etat: { ch1?: string; ch2?: string; client?: string; chef?: string } = {};

async function creerIntervenant(page: Page, type: string, nom: string, prenom?: string) {
  await page.goto("/intervenants/nouveau");
  await page.locator('[name="type"]').selectOption(type);
  await page.locator('[name="nom"]').fill(nom);
  if (prenom) await page.locator('[name="prenom"]').fill(prenom);
  await page.locator('[name="telephone"]').fill("+221 77 123 45 67");
  await page.getByRole("button", { name: "Créer l'intervenant" }).click();
  await expect(page).toHaveURL(/\/intervenants\/c[a-z0-9]+$/);
  return page.url().split("/").pop()!;
}

test.describe.serial("Socle – étape 1", () => {
  test("sans session, toute page renvoie vers la connexion", async ({ page }) => {
    for (const url of ["/", "/chantiers", "/intervenants", "/admin/utilisateurs"]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/connexion$/);
    }
  });

  test("un mauvais mot de passe est refusé sans révéler si le compte existe", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail").fill(COMPTES.dt.email);
    await page.getByLabel("Mot de passe").fill("mauvais-mdp-123");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
    await page.getByLabel("Adresse e-mail").fill("inconnu@test.sn");
    await page.getByLabel("Mot de passe").fill("mauvais-mdp-123");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.locator("p[role=alert]")).toHaveText("Adresse e-mail ou mot de passe incorrect.");
  });

  test("le tableau de bord vide affiche des zéros et des états vides, jamais de chiffres fictifs", async ({ page }) => {
    await connexion(page, COMPTES.dt.email);
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
    const tuile = page.locator(".carte", { hasText: "Chantiers actifs" });
    await expect(tuile).toContainText("0");
    await expect(page.getByText("Aucune donnée : module prévu à l'étape 4").first()).toBeVisible();
    await expect(page.getByText("Aucun chantier avec un montant de marché ou un budget saisi.")).toBeVisible();
    await expect(page.locator(".carte", { hasText: "Marge prévisionnelle" })).toContainText("Non calculable");
  });

  test("le directeur technique crée les parties prenantes", async ({ page }) => {
    await connexion(page, COMPTES.dt.email);
    etat.client = await creerIntervenant(page, "CLIENT_PARTICULIER", "Sarr", "Cheikh");
    await expect(page.getByRole("heading", { name: "Sarr Cheikh" })).toBeVisible();
    await expect(page.getByText(/MOA-0001/)).toBeVisible();
    etat.chef = await creerIntervenant(page, "CHEF_CHANTIER", "Fall", "Ibrahima");
    await expect(page.getByText(/INT-0001/)).toBeVisible();
    await creerIntervenant(page, "ARCHITECTE", "Cabinet Ba Architecture");

    // Modification + filtres de la liste
    await page.goto(`/intervenants/${etat.client}/modifier`);
    await page.locator('[name="email"]').fill("cheikh.sarr@exemple.sn");
    await page.getByRole("button", { name: "Enregistrer les modifications" }).click();
    await expect(page.getByText("cheikh.sarr@exemple.sn")).toBeVisible();
    await page.goto("/clients");
    await expect(page).toHaveURL(/categorie=MAITRISE_OUVRAGE/);
    await expect(page.getByRole("link", { name: "Sarr Cheikh" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Fall Ibrahima" })).toHaveCount(0);
  });

  test("l'administrateur lie les comptes aux fiches intervenants", async ({ page }) => {
    await connexion(page, COMPTES.admin.email);
    for (const [cle, fiche] of [["chef", etat.chef], ["client", etat.client]] as const) {
      const u = await db.utilisateur.findUniqueOrThrow({ where: { email: COMPTES[cle].email } });
      await page.goto(`/admin/utilisateurs/${u.id}`);
      await page.locator('[name="intervenantId"]').selectOption(fiche!);
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByRole("status")).toHaveText("Compte mis à jour.");
    }
  });

  test("création d'un chantier : données conservées après actualisation et reconnexion", async ({ page }) => {
    await connexion(page, COMPTES.dt.email);
    await page.goto("/chantiers/nouveau");
    await page.locator('[name="nom"]').fill("Immeuble R+4 Mermoz");
    await page.locator('[name="typeProjet"]').selectOption("IMMEUBLE");
    await page.locator('[name="statut"]').selectOption("EN_COURS");
    await page.locator('[name="clientId"]').selectOption(etat.client!);
    await page.locator('[name="ville"]').fill("Dakar");
    await page.locator('[name="region"]').selectOption("DAKAR");
    await page.locator('[name="dateDemarrage"]').fill("2026-01-05");
    await page.locator('[name="dateFinContractuelle"]').fill("2026-09-30");
    await page.locator('[name="montantMarche"]').fill("150 000 000");
    await page.locator('[name="budgetInitial"]').fill("120 000 000");
    await page.getByRole("button", { name: "Créer le chantier" }).click();
    await expect(page).toHaveURL(/\/chantiers\/c[a-z0-9]+$/);
    etat.ch1 = page.url().split("/").pop()!;
    await expect(page.getByText(/^CH-\d{4}-001 ·/)).toBeVisible();
    await expect(page.getByText(/30\s000\s000 F CFA \(20 %\)/)).toBeVisible();
    await expect(page.getByText(/En retard de \d+ jours/)).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Immeuble R+4 Mermoz" })).toBeVisible();

    await deconnexion(page);
    await connexion(page, COMPTES.dt.email);
    await page.goto("/chantiers");
    await expect(page.getByRole("link", { name: "Immeuble R+4 Mermoz" })).toBeVisible();
    // Le tableau de bord reflète maintenant les données enregistrées
    await page.goto("/");
    await expect(page.locator(".carte", { hasText: "Chantiers actifs" })).toContainText("1");
    await expect(page.locator(".carte", { hasText: "Montant total des marchés" })).toContainText(/150\s000\s000/);

    // Second chantier, confié au chef de chantier
    await page.goto("/chantiers/nouveau");
    await page.locator('[name="code"]').fill("CLO-TOUBA-01");
    await page.locator('[name="nom"]').fill("Clôture villa Touba");
    await page.locator('[name="typeProjet"]').selectOption("CLOTURE");
    await page.locator('[name="clientId"]').selectOption(etat.client!);
    await page.locator('[name="chefChantierId"]').selectOption(etat.chef!);
    await page.getByRole("button", { name: "Créer le chantier" }).click();
    await expect(page).toHaveURL(/\/chantiers\/c[a-z0-9]+$/);
    etat.ch2 = page.url().split("/").pop()!;

    // Filtres de la liste
    await page.goto("/chantiers?retard=1");
    await expect(page.getByRole("link", { name: "Immeuble R+4 Mermoz" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Clôture villa Touba" })).toHaveCount(0);
    await page.goto("/chantiers?type=CLOTURE");
    await expect(page.getByRole("link", { name: "Clôture villa Touba" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Immeuble R+4 Mermoz" })).toHaveCount(0);
  });

  test("avenant : celui qui prépare ne peut pas approuver ; la direction approuve", async ({ page }) => {
    await connexion(page, COMPTES.dt.email);
    await page.goto(`/chantiers/${etat.ch1}`);
    await page.getByText("Préparer un avenant").click();
    await page.locator('[name="objet"]').fill("Ajout d'un niveau de parking");
    await page.locator('[name="montant"]').fill("10 000 000");
    await page.locator('[name="delai"]').fill("30");
    await page.getByLabel("Soumettre directement à approbation").check();
    await page.getByRole("button", { name: "Enregistrer l'avenant" }).click();
    await expect(page.getByRole("status")).toHaveText("Avenant enregistré.");
    await expect(page.getByText("En attente d'un autre approbateur")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approuver" })).toHaveCount(0);
    await deconnexion(page);

    await connexion(page, COMPTES.dg.email);
    await expect(page.getByText(/avenant n°1 .* à approuver/)).toBeVisible();
    await page.goto(`/chantiers/${etat.ch1}`);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Approuver" }).click();
    // Une fois approuvé, l'avenant n'a plus de boutons : la ligne affiche le statut et l'approbateur.
    await expect(page.locator("tr", { hasText: "Ajout d'un niveau de parking" })).toContainText("Approuvé");
    await expect(page.locator("tr", { hasText: "Ajout d'un niveau de parking" })).toContainText("Fatou Ndiaye");
    await page.reload();
    await expect(page.locator("dd", { hasText: /160\s000\s000 F CFA/ })).toBeVisible();
    await expect(page.getByText("(+30 j)")).toBeVisible();
  });

  test("un chef de chantier ne voit que ses chantiers, même en modifiant l'adresse", async ({ page }) => {
    await connexion(page, COMPTES.chef.email);
    await expect(page).toHaveURL(/\/chantiers$/); // pas de tableau de bord direction
    await expect(page.getByRole("link", { name: "Clôture villa Touba" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Immeuble R+4 Mermoz" })).toHaveCount(0);
    await page.goto(`/chantiers/${etat.ch1}`);
    await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    await page.goto(`/chantiers/${etat.ch2}/modifier`);
    await expect(page).toHaveURL(/acces-refuse/);
    await page.goto("/admin/utilisateurs");
    await expect(page).toHaveURL(/acces-refuse/);
    await page.goto("/admin/journal");
    await expect(page).toHaveURL(/acces-refuse/);
    // Pas de budget ni de marge pour ce rôle
    await page.goto(`/chantiers/${etat.ch2}`);
    await expect(page.getByText("Marge prévisionnelle")).toHaveCount(0);
  });

  test("une action serveur rejouée par un utilisateur non autorisé est refusée côté serveur", async ({ page, browser }) => {
    await connexion(page, COMPTES.dt.email);
    await page.goto(`/chantiers/${etat.ch1}`);
    const requete = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
    await page.locator('[name="note"]').fill("Visite du bureau de contrôle");
    await page.getByRole("button", { name: "Ajouter au journal" }).click();
    const req = await requete;
    await expect(page.getByRole("status")).toHaveText("Note ajoutée à l'historique.");
    const corps = req.postDataBuffer()!;
    const entetes = req.headers();

    const ctx = await browser.newContext();
    const pageChef = await ctx.newPage();
    await connexion(pageChef, COMPTES.chef.email);
    const rep = await pageChef.request.post(req.url(), {
      headers: { "next-action": entetes["next-action"], "content-type": entetes["content-type"], accept: "text/x-component", "next-router-state-tree": entetes["next-router-state-tree"] ?? "" },
      data: corps,
    });
    expect(await rep.text()).toContain("autorisation");
    await ctx.close();

    const notes = await db.evenementChantier.count({ where: { chantierId: etat.ch1, type: "NOTE", description: "Visite du bureau de contrôle" } });
    expect(notes).toBe(1);
  });

  test("portail client : aucun accès tant que le portail n'est pas ouvert, puis vue restreinte", async ({ page, browser }) => {
    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    await connexion(client, COMPTES.client.email);
    await expect(client.getByText("Aucun chantier ne vous a encore été ouvert.")).toBeVisible();
    await client.goto(`/chantiers/${etat.ch1}`);
    await expect(client.getByRole("heading", { name: "Page introuvable" })).toBeVisible();

    await connexion(page, COMPTES.dt.email);
    await page.goto(`/chantiers/${etat.ch1}`);
    const ligne = page.locator("tr", { hasText: "Sarr Cheikh" }).filter({ hasText: "Client" }).first();
    await ligne.getByRole("button", { name: "Ouvrir le portail" }).click();
    await expect(page.getByRole("status")).toHaveText("Accès portail ouvert.");

    await client.goto(`/chantiers/${etat.ch1}`);
    await expect(client.getByRole("heading", { name: "Immeuble R+4 Mermoz" })).toBeVisible();
    await expect(client.locator("dd", { hasText: /160\s000\s000 F CFA/ })).toBeVisible();
    await expect(client.getByText("Budget initial")).toHaveCount(0);
    await expect(client.getByText("Marge prévisionnelle")).toHaveCount(0);
    await expect(client.getByText("Historique des événements")).toHaveCount(0);
    await expect(client.getByText("Équipe et intervenants affectés")).toHaveCount(0);
    await client.goto(`/chantiers/${etat.ch2}`);
    await expect(client.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    await client.goto("/intervenants");
    await expect(client).toHaveURL(/acces-refuse/);
    await client.goto(`/intervenants/${etat.chef}`);
    await expect(client).toHaveURL(/acces-refuse/);
    await ctx.close();
  });

  test("création d'un compte par l'administrateur et changement obligatoire du mot de passe provisoire", async ({ page }) => {
    await connexion(page, COMPTES.admin.email);
    await page.goto("/admin/utilisateurs/nouveau");
    await page.locator('[name="prenom"]').fill("Aminata");
    await page.locator('[name="nom"]').fill("Kane");
    await page.locator('[name="email"]').fill("comptable@test.sn");
    await page.locator('[name="role"]').selectOption("COMPTABLE");
    await page.getByRole("button", { name: "Créer le compte" }).click();
    const message = await page.getByRole("status").textContent();
    const mdp = /Mot de passe provisoire : (\S+)/.exec(message ?? "")![1];
    await deconnexion(page);

    await connexion(page, "comptable@test.sn", mdp);
    await expect(page).toHaveURL(/changer-mot-de-passe/);
    await page.goto("/chantiers");
    await expect(page).toHaveURL(/changer-mot-de-passe/);
    await page.locator('[name="actuel"]').fill(mdp);
    await page.locator('[name="nouveau"]').fill("NouveauMdp2026");
    await page.locator('[name="confirmation"]').fill("NouveauMdp2026");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  });

  test("un compte externe ne peut pas être créé sans fiche intervenant", async ({ page }) => {
    await connexion(page, COMPTES.admin.email);
    await page.goto("/admin/utilisateurs/nouveau");
    await page.locator('[name="prenom"]').fill("Test");
    await page.locator('[name="nom"]').fill("Fournisseur");
    await page.locator('[name="email"]').fill("fournisseur@test.sn");
    await page.locator('[name="role"]').selectOption("FOURNISSEUR");
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.locator("p[role=alert]")).toContainText("doit être lié à une fiche intervenant");
  });

  test("le journal d'audit trace les opérations sensibles", async ({ page }) => {
    await connexion(page, COMPTES.admin.email);
    await page.goto("/admin/journal");
    for (const a of ["CONNEXION", "ECHEC_CONNEXION", "APPROBATION", "OUVERTURE_PORTAIL", "CHANGEMENT_MOT_DE_PASSE"]) {
      await expect(page.getByRole("cell", { name: a, exact: true }).first()).toBeVisible();
    }
  });

  test("version mobile : menu repliable", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await connexion(p, COMPTES.dt.email);
    await p.getByRole("button", { name: "Ouvrir le menu" }).click();
    await p.getByRole("link", { name: "Parties prenantes" }).click();
    await expect(p.getByRole("heading", { name: "Parties prenantes" })).toBeVisible();
    const largeur = await p.evaluate(() => document.documentElement.scrollWidth);
    expect(largeur).toBeLessThanOrEqual(390);
    await ctx.close();
  });
});
