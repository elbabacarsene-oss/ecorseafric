-- CreateEnum
CREATE TYPE "Unite" AS ENUM ('M', 'M2', 'M3', 'KG', 'TONNE', 'U', 'FORFAIT', 'HEURE', 'JOUR');

-- CreateEnum
CREATE TYPE "CategorieOuvrage" AS ENUM ('TERRASSEMENT', 'FONDATIONS', 'BETON_ARME', 'MACONNERIE', 'ETANCHEITE', 'CHARPENTE', 'COUVERTURE', 'ELECTRICITE', 'PLOMBERIE', 'CLIMATISATION', 'MENUISERIE', 'REVETEMENTS', 'PEINTURE', 'VRD', 'ASSAINISSEMENT', 'AMENAGEMENTS_EXTERIEURS');

-- CreateEnum
CREATE TYPE "TypeComposant" AS ENUM ('MATERIAU', 'MAIN_OEUVRE', 'MATERIEL', 'SOUS_TRAITANCE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutDevis" AS ENUM ('BROUILLON', 'SOUMIS', 'VALIDE', 'ENVOYE', 'ACCEPTE', 'REFUSE', 'REMPLACE');

-- CreateEnum
CREATE TYPE "OrigineLigne" AS ENUM ('SAISIE', 'BIBLIOTHEQUE', 'IMPORT');

-- CreateEnum
CREATE TYPE "StatutBudget" AS ENUM ('NON_ETABLI', 'BROUILLON', 'SOUMIS', 'VALIDE');

-- CreateEnum
CREATE TYPE "PosteBudget" AS ENUM ('MATERIAUX', 'MAIN_OEUVRE', 'MATERIEL', 'SOUS_TRAITANCE', 'FRAIS_CHANTIER', 'FRAIS_GENERAUX', 'AUTRE');

-- CreateEnum
CREATE TYPE "TypeTache" AS ENUM ('TACHE', 'JALON');

-- CreateEnum
CREATE TYPE "Meteo" AS ENUM ('ENSOLEILLE', 'NUAGEUX', 'PLUIE', 'FORTE_PLUIE', 'VENT_FORT', 'HARMATTAN', 'CHALEUR_EXTREME');

-- CreateEnum
CREATE TYPE "StatutRapport" AS ENUM ('BROUILLON', 'SOUMIS', 'VALIDE');

-- CreateEnum
CREATE TYPE "CategorieDocument" AS ENUM ('CONTRAT', 'MARCHE', 'PLAN', 'DEVIS', 'FACTURE', 'BON_COMMANDE', 'BON_LIVRAISON', 'RAPPORT', 'ATTACHEMENT', 'SITUATION', 'PROCES_VERBAL', 'ADMINISTRATIF', 'QHSE', 'PHOTO', 'DOSSIER_RECEPTION', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutVersion" AS ENUM ('EN_ATTENTE', 'APPROUVE', 'EN_VIGUEUR', 'REMPLACE', 'REJETE');

-- AlterTable
ALTER TABLE "Chantier" ADD COLUMN     "budgetDateValidation" TIMESTAMP(3),
ADD COLUMN     "budgetPreparePar" TEXT,
ADD COLUMN     "budgetStatut" "StatutBudget" NOT NULL DEFAULT 'NON_ETABLI',
ADD COLUMN     "budgetValidePar" TEXT,
ADD COLUMN     "planningReferenceLe" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Ouvrage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "categorie" "CategorieOuvrage" NOT NULL,
    "designation" TEXT NOT NULL,
    "unite" "Unite" NOT NULL,
    "description" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ouvrage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComposantOuvrage" (
    "id" TEXT NOT NULL,
    "ouvrageId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "type" "TypeComposant" NOT NULL,
    "designation" TEXT NOT NULL,
    "unite" "Unite" NOT NULL,
    "quantite" DECIMAL(18,4) NOT NULL,
    "prixUnitaire" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "ComposantOuvrage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Devis" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "variante" TEXT NOT NULL DEFAULT 'A',
    "version" INTEGER NOT NULL DEFAULT 1,
    "objet" TEXT NOT NULL,
    "statut" "StatutDevis" NOT NULL DEFAULT 'BROUILLON',
    "clientId" TEXT NOT NULL,
    "chantierId" TEXT,
    "typeProjet" "TypeProjet",
    "lieu" TEXT,
    "tauxFraisChantier" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "tauxFraisGeneraux" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "tauxMarge" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "tauxTva" DECIMAL(7,3) NOT NULL DEFAULT 18,
    "dateDevis" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateValidite" DATE,
    "delaiExecutionJours" INTEGER,
    "conditions" TEXT,
    "notesInternes" TEXT,
    "preparePar" TEXT NOT NULL,
    "validePar" TEXT,
    "dateDecision" TIMESTAMP(3),
    "motifDecision" TEXT,
    "dateEnvoi" TIMESTAMP(3),
    "dateReponse" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Devis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneDevis" (
    "id" TEXT NOT NULL,
    "devisId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "lot" TEXT NOT NULL,
    "ouvrageId" TEXT,
    "designation" TEXT NOT NULL,
    "unite" "Unite" NOT NULL,
    "quantite" DECIMAL(18,3) NOT NULL,
    "debourseSecUnitaire" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "prixUnitaireImpose" DECIMAL(18,0),
    "origine" "OrigineLigne" NOT NULL DEFAULT 'SAISIE',
    "verifiee" BOOLEAN NOT NULL DEFAULT true,
    "verifieePar" TEXT,
    "dateVerification" TIMESTAMP(3),

    CONSTRAINT "LigneDevis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SousDetailLigne" (
    "id" TEXT NOT NULL,
    "ligneId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "type" "TypeComposant" NOT NULL,
    "designation" TEXT NOT NULL,
    "unite" "Unite" NOT NULL,
    "quantite" DECIMAL(18,4) NOT NULL,
    "prixUnitaire" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "SousDetailLigne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneBudget" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "lot" TEXT NOT NULL,
    "poste" "PosteBudget" NOT NULL,
    "designation" TEXT NOT NULL,
    "montantInitial" DECIMAL(18,0) NOT NULL,
    "montantActualise" DECIMAL(18,0),
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LigneBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TachePlanning" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "parentId" TEXT,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "nom" TEXT NOT NULL,
    "type" "TypeTache" NOT NULL DEFAULT 'TACHE',
    "lot" TEXT,
    "corpsEtat" TEXT,
    "equipe" TEXT,
    "responsableId" TEXT,
    "intervenantId" TEXT,
    "debutPrevu" DATE NOT NULL,
    "finPrevue" DATE NOT NULL,
    "debutReference" DATE,
    "finReference" DATE,
    "debutReel" DATE,
    "finReelle" DATE,
    "avancement" INTEGER NOT NULL DEFAULT 0,
    "importante" BOOLEAN NOT NULL DEFAULT false,
    "ressources" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TachePlanning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DependanceTache" (
    "id" TEXT NOT NULL,
    "predecesseurId" TEXT NOT NULL,
    "successeurId" TEXT NOT NULL,
    "decalageJours" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DependanceTache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RapportJournalier" (
    "id" TEXT NOT NULL,
    "chantierId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "redacteurId" TEXT NOT NULL,
    "meteo" "Meteo",
    "meteoDetails" TEXT,
    "effectifTotal" INTEGER NOT NULL DEFAULT 0,
    "heuresTravaillees" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "personnel" JSONB NOT NULL DEFAULT '[]',
    "travaux" JSONB NOT NULL DEFAULT '[]',
    "materiauxConsommes" JSONB NOT NULL DEFAULT '[]',
    "materiauxLivres" JSONB NOT NULL DEFAULT '[]',
    "materiel" JSONB NOT NULL DEFAULT '[]',
    "travauxRealises" TEXT,
    "incidents" TEXT,
    "difficultes" TEXT,
    "instructions" TEXT,
    "observations" TEXT,
    "statut" "StatutRapport" NOT NULL DEFAULT 'BROUILLON',
    "soumisLe" TIMESTAMP(3),
    "validePar" TEXT,
    "valideLe" TIMESTAMP(3),
    "empreinteValidation" TEXT,
    "motifRenvoi" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RapportJournalier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "categorie" "CategorieDocument" NOT NULL,
    "titre" TEXT NOT NULL,
    "reference" TEXT,
    "lot" TEXT,
    "description" TEXT,
    "dateValidite" DATE,
    "partageExterne" "Role"[],
    "archive" BOOLEAN NOT NULL DEFAULT false,
    "chantierId" TEXT,
    "devisId" TEXT,
    "rapportId" TEXT,
    "creePar" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionDocument" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "indice" TEXT,
    "statut" "StatutVersion" NOT NULL,
    "fichierId" TEXT NOT NULL,
    "nomFichier" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "empreinte" TEXT NOT NULL,
    "commentaire" TEXT,
    "deposePar" TEXT NOT NULL,
    "deposeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidePar" TEXT,
    "decideLe" TIMESTAMP(3),
    "motif" TEXT,
    "remplaceLe" TIMESTAMP(3),

    CONSTRAINT "VersionDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fichier" (
    "id" TEXT NOT NULL,
    "contenu" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fichier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ouvrage_code_key" ON "Ouvrage"("code");

-- CreateIndex
CREATE INDEX "Ouvrage_categorie_idx" ON "Ouvrage"("categorie");

-- CreateIndex
CREATE INDEX "Devis_statut_idx" ON "Devis"("statut");

-- CreateIndex
CREATE INDEX "Devis_clientId_idx" ON "Devis"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Devis_numero_variante_version_key" ON "Devis"("numero", "variante", "version");

-- CreateIndex
CREATE INDEX "LigneDevis_devisId_ordre_idx" ON "LigneDevis"("devisId", "ordre");

-- CreateIndex
CREATE INDEX "LigneBudget_chantierId_idx" ON "LigneBudget"("chantierId");

-- CreateIndex
CREATE INDEX "TachePlanning_chantierId_ordre_idx" ON "TachePlanning"("chantierId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "DependanceTache_predecesseurId_successeurId_key" ON "DependanceTache"("predecesseurId", "successeurId");

-- CreateIndex
CREATE INDEX "RapportJournalier_statut_idx" ON "RapportJournalier"("statut");

-- CreateIndex
CREATE UNIQUE INDEX "RapportJournalier_chantierId_date_key" ON "RapportJournalier"("chantierId", "date");

-- CreateIndex
CREATE INDEX "Document_chantierId_categorie_idx" ON "Document"("chantierId", "categorie");

-- CreateIndex
CREATE INDEX "Document_devisId_idx" ON "Document"("devisId");

-- CreateIndex
CREATE INDEX "Document_rapportId_idx" ON "Document"("rapportId");

-- CreateIndex
CREATE UNIQUE INDEX "VersionDocument_fichierId_key" ON "VersionDocument"("fichierId");

-- CreateIndex
CREATE UNIQUE INDEX "VersionDocument_documentId_numero_key" ON "VersionDocument"("documentId", "numero");

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_budgetPreparePar_fkey" FOREIGN KEY ("budgetPreparePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chantier" ADD CONSTRAINT "Chantier_budgetValidePar_fkey" FOREIGN KEY ("budgetValidePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComposantOuvrage" ADD CONSTRAINT "ComposantOuvrage_ouvrageId_fkey" FOREIGN KEY ("ouvrageId") REFERENCES "Ouvrage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Intervenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_preparePar_fkey" FOREIGN KEY ("preparePar") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Devis" ADD CONSTRAINT "Devis_validePar_fkey" FOREIGN KEY ("validePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDevis" ADD CONSTRAINT "LigneDevis_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDevis" ADD CONSTRAINT "LigneDevis_ouvrageId_fkey" FOREIGN KEY ("ouvrageId") REFERENCES "Ouvrage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDevis" ADD CONSTRAINT "LigneDevis_verifieePar_fkey" FOREIGN KEY ("verifieePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SousDetailLigne" ADD CONSTRAINT "SousDetailLigne_ligneId_fkey" FOREIGN KEY ("ligneId") REFERENCES "LigneDevis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneBudget" ADD CONSTRAINT "LigneBudget_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TachePlanning" ADD CONSTRAINT "TachePlanning_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TachePlanning" ADD CONSTRAINT "TachePlanning_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TachePlanning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TachePlanning" ADD CONSTRAINT "TachePlanning_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TachePlanning" ADD CONSTRAINT "TachePlanning_intervenantId_fkey" FOREIGN KEY ("intervenantId") REFERENCES "Intervenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependanceTache" ADD CONSTRAINT "DependanceTache_predecesseurId_fkey" FOREIGN KEY ("predecesseurId") REFERENCES "TachePlanning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DependanceTache" ADD CONSTRAINT "DependanceTache_successeurId_fkey" FOREIGN KEY ("successeurId") REFERENCES "TachePlanning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RapportJournalier" ADD CONSTRAINT "RapportJournalier_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RapportJournalier" ADD CONSTRAINT "RapportJournalier_redacteurId_fkey" FOREIGN KEY ("redacteurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RapportJournalier" ADD CONSTRAINT "RapportJournalier_validePar_fkey" FOREIGN KEY ("validePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_chantierId_fkey" FOREIGN KEY ("chantierId") REFERENCES "Chantier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_rapportId_fkey" FOREIGN KEY ("rapportId") REFERENCES "RapportJournalier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_creePar_fkey" FOREIGN KEY ("creePar") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDocument" ADD CONSTRAINT "VersionDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDocument" ADD CONSTRAINT "VersionDocument_fichierId_fkey" FOREIGN KEY ("fichierId") REFERENCES "Fichier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDocument" ADD CONSTRAINT "VersionDocument_deposePar_fkey" FOREIGN KEY ("deposePar") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionDocument" ADD CONSTRAINT "VersionDocument_decidePar_fkey" FOREIGN KEY ("decidePar") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
