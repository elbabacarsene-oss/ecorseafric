import { defineConfig, devices } from "@playwright/test";

// Tests de bout en bout sur une base dédiée (ecorse_btp_test), remise à zéro à chaque exécution.
export const URL_BASE_TEST = process.env.DATABASE_URL_TEST ?? "postgresql://ecorse:ecorse_dev@localhost:5432/ecorse_btp_test";
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, locale: "fr-FR", timezoneId: "Africa/Dakar", trace: "retain-on-failure" },
  projects: [
    { name: "ordinateur", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/connexion`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: URL_BASE_TEST, COOKIE_INSECURE: "1" },
  },
});
