-- GED – Protocolo: livro de entrada/saída/interno, andamento imutável, anexos, assuntos do portal público e comprovante.
-- Isolamento por cliente: organizacao_id NOT NULL, primeiro campo dos índices, gatilho ged_mesmo_tenant em todas as referências.

-- CreateEnum
CREATE TYPE "GedLivroProtocolo" AS ENUM ('ENTRADA', 'SAIDA', 'INTERNO');

-- CreateEnum
CREATE TYPE "GedSituacaoProtocolo" AS ENUM ('RECEBIDO', 'EM_ANALISE', 'ENCAMINHADO', 'RESPONDIDO', 'ARQUIVADO', 'INDEFERIDO', 'DEVOLVIDO');

-- CreateEnum
CREATE TYPE "GedPrioridadeProtocolo" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "GedOrigemProtocolo" AS ENUM ('BALCAO', 'PORTAL');

-- CreateEnum
CREATE TYPE "GedTipoEventoProtocolo" AS ENUM ('REGISTRO', 'ANALISE', 'ENCAMINHAMENTO', 'RESPOSTA', 'ARQUIVAMENTO', 'DEVOLUCAO', 'INDEFERIMENTO');

-- AlterEnum
ALTER TYPE "GedOrigemVersao" ADD VALUE 'COMPROVANTE';

-- AlterTable
ALTER TABLE "ged_comunicacao" ADD COLUMN     "protocolo_id" UUID,
ALTER COLUMN "usuario_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ged_config" ADD COLUMN     "protocolo_max_anexos" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "protocolo_max_mb" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "protocolo_orientacao" TEXT,
ADD COLUMN     "protocolo_portal_ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "protocolo_responsavel_id" UUID;

-- AlterTable
ALTER TABLE "organizacao" ADD COLUMN     "slug_publico" TEXT;

-- CreateTable
CREATE TABLE "ged_protocolo" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "livro" "GedLivroProtocolo" NOT NULL,
    "ano" INTEGER NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "numero" TEXT NOT NULL,
    "origem" "GedOrigemProtocolo" NOT NULL,
    "assunto" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo_documento_id" UUID,
    "prioridade" "GedPrioridadeProtocolo" NOT NULL DEFAULT 'NORMAL',
    "prazo_resposta_em" TIMESTAMP(3),
    "origem_setor_id" UUID,
    "interessado_nome_cifrado" TEXT,
    "interessado_doc_cifrado" TEXT,
    "interessado_doc_hash" TEXT,
    "interessado_email_cifrado" TEXT,
    "interessado_telefone_cifrado" TEXT,
    "destino_setor_id" UUID,
    "destino_usuario_id" UUID,
    "criado_por_id" UUID,
    "consentimento_lgpd_em" TIMESTAMP(3),
    "codigo_consulta" TEXT NOT NULL,
    "codigo_verificacao" TEXT NOT NULL,
    "situacao" "GedSituacaoProtocolo" NOT NULL DEFAULT 'RECEBIDO',
    "setor_atual_id" UUID,
    "responsavel_id" UUID,
    "concluido_em" TIMESTAMP(3),
    "comprovante_documento_id" UUID,
    "comprovante_versao_id" UUID,
    "comprovante_sha256" TEXT,
    "comprovante_emitido_em" TIMESTAMP(3),
    "comprovante_assinado" BOOLEAN,

    CONSTRAINT "ged_protocolo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_protocolo_evento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "protocolo_id" UUID NOT NULL,
    "tipo" "GedTipoEventoProtocolo" NOT NULL,
    "situacao_de" "GedSituacaoProtocolo",
    "situacao_para" "GedSituacaoProtocolo" NOT NULL,
    "usuario_id" UUID,
    "para_setor_id" UUID,
    "para_usuario_id" UUID,
    "texto" TEXT,
    "texto_publico" TEXT,

    CONSTRAINT "ged_protocolo_evento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_protocolo_documento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "protocolo_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "versao_id" UUID NOT NULL,
    "evento_id" UUID,
    "finalidade" TEXT NOT NULL DEFAULT 'ANEXO',
    "nome_arquivo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,

    CONSTRAINT "ged_protocolo_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_protocolo_assunto" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "destino_setor_id" UUID NOT NULL,
    "tipo_documento_id" UUID,
    "prioridade" "GedPrioridadeProtocolo" NOT NULL DEFAULT 'NORMAL',
    "prazo_dias" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ged_protocolo_assunto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ged_protocolo_codigo_verificacao_key" ON "ged_protocolo"("codigo_verificacao");

