-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DIRECTEUR_GENERAL', 'DIRECTEUR_TECHNIQUE', 'DIRECTEUR_FINANCIER', 'CHEF_PROJET', 'CONDUCTEUR_TRAVAUX', 'CHEF_CHANTIER', 'METREUR', 'COMPTABLE', 'MAGASINIER', 'RESPONSABLE_QHSE', 'ACHETEUR', 'CLIENT', 'ARCHITECTE', 'BUREAU_ETUDES', 'BUREAU_CONTROLE', 'SOUS_TRAITANT', 'FOURNISSEUR');

-- CreateEnum
CREATE TYPE "CategorieIntervenant" AS ENUM ('MAITRISE_OUVRAGE', 'MAITRISE_OEUVRE', 'PERSONNEL_INTERNE', 'INTERVENANT_EXTERNE');

-- CreateEnum
CREATE TYPE "TypeIntervenant" AS ENUM ('CLIENT_PARTICULIER', 'PROMOTEUR', 'ENTREPRISE', 'ADMINISTRATION', 'INVESTISSEUR', 'ARCHITECTE', 'INGENIEUR', 'BUREAU_ETUDES', 'ECONOMISTE', 'GEOMETRE', 'LABORATOIRE', 'BUREAU_CONTROLE', 'DIRECTEUR', 'DIRECTEUR_TECHNIQUE', 'DIRECTEUR_FINANCIER', 'CONDUCTEUR_TRAVAUX', 'CHEF_PROJET', 'CHEF_CHANTIER', 'METREUR', 'COMPTABLE', 'MAGASINIER', 'RESPONSABLE_QHSE', 'ACHETEUR', 'OUVRIER', 'SOUS_TRAITANT', 'FOURNISSEUR', 'LOUEUR_MATERIEL', 'TRANSPORTEUR', 'CONSULTANT', 'ASSUREUR', 'BANQUE', 'ORGANISME_CONTROLE');

-- CreateEnum
CREATE TYPE "Region" AS ENUM ('DAKAR', 'DIOURBEL', 'FATICK', 'KAFFRINE', 'KAOLACK', 'KEDOUGOU', 'KOLDA', 'LOUGA', 'MATAM', 'SAINT_LOUIS', 'SEDHIOU', 'TAMBACOUNDA', 'THIES', 'ZIGUINCHOR');

-- CreateEnum
CREATE TYPE "TypeProjet" AS ENUM ('BATIMENT', 'IMMEUBLE', 'MAISON', 'ROUTE', 'TERRASSEMENT', 'ASSAINISSEMENT', 'VRD', 'CLOTURE', 'REHABILITATION', 'DEMOLITION', 'GENIE_CIVIL', 'AMENAGEMENT_EXTERIEUR');

-- CreateEnum
CREATE TYPE "StatutChantier" AS ENUM ('EN_PREPARATION', 'EN_COURS', 'SUSPENDU', 'RECEPTION_PROVISOIRE', 'RECEPTION_DEFINITIVE', 'CLOTURE', 'ANNULE');

-- CreateEnum
CREATE TYPE "StatutAvenant" AS ENUM ('BROUILLON', 'SOUMIS', 'APPROUVE', 'REJETE');

