import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { URL_BASE_TEST } from "../../playwright.config";
import { COMPTES, MDP } from "./comptes";

/**
 * Base de test vidée + comptes de test (uniquement dans la base de test).
 * Aucun chantier ni intervenant n'est pré-rempli : les tests les créent via l'interface.
 */
export default async function globalSetup() {
  // Le schéma est appliqué par « npm run test:e2e » (prisma migrate deploy) avant le démarrage du serveur.
  const db = new PrismaClient({ datasources: { db: { url: URL_BASE_TEST } } });
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  const hash = await bcrypt.hash(MDP, 12);
  await db.entreprise.create({ data: { id: 1 } });
  for (const c of Object.values(COMPTES)) {
    await db.utilisateur.create({ data: { email: c.email, prenom: c.prenom, nom: c.nom, role: c.role, passwordHash: hash, doitChangerMdp: false } });
  }
  await db.$disconnect();
}
