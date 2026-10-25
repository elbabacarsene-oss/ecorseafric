"use server";

import type { Prisma, Region, StatutChantier, TypeIntervenant, TypeProjet } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chantierAccessible } from "@/lib/acces";
import { AccesRefuse, verifierPermission, type UtilisateurConnecte } from "@/lib/auth";
import { evenementChantier, journaliser } from "@/lib/audit";
import { db } from "@/lib/db";
import { formatDate, formatXOF } from "@/lib/format";
import { choix, coche, date, decimal, entier, ErreurSaisie, executer, montant, texte } from "@/lib/formulaire";
import { REGIONS, STATUTS_CHANTIER, TYPES_PROJET } from "@/lib/libelles";
import { peut } from "@/lib/permissions";
import { ROLES_CLES, type ChampRole } from "@/lib/roles-cles";
import type { EtatAction } from "@/components/FormulaireAction";


async function lireRolesCles(fd: FormData) {
  const res = {} as Record<ChampRole, string | null>;
  for (const r of ROLES_CLES) {
    const id = texte(fd, r.champ, { requis: r.champ === "clientId", libelle: r.libelle });
    if (id) {
      const i = await db.intervenant.findUnique({ where: { id }, select: { categorie: true, type: true, actif: true } });
      if (!i) throw new ErreurSaisie(`${r.libelle} : intervenant introuvable.`);
      if (r.categorie && i.categorie !== r.categorie) throw new ErreurSaisie(`${r.libelle} : l'intervenant choisi n'appartient pas à la bonne catégorie.`);
      if (r.types && !(r.types as readonly TypeIntervenant[]).includes(i.type)) throw new ErreurSaisie(`${r.libelle} : type d'intervenant non admis.`);
    }
    res[r.champ] = id;
  }
  return res;
}

function lireChantier(fd: FormData) {
  const dateDemarrage = date(fd, "dateDemarrage", { libelle: "Date de démarrage" });
  const dateFinContractuelle = date(fd, "dateFinContractuelle", { libelle: "Date contractuelle de fin" });
  if (dateDemarrage && dateFinContractuelle && dateFinContractuelle < dateDemarrage) {
    throw new ErreurSaisie("La date contractuelle de fin doit être postérieure à la date de démarrage.");
  }
  const dateFinReelle = date(fd, "dateFinReelle", { libelle: "Date de fin réelle" });
  return {
    nom: texte(fd, "nom", { requis: true, libelle: "Nom du chantier", max: 200 })!,
    typeProjet: choix<TypeProjet>(fd, "typeProjet", TYPES_PROJET, { requis: true, libelle: "Type de projet" })!,
    statut: choix<StatutChantier>(fd, "statut", STATUTS_CHANTIER, { requis: true, libelle: "Statut" })!,
    description: texte(fd, "description", { max: 4000 }),
    adresse: texte(fd, "adresse", { max: 300 }),
    ville: texte(fd, "ville", { max: 100 }),
    region: choix<Region>(fd, "region", REGIONS),
    latitude: decimal(fd, "latitude", { libelle: "Latitude", min: -90, max: 90 }),
    longitude: decimal(fd, "longitude", { libelle: "Longitude", min: -180, max: 180 }),
    dateDemarrage,
    dateFinContractuelle,
    dateFinReelle,
  };
}

function lireFinances(fd: FormData, user: UtilisateurConnecte) {
  const f: { montantMarche?: number; budgetInitial?: number; budgetActualise?: number | null } = {};
  if (peut(user.role, "chantiers_marche", "modifier")) f.montantMarche = montant(fd, "montantMarche", { libelle: "Montant du marché" }) ?? 0;
  if (peut(user.role, "chantiers_budget", "modifier")) {
    f.budgetInitial = montant(fd, "budgetInitial", { libelle: "Budget initial" }) ?? 0;
    f.budgetActualise = montant(fd, "budgetActualise", { libelle: "Budget actualisé" });
  }
  return f;
}

/** Met en cohérence les affectations avec les rôles clés (une affectation par rôle clé renseigné). */
async function synchroniserAffectations(tx: Prisma.TransactionClient, chantierId: string, roles: Record<ChampRole, string | null>) {
  for (const r of ROLES_CLES) {
    const id = roles[r.champ];
    await tx.affectationChantier.deleteMany({ where: { chantierId, roleChantier: r.libelle, ...(id ? { intervenantId: { not: id } } : {}) } });
    if (id) {
      await tx.affectationChantier.upsert({
        where: { chantierId_intervenantId_roleChantier: { chantierId, intervenantId: id, roleChantier: r.libelle } },
        create: { chantierId, intervenantId: id, roleChantier: r.libelle },
        update: {},
      });
    }
  }
}

