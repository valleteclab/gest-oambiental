-- GED importação v2: envio de pasta pelo navegador, ZIP grande em partes, ZIP aninhado e "unir pastas repetidas".
-- Sem tabela nova (isolamento por cliente e trigger ged_mesmo_tenant já valem para ged_importacao/ged_importacao_item).

-- AlterEnum
ALTER TYPE "GedStatusImportacao" ADD VALUE 'RECEBENDO';
ALTER TYPE "GedStatusItemImportacao" ADD VALUE 'RECEBIDO';

-- CreateEnum
CREATE TYPE "GedOrigemImportacao" AS ENUM ('ZIP', 'PASTA');

-- AlterTable
ALTER TABLE "ged_importacao" ADD COLUMN "origem" "GedOrigemImportacao" NOT NULL DEFAULT 'ZIP',
ADD COLUMN "unir_pastas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "partes_total" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "total_esperado" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ged_importacao_item" ADD COLUMN "storage_key" TEXT;

-- CreateIndex
CREATE INDEX "ged_importacao_item_importacao_id_caminho_idx" ON "ged_importacao_item"("importacao_id", "caminho");
