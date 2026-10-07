-- GED fase 2: OCR no servidor (fila ged-ocr). A origem OCR já existe em GedOrigemVersao (migração ged_base).
-- Estado do OCR por versão-base + cota mensal de páginas por cliente.
CREATE TYPE "GedStatusOcr" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'OCR_INDISPONIVEL', 'COTA_EXCEDIDA', 'ERRO');

ALTER TABLE "ged_versao_documento" ADD COLUMN "ocr_status" "GedStatusOcr";
ALTER TABLE "ged_versao_documento" ADD COLUMN "ocr_mensagem" TEXT;

ALTER TABLE "ged_config" ADD COLUMN "ocr_cota_paginas_mes" INTEGER DEFAULT 5000;

-- Varredura do worker: versões com OCR PENDENTE/PROCESSANDO (índice parcial; o Prisma não o expressa).
CREATE INDEX ged_versao_ocr_pendente ON ged_versao_documento (organizacao_id, created_at) WHERE ocr_status IN ('PENDENTE', 'PROCESSANDO');

-- Versão selada só admite mudar o status de indexação do texto: o trigger ged_versao_imutavel continua valendo
-- (OCR nunca roda em versão selada, então ocr_status/ocr_mensagem não são tocados nelas).
