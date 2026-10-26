import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { URL_BASE_TEST } from "../../playwright.config";
import { MDP } from "./comptes";

export const db = new PrismaClient({ datasources: { db: { url: URL_BASE_TEST } } });

export async function connexion(page: Page, email: string, mdp = MDP) {
  await page.context().clearCookies(); // repartir d'une session vierge
  await page.goto("/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(mdp);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).not.toHaveURL(/\/connexion/);
}

export async function deconnexion(page: Page) {
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/connexion/);
}
