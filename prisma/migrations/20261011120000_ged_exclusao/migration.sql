-- GED: exclusão controlada de documento, pasta (subárvore) e conteúdo de lote de importação (docs/ged.md §17).
-- Nenhuma trava de imutabilidade é desligada: o que é registro com valor jurídico (trâmite, comentário, solicitação/assinatura,
-- versão selada, protocolo e comprovante) continua impossível de apagar; só a versão NÃO selada passa a poder ser excluída,
-- e o documento é protegido por um trigger próprio.

-- AlterEnum: item da importação cujo documento foi excluído
ALTER TYPE "GedStatusItemImportacao" ADD VALUE 'REMOVIDO';

-- AlterTable
ALTER TABLE "ged_importacao" ADD COLUMN "conteudo_excluido_em" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "GedTipoExclusao" AS ENUM ('DOCUMENTO', 'PASTA', 'IMPORTACAO');
CREATE TYPE "GedStatusExclusao" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'FALHOU');

-- CreateTable
CREATE TABLE "ged_exclusao" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "tipo" "GedTipoExclusao" NOT NULL,
    "alvo_id" UUID NOT NULL,
    "alvo_rotulo" TEXT NOT NULL,
    "apenas_possiveis" BOOLEAN NOT NULL DEFAULT false,
    "status" "GedStatusExclusao" NOT NULL DEFAULT 'PENDENTE',
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "erro" TEXT,
    "total_documentos" INTEGER NOT NULL DEFAULT 0,
    "documentos_excluidos" INTEGER NOT NULL DEFAULT 0,
    "total_pastas" INTEGER NOT NULL DEFAULT 0,
    "pastas_excluidas" INTEGER NOT NULL DEFAULT 0,
    "versoes_excluidas" INTEGER NOT NULL DEFAULT 0,
    "bytes_excluidos" BIGINT NOT NULL DEFAULT 0,
    "bloqueados" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ged_exclusao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ged_exclusao_organizacao_id_status_idx" ON "ged_exclusao"("organizacao_id", "status");
CREATE INDEX "ged_exclusao_organizacao_id_created_at_idx" ON "ged_exclusao"("organizacao_id", "created_at");

-- AddForeignKey
ALTER TABLE "ged_exclusao" ADD CONSTRAINT "ged_exclusao_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Isolamento entre clientes (defesa em profundidade)
CREATE TRIGGER ged_exclusao_tenant BEFORE INSERT OR UPDATE ON ged_exclusao
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('criado_por_id', 'usuario');

-- Versões: a versão NÃO selada pode ser excluída (exclusão controlada). Continuam impossíveis de apagar: versão selada, versões de
-- origem SELO/COMPROVANTE (artefatos jurídicos gerados pelo sistema) e qualquer versão referenciada por um protocolo.
-- (A restrição de UPDATE da versão selada não muda. Solicitação de assinatura referencia a versão por FK RESTRICT.)
CREATE OR REPLACE FUNCTION ged_versao_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.selada OR OLD.origem IN ('SELO', 'COMPROVANTE') THEN
      RAISE EXCEPTION 'GED: versão selada, selo ou comprovante não pode ser excluído' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM ged_protocolo_documento WHERE versao_id = OLD.id)
       OR EXISTS (SELECT 1 FROM ged_protocolo WHERE comprovante_versao_id = OLD.id) THEN
      RAISE EXCEPTION 'GED: versão vinculada a protocolo não pode ser excluída' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.selada AND (
    (to_jsonb(NEW) - 'texto_status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'texto_status' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'GED: versão selada é imutável' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Documento: nunca se exclui documento assinado/selado, com código verificador, anexo de protocolo ou comprovante de protocolo
-- (trâmite, comentário e solicitação de assinatura já são protegidos por FK RESTRICT + trigger de imutabilidade).
CREATE OR REPLACE FUNCTION ged_documento_protegido() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ASSINADO' OR OLD.codigo_verificador IS NOT NULL THEN
    RAISE EXCEPTION 'GED: documento assinado/selado não pode ser excluído' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM ged_protocolo_documento WHERE documento_id = OLD.id)
     OR EXISTS (SELECT 1 FROM ged_protocolo WHERE comprovante_documento_id = OLD.id) THEN
    RAISE EXCEPTION 'GED: documento vinculado a protocolo não pode ser excluído' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ged_documento_protegido BEFORE DELETE ON ged_documento
  FOR EACH ROW EXECUTE FUNCTION ged_documento_protegido();
