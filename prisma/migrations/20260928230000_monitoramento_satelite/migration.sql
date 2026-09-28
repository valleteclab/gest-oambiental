-- Monitoramento por satélite: alertas de desmatamento (INPE DETER/PRODES, MapBiomas) cruzados com CAR e licenças + execuções da sincronização.
-- CreateEnum
CREATE TYPE "FonteAlertaDesmatamento" AS ENUM ('DETER', 'PRODES', 'MAPBIOMAS');

-- CreateEnum
CREATE TYPE "StatusAlertaDesmatamento" AS ENUM ('NOVO', 'EM_ANALISE', 'AUTORIZADO', 'IRREGULAR', 'DESCARTADO');

-- CreateTable
CREATE TABLE "alerta_desmatamento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "fonte" "FonteAlertaDesmatamento" NOT NULL,
    "id_externo" TEXT NOT NULL,
    "classe" TEXT NOT NULL,
    "data_deteccao" DATE NOT NULL,
    "area_ha" DECIMAL(14,4) NOT NULL,
    "geometria" JSONB,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "status" "StatusAlertaDesmatamento" NOT NULL DEFAULT 'NOVO',
    "status_sugerido" TEXT,
    "cruzamento" JSONB,
    "cruzado_em" TIMESTAMP(3),
    "dados_fonte" JSONB,
    "fiscalizacao_id" UUID,
    "denuncia_id" UUID,
    "documento_id" UUID,
    "observacao" TEXT,
    "atualizado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerta_desmatamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoramento_sync" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "origem" TEXT NOT NULL,
    "usuario_id" UUID,
    "status" TEXT NOT NULL,
    "iniciado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluido_em" TIMESTAMP(3),
    "resumo" JSONB,
    "erro" TEXT,

    CONSTRAINT "monitoramento_sync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerta_desmatamento_municipio_id_status_idx" ON "alerta_desmatamento"("municipio_id", "status");

-- CreateIndex
CREATE INDEX "alerta_desmatamento_municipio_id_data_deteccao_idx" ON "alerta_desmatamento"("municipio_id", "data_deteccao");

-- CreateIndex
CREATE UNIQUE INDEX "alerta_desmatamento_fonte_id_externo_key" ON "alerta_desmatamento"("fonte", "id_externo");

-- CreateIndex
CREATE INDEX "monitoramento_sync_municipio_id_iniciado_em_idx" ON "monitoramento_sync"("municipio_id", "iniciado_em");

-- AddForeignKey
ALTER TABLE "alerta_desmatamento" ADD CONSTRAINT "alerta_desmatamento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta_desmatamento" ADD CONSTRAINT "alerta_desmatamento_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta_desmatamento" ADD CONSTRAINT "alerta_desmatamento_fiscalizacao_id_fkey" FOREIGN KEY ("fiscalizacao_id") REFERENCES "fiscalizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta_desmatamento" ADD CONSTRAINT "alerta_desmatamento_denuncia_id_fkey" FOREIGN KEY ("denuncia_id") REFERENCES "denuncia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta_desmatamento" ADD CONSTRAINT "alerta_desmatamento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documento_oficial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoramento_sync" ADD CONSTRAINT "monitoramento_sync_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitoramento_sync" ADD CONSTRAINT "monitoramento_sync_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

