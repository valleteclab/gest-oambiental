-- GED: compartilhamento externo de pasta/documento por link público protegido por OTP no WhatsApp (docs/ged.md §18).
-- Isolamento por cliente: organizacao_id NOT NULL em toda tabela, primeiro campo dos índices e trigger ged_mesmo_tenant.
-- O token do link NUNCA é guardado (só o sha256); o WhatsApp do destinatário fica cifrado; o OTP, em hash com sal.

-- CreateEnum
CREATE TYPE "GedStatusCompartilhamento" AS ENUM ('ATIVO', 'REVOGADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "GedRecursoCompartilhado" AS ENUM ('DOCUMENTO', 'PASTA');

-- AlterTable
ALTER TABLE "ged_config" ADD COLUMN     "compartilhamento_ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "compartilhamento_notificar_acesso" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "compartilhamento_validade_max_dias" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "compartilhamento_validade_padrao_dias" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "ged_compartilhamento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "recurso_tipo" "GedRecursoCompartilhado" NOT NULL,
    "documento_id" UUID,
    "pasta_id" UUID,
    "recurso_rotulo" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "destinatario_nome" TEXT,
    "destinatario_whatsapp_cifrado" TEXT NOT NULL,
    "destinatario_whatsapp_hash" TEXT NOT NULL,
    "destinatario_mascarado" TEXT NOT NULL,
    "mensagem" TEXT,
    "pode_visualizar" BOOLEAN NOT NULL DEFAULT true,
    "pode_baixar" BOOLEAN NOT NULL DEFAULT false,
    "pode_zip" BOOLEAN NOT NULL DEFAULT false,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "limite_downloads" INTEGER,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "status" "GedStatusCompartilhamento" NOT NULL DEFAULT 'ATIVO',
    "revogado_em" TIMESTAMP(3),
    "revogado_por_id" UUID,
    "revogado_motivo" TEXT,
    "congelado" BOOLEAN NOT NULL DEFAULT false,
    "itens_congelados" UUID[],
    "confirmou_restrito" BOOLEAN NOT NULL DEFAULT false,
    "notificar_primeiro_acesso" BOOLEAN NOT NULL DEFAULT true,
    "primeiro_acesso_em" TIMESTAMP(3),
    "ultimo_acesso_em" TIMESTAMP(3),
    "otp_falhas" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMP(3),
    "link_enviado_whatsapp_em" TIMESTAMP(3),

    CONSTRAINT "ged_compartilhamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_compartilhamento_otp" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "compartilhamento_id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "sal" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "usado_em" TIMESTAMP(3),
    "invalidado_em" TIMESTAMP(3),
    "enviado_em" TIMESTAMP(3),
    "erro_envio" TEXT,
    "ip_hash" TEXT,
    "codigo_teste_cifrado" TEXT,

    CONSTRAINT "ged_compartilhamento_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_compartilhamento_sessao" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "compartilhamento_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "ua_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "teto_em" TIMESTAMP(3) NOT NULL,
    "ultimo_uso_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerrada_em" TIMESTAMP(3),

    CONSTRAINT "ged_compartilhamento_sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_compartilhamento_evento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "compartilhamento_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "documento_id" UUID,
    "ip" TEXT,
    "user_agent" TEXT,
    "detalhe" TEXT,

    CONSTRAINT "ged_compartilhamento_evento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ged_compartilhamento_token_hash_key" ON "ged_compartilhamento"("token_hash");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_organizacao_id_status_expira_em_idx" ON "ged_compartilhamento"("organizacao_id", "status", "expira_em");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_organizacao_id_criado_por_id_created_a_idx" ON "ged_compartilhamento"("organizacao_id", "criado_por_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_organizacao_id_documento_id_idx" ON "ged_compartilhamento"("organizacao_id", "documento_id");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_organizacao_id_pasta_id_idx" ON "ged_compartilhamento"("organizacao_id", "pasta_id");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_otp_organizacao_id_compartilhamento_id_idx" ON "ged_compartilhamento_otp"("organizacao_id", "compartilhamento_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ged_compartilhamento_sessao_token_hash_key" ON "ged_compartilhamento_sessao"("token_hash");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_sessao_organizacao_id_compartilhamento_idx" ON "ged_compartilhamento_sessao"("organizacao_id", "compartilhamento_id");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_sessao_organizacao_id_teto_em_idx" ON "ged_compartilhamento_sessao"("organizacao_id", "teto_em");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_evento_organizacao_id_compartilhamento_idx" ON "ged_compartilhamento_evento"("organizacao_id", "compartilhamento_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_compartilhamento_evento_organizacao_id_created_at_idx" ON "ged_compartilhamento_evento"("organizacao_id", "created_at");

-- AddForeignKey
ALTER TABLE "ged_compartilhamento" ADD CONSTRAINT "ged_compartilhamento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_compartilhamento_otp" ADD CONSTRAINT "ged_compartilhamento_otp_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_compartilhamento_otp" ADD CONSTRAINT "ged_compartilhamento_otp_compartilhamento_id_fkey" FOREIGN KEY ("compartilhamento_id") REFERENCES "ged_compartilhamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_compartilhamento_sessao" ADD CONSTRAINT "ged_compartilhamento_sessao_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_compartilhamento_sessao" ADD CONSTRAINT "ged_compartilhamento_sessao_compartilhamento_id_fkey" FOREIGN KEY ("compartilhamento_id") REFERENCES "ged_compartilhamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_compartilhamento_evento" ADD CONSTRAINT "ged_compartilhamento_evento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_compartilhamento_evento" ADD CONSTRAINT "ged_compartilhamento_evento_compartilhamento_id_fkey" FOREIGN KEY ("compartilhamento_id") REFERENCES "ged_compartilhamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- O link aponta para exatamente UM recurso (documento OU pasta). Sem FK: excluir o recurso revoga o link (lib/ged/exclusao).
ALTER TABLE ged_compartilhamento ADD CONSTRAINT ged_compartilhamento_recurso_chk
  CHECK ((recurso_tipo = 'DOCUMENTO' AND documento_id IS NOT NULL AND pasta_id IS NULL)
      OR (recurso_tipo = 'PASTA' AND pasta_id IS NOT NULL AND documento_id IS NULL));
ALTER TABLE ged_compartilhamento ADD CONSTRAINT ged_compartilhamento_validade_chk CHECK (expira_em > created_at);

-- Isolamento entre clientes (defesa em profundidade): toda referência aponta para linha da MESMA organização.
CREATE TRIGGER ged_compartilhamento_tenant BEFORE INSERT OR UPDATE ON ged_compartilhamento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('criado_por_id', 'usuario', 'revogado_por_id', 'usuario');
-- O recurso só é conferido na CRIAÇÃO: depois de excluído (sem FK) o link continua podendo ser revogado/expirado.
CREATE TRIGGER ged_compartilhamento_recurso_tenant BEFORE INSERT ON ged_compartilhamento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('documento_id', 'ged_documento', 'pasta_id', 'ged_pasta');
CREATE TRIGGER ged_compartilhamento_otp_tenant BEFORE INSERT OR UPDATE ON ged_compartilhamento_otp
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('compartilhamento_id', 'ged_compartilhamento');
CREATE TRIGGER ged_compartilhamento_sessao_tenant BEFORE INSERT OR UPDATE ON ged_compartilhamento_sessao
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('compartilhamento_id', 'ged_compartilhamento');
CREATE TRIGGER ged_compartilhamento_evento_tenant BEFORE INSERT ON ged_compartilhamento_evento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('compartilhamento_id', 'ged_compartilhamento', 'documento_id', 'ged_documento');
