-- Agente de denúncias ambientais (WhatsApp Z-API/Evolution/Chatwoot, chat do site e e-mail) – docs/agente-denuncias.md
-- Canais por município/organização, conversas (máquina de estados), mensagens (dedup por canal+id do provedor),
-- caixa bruta de webhooks, consumo de IA; denúncia ganha vínculo com a conversa, hash do contato e fotos (anexo.denuncia_id).

-- CreateEnum
CREATE TYPE "TipoCanal" AS ENUM ('WHATSAPP_ZAPI', 'WHATSAPP_EVOLUTION', 'WHATSAPP_CHATWOOT', 'WEBCHAT', 'EMAIL');

-- CreateEnum
CREATE TYPE "EstadoConversa" AS ENUM ('INICIO', 'AGUARDANDO_LGPD', 'COLETANDO', 'CONFIRMANDO', 'REGISTRADA', 'HUMANO', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "DirecaoMensagem" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AutorMensagem" AS ENUM ('CIDADAO', 'IA', 'ATENDENTE', 'SISTEMA');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CanalDenuncia" ADD VALUE 'WHATSAPP';
ALTER TYPE "CanalDenuncia" ADD VALUE 'CHAT_SITE';
ALTER TYPE "CanalDenuncia" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "anexo" ADD COLUMN     "denuncia_id" UUID;

-- AlterTable
ALTER TABLE "denuncia" ADD COLUMN     "contato_hash" TEXT,
ADD COLUMN     "conversa_id" UUID;

-- CreateTable
CREATE TABLE "canal_atendimento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID,
    "tipo" "TipoCanal" NOT NULL,
    "nome" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "webhook_secret" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "status_conexao" TEXT,
    "ultimo_evento_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "canal_atendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversa" (
    "id" UUID NOT NULL,
    "canal_id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID,
    "chat_hash" TEXT NOT NULL,
    "destino_cifrado" TEXT NOT NULL,
    "contato_hash" TEXT,
    "contato_cifrado" TEXT,
    "nome" TEXT,
    "estado" "EstadoConversa" NOT NULL DEFAULT 'INICIO',
    "dados_coletados" JSONB NOT NULL DEFAULT '{}',
    "denuncia_id" UUID,
    "ia_pausada_ate" TIMESTAMP(3),
    "atendente_id" UUID,
    "lgpd_consentimento_em" TIMESTAMP(3),
    "ultima_msg_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_msg_cidadao_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagem_conversa" (
    "id" UUID NOT NULL,
    "conversa_id" UUID NOT NULL,
    "canal_id" UUID NOT NULL,
    "direcao" "DirecaoMensagem" NOT NULL,
    "autor" "AutorMensagem" NOT NULL,
    "autor_usuario_id" UUID,
    "provider_message_id" TEXT,
    "tipo" TEXT NOT NULL DEFAULT 'TEXTO',
    "texto" TEXT,
    "botoes" JSONB,
    "midia_key" TEXT,
    "midia_mime" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "status_envio" TEXT,
    "erro" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagem_conversa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_webhook" (
    "id" UUID NOT NULL,
    "canal_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "content_type" TEXT,
    "corpo" TEXT NOT NULL,
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processado_em" TIMESTAMP(3),

    CONSTRAINT "evento_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uso_ia" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "conversa_id" UUID,
    "modelo" TEXT NOT NULL,
    "finalidade" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "custo_estimado" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uso_ia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "canal_atendimento_organizacao_id_idx" ON "canal_atendimento"("organizacao_id");

-- CreateIndex
CREATE INDEX "conversa_canal_id_chat_hash_idx" ON "conversa"("canal_id", "chat_hash");

-- CreateIndex
CREATE INDEX "conversa_organizacao_id_estado_ultima_msg_em_idx" ON "conversa"("organizacao_id", "estado", "ultima_msg_em");

-- CreateIndex
CREATE INDEX "conversa_contato_hash_idx" ON "conversa"("contato_hash");

-- CreateIndex
CREATE INDEX "mensagem_conversa_conversa_id_created_at_idx" ON "mensagem_conversa"("conversa_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mensagem_conversa_canal_id_provider_message_id_key" ON "mensagem_conversa"("canal_id", "provider_message_id");

-- CreateIndex
CREATE INDEX "evento_webhook_status_recebido_em_idx" ON "evento_webhook"("status", "recebido_em");

-- CreateIndex
CREATE INDEX "evento_webhook_recebido_em_idx" ON "evento_webhook"("recebido_em");

-- CreateIndex
CREATE INDEX "uso_ia_organizacao_id_created_at_idx" ON "uso_ia"("organizacao_id", "created_at");

-- CreateIndex
CREATE INDEX "anexo_denuncia_id_idx" ON "anexo"("denuncia_id");

-- CreateIndex
CREATE UNIQUE INDEX "denuncia_conversa_id_key" ON "denuncia"("conversa_id");

-- CreateIndex
CREATE INDEX "denuncia_contato_hash_idx" ON "denuncia"("contato_hash");

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_denuncia_id_fkey" FOREIGN KEY ("denuncia_id") REFERENCES "denuncia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncia" ADD CONSTRAINT "denuncia_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canal_atendimento" ADD CONSTRAINT "canal_atendimento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canal_atendimento" ADD CONSTRAINT "canal_atendimento_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa" ADD CONSTRAINT "conversa_canal_id_fkey" FOREIGN KEY ("canal_id") REFERENCES "canal_atendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa" ADD CONSTRAINT "conversa_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_conversa" ADD CONSTRAINT "mensagem_conversa_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagem_conversa" ADD CONSTRAINT "mensagem_conversa_canal_id_fkey" FOREIGN KEY ("canal_id") REFERENCES "canal_atendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_webhook" ADD CONSTRAINT "evento_webhook_canal_id_fkey" FOREIGN KEY ("canal_id") REFERENCES "canal_atendimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- No máximo UMA conversa aberta por chat do provedor (serializa a criação concorrente)
CREATE UNIQUE INDEX "conversa_aberta_por_chat_key" ON "conversa"("canal_id", "chat_hash") WHERE "estado" <> 'ENCERRADA';