-- CreateTable
CREATE TABLE "Entreprise" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "raisonSociale" TEXT NOT NULL DEFAULT 'ECORSE AFRIC',
    "formeJuridique" TEXT,
    "ninea" TEXT,
    "rccm" TEXT,
    "adresse" TEXT,
    "ville" TEXT DEFAULT 'Dakar',
    "telephone" TEXT,
    "email" TEXT,
    "siteWeb" TEXT,
    "logo" BYTEA,
    "logoMime" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entreprise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utilisateur" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "telephone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "doitChangerMdp" BOOLEAN NOT NULL DEFAULT true,
    "tentativesEchouees" INTEGER NOT NULL DEFAULT 0,
    "verrouilleJusqua" TIMESTAMP(3),
    "derniereConnexion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "intervenantId" TEXT,

    CONSTRAINT "Utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalAudit" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT,
    "details" JSONB,
    "ip" TEXT,

    CONSTRAINT "JournalAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervenant" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categorie" "CategorieIntervenant" NOT NULL,
    "type" "TypeIntervenant" NOT NULL,
    "personneMorale" BOOLEAN NOT NULL DEFAULT false,
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "fonction" TEXT,
    "entreprise" TEXT,
    "telephone" TEXT,
    "telephone2" TEXT,
    "email" TEXT,
    "adresse" TEXT,
    "ville" TEXT,
    "region" "Region",
    "ninea" TEXT,
    "rccm" TEXT,
    "notes" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intervenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chantier" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "typeProjet" "TypeProjet" NOT NULL,
    "statut" "StatutChantier" NOT NULL DEFAULT 'EN_PREPARATION',
    "description" TEXT,
    "clientId" TEXT NOT NULL,
    "maitreOuvrageId" TEXT,
    "architecteId" TEXT,
    "bureauEtudesId" TEXT,
    "bureauControleId" TEXT,
    "conducteurId" TEXT,
    "chefChantierId" TEXT,
    "responsableQhseId" TEXT,
    "adresse" TEXT,
    "ville" TEXT,
    "region" "Region",
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "dateDemarrage" DATE,
    "dateFinContractuelle" DATE,
    "dateFinReelle" DATE,
    "montantMarche" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "budgetInitial" DECIMAL(18,0) NOT NULL DEFAULT 0,
    "budgetActualise" DECIMAL(18,0),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chantier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avenant" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "objet" TEXT NOT NULL,
    "montant" DECIMAL(18,0) NOT NULL,
    "delaiSupplementaireJours" INTEGER NOT NULL DEFAULT 0,
    "statut" "StatutAvenant" NOT NULL DEFAULT 'BROUILLON',
    "dateSignature" DATE,
    "preparePar" TEXT NOT NULL,
    "approuvePar" TEXT,
    "dateDecision" TIMESTAMP(3),
    "motifDecision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Avenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AffectationChantier" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "intervenantId" TEXT NOT NULL,
    "roleChantier" TEXT NOT NULL,
    "dateDebut" DATE,
    "dateFin" DATE,
    "accesPortail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffectationChantier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvenementChantier" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "EvenementChantier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_email_key" ON "Utilisateur"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Utilisateur_intervenantId_key" ON "Utilisateur"("intervenantId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "JournalAudit_entite_entiteId_idx" ON "JournalAudit"("entite", "entiteId");

-- CreateIndex
CREATE INDEX "JournalAudit_createdAt_idx" ON "JournalAudit"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Intervenant_code_key" ON "Intervenant"("code");

-- CreateIndex
CREATE INDEX "Intervenant_categorie_type_idx" ON "Intervenant"("categorie", "type");

-- CreateIndex
CREATE INDEX "Intervenant_nom_idx" ON "Intervenant"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "Chantier_code_key" ON "Chantier"("code");

-- CreateIndex
CREATE INDEX "Chantier_statut_idx" ON "Chantier"("statut");

-- CreateIndex
CREATE INDEX "Chantier_typeProjet_idx" ON "Chantier"("typeProjet");

-- CreateIndex
CREATE UNIQUE INDEX "Avenant_chantierId_numero_key" ON "Avenant"("chantierId", "numero");

-- CreateIndex
CREATE INDEX "AffectationChantier_intervenantId_idx" ON "AffectationChantier"("intervenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AffectationChantier_chantierId_intervenantId_roleChantier_key" ON "AffectationChantier"("chantierId", "intervenantId", "roleChantier");

-- CreateIndex
CREATE INDEX "EvenementChantier_chantierId_date_idx" ON "EvenementChantier"("chantierId", "date");

-- AddForeignKey
ALTER TABLE "Utilisateur" ADD CONSTRAINT "Utilisateur_intervenantId_fkey" FOREIGN KEY ("intervenantId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalAudit" ADD CONSTRAINT "JournalAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Intervenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_maitreOuvrageId_fkey" FOREIGN KEY ("maitreOuvrageId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_architecteId_fkey" FOREIGN KEY ("architecteId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_bureauEtudesId_fkey" FOREIGN KEY ("bureauEtudesId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_bureauControleId_fkey" FOREIGN KEY ("bureauControleId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_conducteurId_fkey" FOREIGN KEY ("conducteurId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_chefChantierId_fkey" FOREIGN KEY ("chefChantierId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_responsableQhseId_fkey" FOREIGN KEY ("responsableQhseId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avenant" ADD CONSTRAINT "Avenant_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avenant" ADD CONSTRAINT "Avenant_preparePar_fkey" FOREIGN KEY ("preparePar") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avenant" ADD CONSTRAINT "Avenant_approuvePar_fkey" FOREIGN KEY ("approuvePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffectationChantier" ADD CONSTRAINT "AffectationChantier_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffectationChantier" ADD CONSTRAINT "AffectationChantier_intervenantId_fkey" FOREIGN KEY ("intervenantId") REFERENCES "Intervenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementChantier" ADD CONSTRAINT "EvenementChantier_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvenementChantier" ADD CONSTRAINT "EvenementChantier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
