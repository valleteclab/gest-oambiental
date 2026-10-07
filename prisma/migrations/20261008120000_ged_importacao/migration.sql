-- GED fase 2: importação em lote de ZIP (lote + itens). Isolamento por cliente: organizacao_id NOT NULL e trigger ged_mesmo_tenant.

-- CreateEnum
CREATE TYPE "GedStatusImportacao" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'CONCLUIDA_COM_ERROS', 'FALHOU');

-- CreateEnum
CREATE TYPE "GedStatusItemImportacao" AS ENUM ('IMPORTADO', 'DUPLICADO', 'IGNORADO', 'ERRO');

-- CreateTable
CREATE TABLE "ged_importacao" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "tamanho_zip" INTEGER NOT NULL,
    "sha256_zip" TEXT NOT NULL,
    "storage_key" TEXT,
    "pasta_destino_id" UUID,
    "tipo_id" UUID,
    "sensibilidade" "GedSensibilidade" NOT NULL,
    "status" "GedStatusImportacao" NOT NULL DEFAULT 'PENDENTE',
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "erro" TEXT,
    "total_arquivos" INTEGER NOT NULL DEFAULT 0,
    "importados" INTEGER NOT NULL DEFAULT 0,
    "duplicados" INTEGER NOT NULL DEFAULT 0,
    "ignorados" INTEGER NOT NULL DEFAULT 0,
    "com_erro" INTEGER NOT NULL DEFAULT 0,
    "ocultos" INTEGER NOT NULL DEFAULT 0,
    "pastas_criadas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ged_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_importacao_item" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importacao_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "caminho" TEXT NOT NULL,
    "status" "GedStatusItemImportacao" NOT NULL,
    "motivo" TEXT,
    "documento_id" UUID,
    "pasta_id" UUID,
    "sha256" TEXT,
    "tamanho" INTEGER,

    CONSTRAINT "ged_importacao_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ged_importacao_organizacao_id_created_at_idx" ON "ged_importacao"("organizacao_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_importacao_organizacao_id_status_idx" ON "ged_importacao"("organizacao_id", "status");

-- CreateIndex
CREATE INDEX "ged_importacao_item_organizacao_id_importacao_id_status_idx" ON "ged_importacao_item"("organizacao_id", "importacao_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ged_importacao_item_importacao_id_ordem_key" ON "ged_importacao_item"("importacao_id", "ordem");

-- CreateIndex (deduplicação por sha256 dentro da organização)
CREATE INDEX "ged_versao_documento_organizacao_id_sha256_idx" ON "ged_versao_documento"("organizacao_id", "sha256");

-- AddForeignKey
ALTER TABLE "ged_importacao" ADD CONSTRAINT "ged_importacao_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_importacao_item" ADD CONSTRAINT "ged_importacao_item_importacao_id_fkey" FOREIGN KEY ("importacao_id") REFERENCES "ged_importacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_importacao_item" ADD CONSTRAINT "ged_importacao_item_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Isolamento entre clientes (defesa em profundidade): toda referência aponta para linha da MESMA organização.
CREATE TRIGGER ged_importacao_tenant BEFORE INSERT OR UPDATE ON ged_importacao
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('criado_por_id', 'usuario', 'pasta_destino_id', 'ged_pasta', 'tipo_id', 'ged_tipo_documento');
CREATE TRIGGER ged_importacao_item_tenant BEFORE INSERT OR UPDATE ON ged_importacao_item
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('importacao_id', 'ged_importacao', 'documento_id', 'ged_documento', 'pasta_id', 'ged_pasta');