async function prochainCodeChantier(tx: Prisma.TransactionClient) {
  const annee = new Date().getUTCFullYear();
  const prefixe = `CH-${annee}-`;
  const dernier = await tx.chantier.findFirst({ where: { code: { startsWith: prefixe } }, orderBy: { code: "desc" }, select: { code: true } });
  const n = dernier ? Number(dernier.code.slice(prefixe.length)) + 1 : 1;
  return `${prefixe}${String(n).padStart(3, "0")}`;
}

export async function creerChantier(_: EtatAction, fd: FormData): Promise<EtatAction> {
  let id = "";
  const r = await executer(async () => {
    const { user } = await verifierPermission("chantiers", "creer");
    const data = lireChantier(fd);
    const roles = await lireRolesCles(fd);
    const finances = lireFinances(fd, user);
    const codeSaisi = texte(fd, "code", { max: 30, libelle: "Code chantier" })?.toUpperCase() ?? null;
    if (codeSaisi && !/^[A-Z0-9][A-Z0-9_\-/.]*$/.test(codeSaisi)) throw new ErreurSaisie("Le code chantier ne doit contenir que des lettres, chiffres, tirets, points ou barres obliques.");
    id = await db.$transaction(async (tx) => {
      const code = codeSaisi ?? (await prochainCodeChantier(tx));
      const c = await tx.chantier.create({ data: { ...data, ...roles, ...finances, code } as Prisma.ChantierUncheckedCreateInput });
      await synchroniserAffectations(tx, c.id, roles);
      await evenementChantier(c.id, "CREATION", `Création du chantier ${code} (${STATUTS_CHANTIER[data.statut]}).`, user.id, tx);
      await journaliser(user.id, "CREATION", "Chantier", c.id, { code, nom: data.nom }, tx);
      return c.id;
    });
  });
  if (r?.erreur || !id) return r;
  revalidatePath("/chantiers");
  redirect(`/chantiers/${id}`);
}

export async function modifierChantier(id: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  const r = await executer(async () => {
    const { user } = await verifierPermission("chantiers", "modifier");
    if (!(await chantierAccessible(user, id, "modifier"))) throw new AccesRefuse("Chantier introuvable ou non autorisé.");
    const avant = await db.chantier.findUniqueOrThrow({ where: { id } });
    const data = lireChantier(fd);
    const roles = await lireRolesCles(fd);
    const finances = lireFinances(fd, user);
    const apres = { ...data, ...roles, ...finances };
    const modifs: Record<string, { avant: string | null; apres: string | null }> = {};
    for (const [k, v] of Object.entries(apres)) {
      const a = avant[k as keyof typeof avant];
      const norm = (x: unknown) => (x === null || x === undefined ? null : x instanceof Date ? x.toISOString().slice(0, 10) : String(x));
      if (norm(a) !== norm(v)) modifs[k] = { avant: norm(a), apres: norm(v) };
    }
    if (Object.keys(modifs).length === 0) return { succes: "Aucune modification à enregistrer." };
    await db.$transaction(async (tx) => {
      await tx.chantier.update({ where: { id }, data: apres as Prisma.ChantierUncheckedUpdateInput });
      await synchroniserAffectations(tx, id, roles);
      if (modifs.statut) {
        await evenementChantier(id, "STATUT", `Statut : ${STATUTS_CHANTIER[avant.statut]} → ${STATUTS_CHANTIER[data.statut]}.`, user.id, tx);
      }
      const autres = Object.keys(modifs).filter((k) => k !== "statut");
      if (autres.length) {
        const details: string[] = [];
        if (modifs.montantMarche) details.push(`marché ${formatXOF(modifs.montantMarche.avant)} → ${formatXOF(modifs.montantMarche.apres)}`);
        if (modifs.budgetActualise) details.push(`budget actualisé ${modifs.budgetActualise.avant ? formatXOF(modifs.budgetActualise.avant) : "—"} → ${modifs.budgetActualise.apres ? formatXOF(modifs.budgetActualise.apres) : "—"}`);
        if (modifs.dateFinContractuelle) details.push(`fin contractuelle ${formatDate(modifs.dateFinContractuelle.avant)} → ${formatDate(modifs.dateFinContractuelle.apres)}`);
        await evenementChantier(id, "MODIFICATION", `Modification : ${autres.length} champ(s)${details.length ? " — " + details.join(" ; ") : ""}.`, user.id, tx);
      }
      await journaliser(user.id, "MODIFICATION", "Chantier", id, modifs, tx);
    });
  });
  if (r?.erreur || r?.succes) return r;
  revalidatePath(`/chantiers/${id}`);
  redirect(`/chantiers/${id}`);
}

