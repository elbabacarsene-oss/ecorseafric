// Crée le premier compte administrateur (aucune donnée fictive n'est insérée).
// Usage : npm run creer-admin -- admin@ecorse-afric.sn "Prénom" "Nom"
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

async function main() {
  const [email, prenom = "Administrateur", nom = "ECORSE AFRIC"] = process.argv.slice(2);
  if (!email) {
    console.error('Usage : npm run creer-admin -- <email> ["Prénom"] ["Nom"]');
    process.exit(1);
  }
  const db = new PrismaClient();
  const mdp = process.env.ADMIN_MOT_DE_PASSE ?? randomBytes(9).toString("base64url") + "7";
  await db.entreprise.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const u = await db.utilisateur.create({
    data: { email: email.toLowerCase(), prenom, nom, role: "ADMIN", passwordHash: await bcrypt.hash(mdp, 12), doitChangerMdp: !process.env.ADMIN_MOT_DE_PASSE },
  });
  await db.journalAudit.create({ data: { action: "CREATION_ADMIN_INITIAL", entite: "Utilisateur", entiteId: u.id } });
  console.log(`Administrateur créé : ${u.email}`);
  if (!process.env.ADMIN_MOT_DE_PASSE) console.log(`Mot de passe provisoire (à changer à la première connexion) : ${mdp}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