-- CreateIndex
CREATE INDEX "ged_protocolo_organizacao_id_livro_ano_situacao_idx" ON "ged_protocolo"("organizacao_id", "livro", "ano", "situacao");

-- CreateIndex
CREATE INDEX "ged_protocolo_organizacao_id_created_at_idx" ON "ged_protocolo"("organizacao_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_protocolo_organizacao_id_interessado_doc_hash_idx" ON "ged_protocolo"("organizacao_id", "interessado_doc_hash");

-- CreateIndex
CREATE INDEX "ged_protocolo_organizacao_id_setor_atual_id_situacao_idx" ON "ged_protocolo"("organizacao_id", "setor_atual_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "ged_protocolo_organizacao_id_numero_key" ON "ged_protocolo"("organizacao_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ged_protocolo_organizacao_id_livro_ano_sequencia_key" ON "ged_protocolo"("organizacao_id", "livro", "ano", "sequencia");

-- CreateIndex
CREATE UNIQUE INDEX "ged_protocolo_organizacao_id_codigo_consulta_key" ON "ged_protocolo"("organizacao_id", "codigo_consulta");

-- CreateIndex
CREATE INDEX "ged_protocolo_evento_organizacao_id_protocolo_id_created_at_idx" ON "ged_protocolo_evento"("organizacao_id", "protocolo_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_protocolo_documento_organizacao_id_protocolo_id_idx" ON "ged_protocolo_documento"("organizacao_id", "protocolo_id");

-- CreateIndex
CREATE INDEX "ged_protocolo_documento_organizacao_id_documento_id_idx" ON "ged_protocolo_documento"("organizacao_id", "documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_protocolo_documento_protocolo_id_documento_id_key" ON "ged_protocolo_documento"("protocolo_id", "documento_id");

-- CreateIndex
CREATE INDEX "ged_protocolo_assunto_organizacao_id_ativo_ordem_idx" ON "ged_protocolo_assunto"("organizacao_id", "ativo", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "ged_protocolo_assunto_organizacao_id_nome_key" ON "ged_protocolo_assunto"("organizacao_id", "nome");

-- CreateIndex
CREATE INDEX "ged_comunicacao_organizacao_id_protocolo_id_idx" ON "ged_comunicacao"("organizacao_id", "protocolo_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizacao_slug_publico_key" ON "organizacao"("slug_publico");

-- AddForeignKey
ALTER TABLE "ged_protocolo" ADD CONSTRAINT "ged_protocolo_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_protocolo_evento" ADD CONSTRAINT "ged_protocolo_evento_protocolo_id_fkey" FOREIGN KEY ("protocolo_id") REFERENCES "ged_protocolo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_protocolo_evento" ADD CONSTRAINT "ged_protocolo_evento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_protocolo_documento" ADD CONSTRAINT "ged_protocolo_documento_protocolo_id_fkey" FOREIGN KEY ("protocolo_id") REFERENCES "ged_protocolo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_protocolo_documento" ADD CONSTRAINT "ged_protocolo_documento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_protocolo_assunto" ADD CONSTRAINT "ged_protocolo_assunto_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── Protocolo do GED: isolamento, imutabilidade e restrições ─────────────
-- Código de consulta/verificação: só caracteres do alfabeto do código (sem 0/O/1/I), formato XXXX-XXXX-XXXX.
ALTER TABLE ged_protocolo ADD CONSTRAINT ged_protocolo_codigos_chk CHECK (
  codigo_consulta ~ '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$'
  AND codigo_verificacao ~ '^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$'
  AND codigo_consulta <> codigo_verificacao
);
-- Slug público do portal: minúsculas, números e hífen (3 a 60 caracteres).
ALTER TABLE organizacao ADD CONSTRAINT organizacao_slug_publico_chk CHECK (slug_publico IS NULL OR slug_publico ~ '^[a-z0-9]([a-z0-9-]{1,58})[a-z0-9]$');
-- Anexo: nome do arquivo e hash coerentes.
ALTER TABLE ged_protocolo_documento ADD CONSTRAINT ged_protocolo_documento_sha_chk CHECK (sha256 ~ '^[0-9a-f]{64}$');

-- Toda referência aponta para linha da MESMA organização (ver ged_mesmo_tenant na migração ged_base).
CREATE TRIGGER ged_protocolo_tenant BEFORE INSERT OR UPDATE ON ged_protocolo
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'tipo_documento_id', 'ged_tipo_documento', 'origem_setor_id', 'ged_setor', 'destino_setor_id', 'ged_setor',
    'destino_usuario_id', 'usuario', 'criado_por_id', 'usuario', 'setor_atual_id', 'ged_setor', 'responsavel_id', 'usuario',
    'comprovante_documento_id', 'ged_documento', 'comprovante_versao_id', 'ged_versao_documento');
CREATE TRIGGER ged_protocolo_evento_tenant BEFORE INSERT OR UPDATE ON ged_protocolo_evento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'protocolo_id', 'ged_protocolo', 'usuario_id', 'usuario', 'para_setor_id', 'ged_setor', 'para_usuario_id', 'usuario');
CREATE TRIGGER ged_protocolo_documento_tenant BEFORE INSERT OR UPDATE ON ged_protocolo_documento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'protocolo_id', 'ged_protocolo', 'documento_id', 'ged_documento', 'versao_id', 'ged_versao_documento', 'evento_id', 'ged_protocolo_evento');
CREATE TRIGGER ged_protocolo_assunto_tenant BEFORE INSERT OR UPDATE ON ged_protocolo_assunto
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('destino_setor_id', 'ged_setor', 'tipo_documento_id', 'ged_tipo_documento');
-- GedConfig e GedComunicacao ganharam referências novas: recria os gatilhos incluindo-as.
DROP TRIGGER ged_config_tenant ON ged_config;
CREATE TRIGGER ged_config_tenant BEFORE INSERT OR UPDATE ON ged_config
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('canal_whatsapp_id', 'canal_atendimento', 'protocolo_responsavel_id', 'usuario');
DROP TRIGGER ged_comunicacao_tenant ON ged_comunicacao;
CREATE TRIGGER ged_comunicacao_tenant BEFORE INSERT OR UPDATE ON ged_comunicacao
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'documento_id', 'ged_documento', 'usuario_id', 'usuario', 'assinante_id', 'ged_assinante', 'protocolo_id', 'ged_protocolo');
-- Comunicação sempre tem um destinatário: usuário interno OU protocolo (interessado externo).
ALTER TABLE ged_comunicacao ADD CONSTRAINT ged_comunicacao_destinatario_chk CHECK (usuario_id IS NOT NULL OR protocolo_id IS NOT NULL);

-- Andamento e anexos do protocolo são imutáveis (só INSERT).
CREATE TRIGGER ged_protocolo_evento_imutavel BEFORE UPDATE OR DELETE ON ged_protocolo_evento
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();
CREATE TRIGGER ged_protocolo_documento_imutavel BEFORE UPDATE OR DELETE ON ged_protocolo_documento
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();

-- O registro do protocolo é imutável: número, data, interessado, assunto, destino original e códigos NÃO mudam, e o protocolo
-- nunca é excluído. Só variam a situação, a posse atual (setor/responsável), a data de conclusão e o comprovante, que é
-- preenchido UMA única vez (depois de emitido, hash/arquivo/data não podem mudar).
CREATE OR REPLACE FUNCTION ged_protocolo_imutavel() RETURNS trigger AS $$
DECLARE
  mutaveis text[] := ARRAY['situacao', 'setor_atual_id', 'responsavel_id', 'concluido_em', 'updated_at',
    'comprovante_documento_id', 'comprovante_versao_id', 'comprovante_sha256', 'comprovante_emitido_em', 'comprovante_assinado'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GED: protocolo não pode ser excluído' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - mutaveis) IS DISTINCT FROM (to_jsonb(OLD) - mutaveis) THEN
    RAISE EXCEPTION 'GED: dados de identificação do protocolo são imutáveis' USING ERRCODE = '23514';
  END IF;
  IF OLD.comprovante_sha256 IS NOT NULL AND (
    NEW.comprovante_sha256 IS DISTINCT FROM OLD.comprovante_sha256
    OR NEW.comprovante_documento_id IS DISTINCT FROM OLD.comprovante_documento_id
    OR NEW.comprovante_versao_id IS DISTINCT FROM OLD.comprovante_versao_id
    OR NEW.comprovante_emitido_em IS DISTINCT FROM OLD.comprovante_emitido_em
    OR NEW.comprovante_assinado IS DISTINCT FROM OLD.comprovante_assinado
  ) THEN
    RAISE EXCEPTION 'GED: comprovante do protocolo já emitido é imutável' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ged_protocolo_imutavel BEFORE UPDATE OR DELETE ON ged_protocolo
  FOR EACH ROW EXECUTE FUNCTION ged_protocolo_imutavel();