// ───────────── Avenants ─────────────

export async function creerAvenant(chantierId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("avenants", "creer");
    if (!(await chantierAccessible(user, chantierId, "creer", "avenants"))) throw new AccesRefuse("Chantier non autorisé.");
    const objet = texte(fd, "objet", { requis: true, libelle: "Objet", max: 500 })!;
    const m = montant(fd, "montant", { requis: true, libelle: "Montant", negatifAutorise: true })!;
    const delai = entier(fd, "delai", { libelle: "Délai supplémentaire (jours)", min: 0 });
    const dateSignature = date(fd, "dateSignature", { libelle: "Date de signature" });
    await db.$transaction(async (tx) => {
      const max = await tx.avenant.aggregate({ where: { chantierId }, _max: { numero: true } });
      const numero = (max._max.numero ?? 0) + 1;
      const a = await tx.avenant.create({
        data: { chantierId, numero, objet, montant: m, delaiSupplementaireJours: delai, dateSignature, preparePar: user.id, statut: coche(fd, "soumettre") ? "SOUMIS" : "BROUILLON" },
      });
      await evenementChantier(chantierId, "AVENANT", `Avenant n°${numero} préparé (${formatXOF(m)}, +${delai} j) : ${objet}.`, user.id, tx);
      await journaliser(user.id, "CREATION", "Avenant", a.id, { chantierId, numero, montant: m }, tx);
    });
    revalidatePath(`/chantiers/${chantierId}`);
    return { succes: "Avenant enregistré.", jeton: Date.now() };
  });
}

async function avenantPourAction(avenantId: string, user: UtilisateurConnecte, action: "modifier" | "approuver") {
  const a = await db.avenant.findUnique({ where: { id: avenantId } });
  if (!a || !(await chantierAccessible(user, a.chantierId, action, "avenants"))) throw new AccesRefuse("Avenant introuvable ou non autorisé.");
  return a;
}

export async function soumettreAvenant(avenantId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("avenants", "modifier");
    const a = await avenantPourAction(avenantId, user, "modifier");
    if (a.statut !== "BROUILLON") return { erreur: "Seul un avenant en brouillon peut être soumis." };
    await db.$transaction(async (tx) => {
      await tx.avenant.update({ where: { id: a.id }, data: { statut: "SOUMIS" } });
      await evenementChantier(a.chantierId, "AVENANT", `Avenant n°${a.numero} soumis à approbation.`, user.id, tx);
      await journaliser(user.id, "SOUMISSION", "Avenant", a.id, undefined, tx);
    });
    revalidatePath(`/chantiers/${a.chantierId}`);
    return { succes: "Avenant soumis." };
  });
}

export async function deciderAvenant(avenantId: string, decision: "APPROUVE" | "REJETE", _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("avenants", "approuver");
    const a = await avenantPourAction(avenantId, user, "approuver");
    if (a.statut !== "SOUMIS") return { erreur: "Seul un avenant soumis peut être approuvé ou rejeté." };
    // Séparation des tâches : celui qui prépare n'approuve pas.
    if (a.preparePar === user.id) return { erreur: "Vous avez préparé cet avenant : son approbation doit être faite par une autre personne habilitée." };
    const motif = texte(fd, "motif", { max: 1000 });
    if (decision === "REJETE" && !motif) return { erreur: "Indiquez le motif du rejet." };
    await db.$transaction(async (tx) => {
      await tx.avenant.update({ where: { id: a.id }, data: { statut: decision, approuvePar: user.id, dateDecision: new Date(), motifDecision: motif } });
      await evenementChantier(
        a.chantierId,
        "AVENANT",
        `Avenant n°${a.numero} ${decision === "APPROUVE" ? "approuvé" : "rejeté"}${motif ? ` : ${motif}` : ""}.`,
        user.id,
        tx,
      );
      await journaliser(user.id, decision === "APPROUVE" ? "APPROBATION" : "REJET", "Avenant", a.id, { motif }, tx);
    });
    revalidatePath(`/chantiers/${a.chantierId}`);
    revalidatePath("/");
    return { succes: decision === "APPROUVE" ? "Avenant approuvé." : "Avenant rejeté." };
  });
}

// ───────────── Affectations ─────────────

export async function ajouterAffectation(chantierId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("affectations", "creer");
    if (!(await chantierAccessible(user, chantierId, "creer", "affectations"))) throw new AccesRefuse("Chantier non autorisé.");
    const intervenantId = texte(fd, "intervenantId", { requis: true, libelle: "Intervenant" })!;
    const roleChantier = texte(fd, "roleChantier", { requis: true, libelle: "Rôle sur le chantier", max: 150 })!;
    const dateDebut = date(fd, "dateDebut");
    const dateFin = date(fd, "dateFin");
    if (dateDebut && dateFin && dateFin < dateDebut) throw new ErreurSaisie("La date de fin doit suivre la date de début.");
    const accesPortail = coche(fd, "accesPortail");
    if (accesPortail && !peut(user.role, "affectations", "modifier")) throw new AccesRefuse("Vous ne pouvez pas ouvrir d'accès portail.");
    const i = await db.intervenant.findUnique({ where: { id: intervenantId }, select: { nom: true, actif: true } });
    if (!i?.actif) throw new ErreurSaisie("Intervenant introuvable ou inactif.");
    await db.$transaction(async (tx) => {
      const a = await tx.affectationChantier.create({ data: { chantierId, intervenantId, roleChantier, dateDebut, dateFin, accesPortail } });
      await evenementChantier(chantierId, "AFFECTATION", `${i.nom} affecté(e) : ${roleChantier}${accesPortail ? " (accès portail ouvert)" : ""}.`, user.id, tx);
      await journaliser(user.id, "CREATION", "Affectation", a.id, { chantierId, intervenantId, roleChantier, accesPortail }, tx);
    });
    revalidatePath(`/chantiers/${chantierId}`);
    return { succes: "Affectation ajoutée." };
  });
}

export async function retirerAffectation(affectationId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("affectations", "supprimer");
    const a = await db.affectationChantier.findUnique({ where: { id: affectationId }, include: { intervenant: { select: { nom: true } } } });
    if (!a || !(await chantierAccessible(user, a.chantierId, "supprimer", "affectations"))) throw new AccesRefuse("Affectation introuvable ou non autorisée.");
    if (ROLES_CLES.some((r) => r.libelle === a.roleChantier)) {
      return { erreur: "Rôle clé : modifiez-le depuis la fiche du chantier (bouton Modifier)." };
    }
    await db.$transaction(async (tx) => {
      await tx.affectationChantier.delete({ where: { id: a.id } });
      await evenementChantier(a.chantierId, "AFFECTATION", `${a.intervenant.nom} retiré(e) : ${a.roleChantier}.`, user.id, tx);
      await journaliser(user.id, "SUPPRESSION", "Affectation", a.id, { chantierId: a.chantierId, roleChantier: a.roleChantier }, tx);
    });
    revalidatePath(`/chantiers/${a.chantierId}`);
    return { succes: "Affectation retirée." };
  });
}

export async function basculerPortail(affectationId: string, _: EtatAction): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("affectations", "modifier");
    const a = await db.affectationChantier.findUnique({ where: { id: affectationId }, include: { intervenant: { select: { nom: true } } } });
    if (!a || !(await chantierAccessible(user, a.chantierId, "modifier", "affectations"))) throw new AccesRefuse("Affectation introuvable ou non autorisée.");
    await db.$transaction(async (tx) => {
      await tx.affectationChantier.update({ where: { id: a.id }, data: { accesPortail: !a.accesPortail } });
      await evenementChantier(a.chantierId, "AFFECTATION", `Accès portail ${a.accesPortail ? "fermé" : "ouvert"} pour ${a.intervenant.nom} (${a.roleChantier}).`, user.id, tx);
      await journaliser(user.id, a.accesPortail ? "FERMETURE_PORTAIL" : "OUVERTURE_PORTAIL", "Affectation", a.id, undefined, tx);
    });
    revalidatePath(`/chantiers/${a.chantierId}`);
    return { succes: a.accesPortail ? "Accès portail fermé." : "Accès portail ouvert." };
  });
}

export async function ajouterNote(chantierId: string, _: EtatAction, fd: FormData): Promise<EtatAction> {
  return executer(async () => {
    const { user } = await verifierPermission("chantiers", "modifier");
    if (!(await chantierAccessible(user, chantierId, "modifier"))) throw new AccesRefuse("Chantier non autorisé.");
    const note = texte(fd, "note", { requis: true, libelle: "Note", max: 2000 })!;
    await evenementChantier(chantierId, "NOTE", note, user.id);
    revalidatePath(`/chantiers/${chantierId}`);
    return { succes: "Note ajoutée à l'historique." };
  });
}
