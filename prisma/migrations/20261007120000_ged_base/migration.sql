-- Módulo GED (Gestão de Documentos) – docs/ged-design.md
-- Parte 1: tabelas geradas pelo Prisma. Parte 2 (abaixo): extensões, busca, triggers de tenant/imutabilidade e índices que o Prisma não expressa.

-- CreateEnum
CREATE TYPE "ModuloPlataforma" AS ENUM ('LICENCIAMENTO', 'GED');

-- CreateEnum
CREATE TYPE "GedPapel" AS ENUM ('GED_ADMIN', 'GED_GESTOR', 'GED_USUARIO', 'GED_LEITOR', 'GED_AUDITOR');

-- CreateEnum
CREATE TYPE "GedStatusDocumento" AS ENUM ('RASCUNHO', 'PUBLICADO', 'EM_ASSINATURA', 'ASSINADO', 'RECUSADO', 'ARQUIVADO');

-- CreateEnum
CREATE TYPE "GedSensibilidade" AS ENUM ('PUBLICO', 'RESTRITO', 'SIGILOSO');

-- CreateEnum
CREATE TYPE "GedAnonimizacao" AS ENUM ('NAO_NECESSARIA', 'PENDENTE', 'ANONIMIZADA');

-- CreateEnum
CREATE TYPE "GedOrigemVersao" AS ENUM ('UPLOAD', 'EDITOR', 'SCAN', 'OCR', 'ANONIMIZACAO', 'SELO');

-- CreateEnum
CREATE TYPE "GedStatusTexto" AS ENUM ('PENDENTE', 'EXTRAIDO', 'SEM_TEXTO', 'OCR_PENDENTE', 'ERRO');

-- CreateEnum
CREATE TYPE "GedAcao" AS ENUM ('VER', 'EDITAR', 'ASSINAR', 'TRAMITAR', 'ADMINISTRAR', 'ANONIMIZAR');

-- CreateEnum
CREATE TYPE "GedPrincipalTipo" AS ENUM ('USUARIO', 'SETOR');

-- CreateEnum
CREATE TYPE "GedTipoTramite" AS ENUM ('ENVIO', 'DESPACHO', 'CIENCIA', 'DEVOLUCAO', 'RECUSA', 'ARQUIVAMENTO');

-- CreateEnum
CREATE TYPE "GedModoAssinatura" AS ENUM ('SEQUENCIAL', 'PARALELO');

-- CreateEnum
CREATE TYPE "GedStatusSolicitacao" AS ENUM ('ABERTA', 'CONCLUIDA', 'RECUSADA', 'CANCELADA', 'EXPIRADA');

-- CreateEnum
CREATE TYPE "GedStatusAssinante" AS ENUM ('AGUARDANDO', 'PENDENTE', 'ASSINADO', 'RECUSADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "GedMetodoAssinatura" AS ENUM ('ELETRONICA_AVANCADA', 'ICP_BRASIL_A1');

-- CreateEnum
CREATE TYPE "GedCanalCom" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "GedStatusCom" AS ENUM ('PENDENTE', 'ENVIADA', 'SIMULADA', 'ERRO', 'IGNORADA');

-- AlterTable
ALTER TABLE "log_auditoria" ADD COLUMN     "organizacao_id" UUID;

-- AlterTable
ALTER TABLE "organizacao" ADD COLUMN     "modulos" "ModuloPlataforma"[] DEFAULT ARRAY['LICENCIAMENTO']::"ModuloPlataforma"[];

-- CreateTable
CREATE TABLE "ged_config" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cota_bytes" BIGINT,
    "ia_habilitada" BOOLEAN NOT NULL DEFAULT false,
    "canal_whatsapp_id" UUID,
    "assinatura_prazo_dias" INTEGER NOT NULL DEFAULT 15,
    "lembrete_dias" INTEGER[] DEFAULT ARRAY[3, 1, 0]::INTEGER[],
    "retencao_acesso_log_dias" INTEGER NOT NULL DEFAULT 730,

    CONSTRAINT "ged_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_membro" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "papel" "GedPapel" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "telefone_cifrado" TEXT,
    "whatsapp_optin_em" TIMESTAMP(3),

    CONSTRAINT "ged_membro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_setor" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "nome" TEXT NOT NULL,
    "sigla" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ged_setor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_setor_membro" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "setor_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "chefe" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ged_setor_membro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_tipo_documento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "ged_tipo_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_pasta" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "parent_id" UUID,
    "nome" TEXT NOT NULL,
    "caminho_ids" UUID[],
    "caminho_heranca" UUID[],
    "caminho_nome" TEXT NOT NULL,
    "herda_acl" BOOLEAN NOT NULL DEFAULT true,
    "sensibilidade_padrao" "GedSensibilidade" NOT NULL DEFAULT 'RESTRITO',
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "ged_pasta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_documento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "pasta_id" UUID,
    "numero" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "tipo_id" UUID,
    "remetente" TEXT,
    "data_documento" DATE,
    "status" "GedStatusDocumento" NOT NULL DEFAULT 'RASCUNHO',
    "criado_por_id" UUID NOT NULL,
    "versao_atual_id" UUID,
    "setor_atual_id" UUID,
    "responsavel_id" UUID,
    "acl_propria" BOOLEAN NOT NULL DEFAULT false,
    "codigo_verificador" TEXT,
    "sha256_final" TEXT,
    "sensibilidade" "GedSensibilidade" NOT NULL DEFAULT 'RESTRITO',
    "contem_dados_pessoais" BOOLEAN NOT NULL DEFAULT false,
    "anonimizacao_status" "GedAnonimizacao" NOT NULL DEFAULT 'NAO_NECESSARIA',
    "anonimizado_por_id" UUID,
    "anonimizado_em" TIMESTAMP(3),
    "documento_original_id" UUID,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "ged_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_versao_documento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "documento_id" UUID NOT NULL,
    "n" INTEGER NOT NULL,
    "origem" "GedOrigemVersao" NOT NULL,
    "derivada_de_id" UUID,
    "storage_key" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "paginas" INTEGER,
    "conteudo_html" TEXT,
    "texto_status" "GedStatusTexto" NOT NULL DEFAULT 'PENDENTE',
    "selada" BOOLEAN NOT NULL DEFAULT false,
    "criado_por_id" UUID NOT NULL,

    CONSTRAINT "ged_versao_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_conteudo_texto" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "versao_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "tsv" tsvector,

    CONSTRAINT "ged_conteudo_texto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_deteccao_dado_pessoal" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "versao_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "pagina" INTEGER,
    "ocorrencias" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUGERIDA',

    CONSTRAINT "ged_deteccao_dado_pessoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_marcador" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "nome" TEXT NOT NULL,
    "cor" TEXT NOT NULL DEFAULT '#0f766e',

    CONSTRAINT "ged_marcador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_documento_marcador" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "documento_id" UUID NOT NULL,
    "marcador_id" UUID NOT NULL,

    CONSTRAINT "ged_documento_marcador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_acl" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "pasta_id" UUID,
    "documento_id" UUID,
    "principal_tipo" "GedPrincipalTipo" NOT NULL,
    "usuario_id" UUID,
    "setor_id" UUID,
    "acoes" "GedAcao"[],
    "expira_em" TIMESTAMP(3),
    "concedido_por_id" UUID NOT NULL,

    CONSTRAINT "ged_acl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_tramite" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "documento_id" UUID NOT NULL,
    "tipo" "GedTipoTramite" NOT NULL,
    "de_usuario_id" UUID,
    "de_setor_id" UUID,
    "para_usuario_id" UUID,
    "para_setor_id" UUID,
    "despacho" TEXT,
    "prazo_em" TIMESTAMP(3),
    "referencia_id" UUID,

    CONSTRAINT "ged_tramite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_solicitacao_assinatura" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "documento_id" UUID NOT NULL,
    "versao_id" UUID NOT NULL,
    "sha256_alvo" TEXT NOT NULL,
    "modo" "GedModoAssinatura" NOT NULL,
    "status" "GedStatusSolicitacao" NOT NULL DEFAULT 'ABERTA',
    "prazo_em" TIMESTAMP(3) NOT NULL,
    "mensagem" TEXT,
    "criada_por_id" UUID NOT NULL,
    "concluida_em" TIMESTAMP(3),
    "versao_selo_id" UUID,

    CONSTRAINT "ged_solicitacao_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_assinante" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "rotulo" TEXT NOT NULL DEFAULT 'Assinar',
    "status" "GedStatusAssinante" NOT NULL DEFAULT 'PENDENTE',
    "visualizou_em" TIMESTAMP(3),
    "ultimo_lembrete_em" TIMESTAMP(3),
    "assinado_em" TIMESTAMP(3),
    "recusado_em" TIMESTAMP(3),
    "comentario" TEXT,
    "justificativa_recusa" TEXT,
    "metodo" "GedMetodoAssinatura",
    "reautenticacao" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "hash_documento" TEXT,
    "hash_cadeia" TEXT,
    "otp_hash" TEXT,
    "otp_expira_em" TIMESTAMP(3),
    "otp_tentativas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ged_assinante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_comentario" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "documento_id" UUID NOT NULL,
    "versao_id" UUID,
    "solicitacao_id" UUID,
    "autor_id" UUID NOT NULL,
    "contexto" TEXT NOT NULL,
    "texto" TEXT NOT NULL,

    CONSTRAINT "ged_comentario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_acesso_log" (
    "id" BIGSERIAL NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "usuario_id" UUID,
    "documento_id" UUID,
    "versao_id" UUID,
    "acao" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "ged_acesso_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_comunicacao" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "documento_id" UUID,
    "assinante_id" UUID,
    "usuario_id" UUID NOT NULL,
    "evento" TEXT NOT NULL,
    "canal" "GedCanalCom" NOT NULL,
    "destinatario_mascarado" TEXT NOT NULL,
    "assunto" TEXT,
    "status" "GedStatusCom" NOT NULL DEFAULT 'PENDENTE',
    "erro" TEXT,
    "provider_message_id" TEXT,
    "email_enviado_id" UUID,
    "enviado_em" TIMESTAMP(3),

    CONSTRAINT "ged_comunicacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_preferencia_notificacao" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "evento" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ged_preferencia_notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ged_sequencia" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ged_sequencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ged_config_organizacao_id_key" ON "ged_config"("organizacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_membro_organizacao_id_usuario_id_key" ON "ged_membro"("organizacao_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_setor_organizacao_id_sigla_key" ON "ged_setor"("organizacao_id", "sigla");

-- CreateIndex
CREATE INDEX "ged_setor_membro_organizacao_id_usuario_id_idx" ON "ged_setor_membro"("organizacao_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_setor_membro_setor_id_usuario_id_key" ON "ged_setor_membro"("setor_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_tipo_documento_organizacao_id_nome_key" ON "ged_tipo_documento"("organizacao_id", "nome");

-- CreateIndex
CREATE INDEX "ged_pasta_organizacao_id_parent_id_idx" ON "ged_pasta"("organizacao_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_documento_codigo_verificador_key" ON "ged_documento"("codigo_verificador");

-- CreateIndex
CREATE INDEX "ged_documento_organizacao_id_pasta_id_idx" ON "ged_documento"("organizacao_id", "pasta_id");

-- CreateIndex
CREATE INDEX "ged_documento_organizacao_id_status_idx" ON "ged_documento"("organizacao_id", "status");

-- CreateIndex
CREATE INDEX "ged_documento_organizacao_id_data_documento_idx" ON "ged_documento"("organizacao_id", "data_documento");

-- CreateIndex
CREATE INDEX "ged_documento_organizacao_id_responsavel_id_status_idx" ON "ged_documento"("organizacao_id", "responsavel_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ged_documento_organizacao_id_numero_key" ON "ged_documento"("organizacao_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ged_documento_organizacao_id_documento_original_id_key" ON "ged_documento"("organizacao_id", "documento_original_id");

-- CreateIndex
CREATE INDEX "ged_versao_documento_organizacao_id_documento_id_idx" ON "ged_versao_documento"("organizacao_id", "documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_versao_documento_documento_id_n_key" ON "ged_versao_documento"("documento_id", "n");

-- CreateIndex
CREATE UNIQUE INDEX "ged_conteudo_texto_versao_id_key" ON "ged_conteudo_texto"("versao_id");

-- CreateIndex
CREATE INDEX "ged_conteudo_texto_organizacao_id_documento_id_idx" ON "ged_conteudo_texto"("organizacao_id", "documento_id");

-- CreateIndex
CREATE INDEX "ged_deteccao_dado_pessoal_organizacao_id_versao_id_idx" ON "ged_deteccao_dado_pessoal"("organizacao_id", "versao_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_marcador_organizacao_id_nome_key" ON "ged_marcador"("organizacao_id", "nome");

-- CreateIndex
CREATE INDEX "ged_documento_marcador_organizacao_id_marcador_id_idx" ON "ged_documento_marcador"("organizacao_id", "marcador_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_documento_marcador_documento_id_marcador_id_key" ON "ged_documento_marcador"("documento_id", "marcador_id");

-- CreateIndex
CREATE INDEX "ged_acl_organizacao_id_pasta_id_idx" ON "ged_acl"("organizacao_id", "pasta_id");

-- CreateIndex
CREATE INDEX "ged_acl_organizacao_id_documento_id_idx" ON "ged_acl"("organizacao_id", "documento_id");

-- CreateIndex
CREATE INDEX "ged_acl_organizacao_id_usuario_id_idx" ON "ged_acl"("organizacao_id", "usuario_id");

-- CreateIndex
CREATE INDEX "ged_acl_organizacao_id_setor_id_idx" ON "ged_acl"("organizacao_id", "setor_id");

-- CreateIndex
CREATE INDEX "ged_tramite_organizacao_id_documento_id_created_at_idx" ON "ged_tramite"("organizacao_id", "documento_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_tramite_organizacao_id_para_usuario_id_created_at_idx" ON "ged_tramite"("organizacao_id", "para_usuario_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_solicitacao_assinatura_organizacao_id_status_prazo_em_idx" ON "ged_solicitacao_assinatura"("organizacao_id", "status", "prazo_em");

-- CreateIndex
CREATE INDEX "ged_solicitacao_assinatura_organizacao_id_documento_id_idx" ON "ged_solicitacao_assinatura"("organizacao_id", "documento_id");

-- CreateIndex
CREATE INDEX "ged_assinante_organizacao_id_usuario_id_status_idx" ON "ged_assinante"("organizacao_id", "usuario_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ged_assinante_solicitacao_id_usuario_id_key" ON "ged_assinante"("solicitacao_id", "usuario_id");

-- CreateIndex
CREATE INDEX "ged_comentario_organizacao_id_documento_id_created_at_idx" ON "ged_comentario"("organizacao_id", "documento_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_acesso_log_organizacao_id_created_at_idx" ON "ged_acesso_log"("organizacao_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_acesso_log_organizacao_id_documento_id_created_at_idx" ON "ged_acesso_log"("organizacao_id", "documento_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_comunicacao_organizacao_id_created_at_idx" ON "ged_comunicacao"("organizacao_id", "created_at");

-- CreateIndex
CREATE INDEX "ged_comunicacao_organizacao_id_documento_id_idx" ON "ged_comunicacao"("organizacao_id", "documento_id");

-- CreateIndex
CREATE UNIQUE INDEX "ged_preferencia_notificacao_usuario_id_evento_key" ON "ged_preferencia_notificacao"("usuario_id", "evento");

-- CreateIndex
CREATE UNIQUE INDEX "ged_sequencia_organizacao_id_tipo_ano_key" ON "ged_sequencia"("organizacao_id", "tipo", "ano");

-- CreateIndex
CREATE INDEX "log_auditoria_organizacao_id_created_at_idx" ON "log_auditoria"("organizacao_id", "created_at");

-- AddForeignKey
ALTER TABLE "ged_config" ADD CONSTRAINT "ged_config_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_membro" ADD CONSTRAINT "ged_membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_membro" ADD CONSTRAINT "ged_membro_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_setor" ADD CONSTRAINT "ged_setor_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_setor_membro" ADD CONSTRAINT "ged_setor_membro_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "ged_setor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_setor_membro" ADD CONSTRAINT "ged_setor_membro_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_setor_membro" ADD CONSTRAINT "ged_setor_membro_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_tipo_documento" ADD CONSTRAINT "ged_tipo_documento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_pasta" ADD CONSTRAINT "ged_pasta_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ged_pasta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_pasta" ADD CONSTRAINT "ged_pasta_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento" ADD CONSTRAINT "ged_documento_pasta_id_fkey" FOREIGN KEY ("pasta_id") REFERENCES "ged_pasta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento" ADD CONSTRAINT "ged_documento_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "ged_tipo_documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento" ADD CONSTRAINT "ged_documento_documento_original_id_fkey" FOREIGN KEY ("documento_original_id") REFERENCES "ged_documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento" ADD CONSTRAINT "ged_documento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_versao_documento" ADD CONSTRAINT "ged_versao_documento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "ged_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_versao_documento" ADD CONSTRAINT "ged_versao_documento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_conteudo_texto" ADD CONSTRAINT "ged_conteudo_texto_versao_id_fkey" FOREIGN KEY ("versao_id") REFERENCES "ged_versao_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_conteudo_texto" ADD CONSTRAINT "ged_conteudo_texto_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_deteccao_dado_pessoal" ADD CONSTRAINT "ged_deteccao_dado_pessoal_versao_id_fkey" FOREIGN KEY ("versao_id") REFERENCES "ged_versao_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_deteccao_dado_pessoal" ADD CONSTRAINT "ged_deteccao_dado_pessoal_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_marcador" ADD CONSTRAINT "ged_marcador_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento_marcador" ADD CONSTRAINT "ged_documento_marcador_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "ged_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento_marcador" ADD CONSTRAINT "ged_documento_marcador_marcador_id_fkey" FOREIGN KEY ("marcador_id") REFERENCES "ged_marcador"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_documento_marcador" ADD CONSTRAINT "ged_documento_marcador_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_acl" ADD CONSTRAINT "ged_acl_pasta_id_fkey" FOREIGN KEY ("pasta_id") REFERENCES "ged_pasta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_acl" ADD CONSTRAINT "ged_acl_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "ged_documento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_acl" ADD CONSTRAINT "ged_acl_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_tramite" ADD CONSTRAINT "ged_tramite_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "ged_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_tramite" ADD CONSTRAINT "ged_tramite_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_solicitacao_assinatura" ADD CONSTRAINT "ged_solicitacao_assinatura_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "ged_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_solicitacao_assinatura" ADD CONSTRAINT "ged_solicitacao_assinatura_versao_id_fkey" FOREIGN KEY ("versao_id") REFERENCES "ged_versao_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_solicitacao_assinatura" ADD CONSTRAINT "ged_solicitacao_assinatura_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_assinante" ADD CONSTRAINT "ged_assinante_solicitacao_id_fkey" FOREIGN KEY ("solicitacao_id") REFERENCES "ged_solicitacao_assinatura"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_assinante" ADD CONSTRAINT "ged_assinante_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_comentario" ADD CONSTRAINT "ged_comentario_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "ged_documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_comentario" ADD CONSTRAINT "ged_comentario_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_acesso_log" ADD CONSTRAINT "ged_acesso_log_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_comunicacao" ADD CONSTRAINT "ged_comunicacao_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_preferencia_notificacao" ADD CONSTRAINT "ged_preferencia_notificacao_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ged_sequencia" ADD CONSTRAINT "ged_sequencia_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════ Parte 2 – SQL manual ═════════════════════

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent IMMUTABLE (necessário em colunas geradas e índices de expressão)
CREATE OR REPLACE FUNCTION ged_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $f$ SELECT public.unaccent('public.unaccent', $1) $f$;

-- Busca por conteúdo: coluna tsvector GERADA (o Prisma só a conhece como Unsupported)
ALTER TABLE ged_conteudo_texto DROP COLUMN tsv;
ALTER TABLE ged_conteudo_texto ADD COLUMN tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', ged_unaccent(texto))) STORED;
CREATE INDEX ged_conteudo_texto_tsv_idx ON ged_conteudo_texto USING GIN (tsv);

-- Índices de árvore de pastas, unicidade de nomes e busca aproximada
CREATE INDEX ged_pasta_caminho_ids_gin ON ged_pasta USING GIN (caminho_ids);
CREATE INDEX ged_pasta_caminho_heranca_gin ON ged_pasta USING GIN (caminho_heranca);
CREATE UNIQUE INDEX ged_pasta_nome_filha_uq ON ged_pasta (organizacao_id, parent_id, lower(nome))
  WHERE parent_id IS NOT NULL AND excluido_em IS NULL;
CREATE UNIQUE INDEX ged_pasta_nome_raiz_uq ON ged_pasta (organizacao_id, lower(nome))
  WHERE parent_id IS NULL AND excluido_em IS NULL;
CREATE INDEX ged_documento_titulo_trgm ON ged_documento USING GIN (ged_unaccent(lower(titulo)) gin_trgm_ops);
CREATE INDEX ged_documento_remetente_trgm ON ged_documento USING GIN (ged_unaccent(lower(remetente)) gin_trgm_ops);
CREATE UNIQUE INDEX ged_marcador_nome_ci_uq ON ged_marcador (organizacao_id, lower(nome));
CREATE INDEX ged_acesso_log_created_brin ON ged_acesso_log USING BRIN (created_at);

-- Regras de integridade
ALTER TABLE ged_acl ADD CONSTRAINT ged_acl_recurso_principal_chk CHECK (
  ((pasta_id IS NOT NULL)::int + (documento_id IS NOT NULL)::int = 1)
  AND (
    (principal_tipo = 'USUARIO' AND usuario_id IS NOT NULL AND setor_id IS NULL)
    OR (principal_tipo = 'SETOR' AND setor_id IS NOT NULL AND usuario_id IS NULL)
  )
);
-- Documento com anonimização pendente nunca pode ser público
ALTER TABLE ged_documento ADD CONSTRAINT ged_documento_anonimizacao_chk
  CHECK (anonimizacao_status <> 'PENDENTE' OR sensibilidade <> 'PUBLICO');

-- ── Isolamento entre clientes (defesa em profundidade) ──
-- Toda referência (FK lógica) de uma linha GED deve apontar para linha da MESMA organização.
-- Argumentos: pares (coluna, tabela_pai). A tabela `usuario` entra aqui também (requerente tem organizacao_id NULL → rejeitado).
CREATE OR REPLACE FUNCTION ged_mesmo_tenant() RETURNS trigger AS $$
DECLARE
  i int := 0;
  col text;
  tab text;
  val text;
  org_pai uuid;
  org_linha uuid := (to_jsonb(NEW) ->> 'organizacao_id')::uuid;
BEGIN
  WHILE i < TG_NARGS LOOP
    col := TG_ARGV[i];
    tab := TG_ARGV[i + 1];
    val := to_jsonb(NEW) ->> col;
    IF val IS NOT NULL THEN
      EXECUTE format('SELECT organizacao_id FROM %I WHERE id = $1', tab) INTO org_pai USING val::uuid;
      IF org_pai IS NULL OR org_pai IS DISTINCT FROM org_linha THEN
        RAISE EXCEPTION 'GED: referência %.% aponta para fora da organização', TG_TABLE_NAME, col USING ERRCODE = '23514';
      END IF;
    END IF;
    i := i + 2;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ged_config_tenant BEFORE INSERT OR UPDATE ON ged_config
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('canal_whatsapp_id', 'canal_atendimento');
CREATE TRIGGER ged_membro_tenant BEFORE INSERT OR UPDATE ON ged_membro
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('usuario_id', 'usuario');
CREATE TRIGGER ged_setor_membro_tenant BEFORE INSERT OR UPDATE ON ged_setor_membro
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('setor_id', 'ged_setor', 'usuario_id', 'usuario');
CREATE TRIGGER ged_pasta_tenant BEFORE INSERT OR UPDATE ON ged_pasta
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('parent_id', 'ged_pasta');
CREATE TRIGGER ged_documento_tenant BEFORE INSERT OR UPDATE ON ged_documento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'pasta_id', 'ged_pasta', 'tipo_id', 'ged_tipo_documento', 'documento_original_id', 'ged_documento',
    'versao_atual_id', 'ged_versao_documento', 'criado_por_id', 'usuario', 'responsavel_id', 'usuario',
    'setor_atual_id', 'ged_setor', 'anonimizado_por_id', 'usuario');
CREATE TRIGGER ged_versao_documento_tenant BEFORE INSERT OR UPDATE ON ged_versao_documento
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'documento_id', 'ged_documento', 'derivada_de_id', 'ged_versao_documento', 'criado_por_id', 'usuario');
CREATE TRIGGER ged_conteudo_texto_tenant BEFORE INSERT OR UPDATE ON ged_conteudo_texto
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('versao_id', 'ged_versao_documento', 'documento_id', 'ged_documento');
CREATE TRIGGER ged_deteccao_dado_pessoal_tenant BEFORE INSERT OR UPDATE ON ged_deteccao_dado_pessoal
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('versao_id', 'ged_versao_documento');
CREATE TRIGGER ged_documento_marcador_tenant BEFORE INSERT OR UPDATE ON ged_documento_marcador
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('documento_id', 'ged_documento', 'marcador_id', 'ged_marcador');
CREATE TRIGGER ged_acl_tenant BEFORE INSERT OR UPDATE ON ged_acl
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'pasta_id', 'ged_pasta', 'documento_id', 'ged_documento', 'usuario_id', 'usuario',
    'setor_id', 'ged_setor', 'concedido_por_id', 'usuario');
CREATE TRIGGER ged_tramite_tenant BEFORE INSERT OR UPDATE ON ged_tramite
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'documento_id', 'ged_documento', 'de_usuario_id', 'usuario', 'de_setor_id', 'ged_setor',
    'para_usuario_id', 'usuario', 'para_setor_id', 'ged_setor', 'referencia_id', 'ged_tramite');
CREATE TRIGGER ged_solicitacao_assinatura_tenant BEFORE INSERT OR UPDATE ON ged_solicitacao_assinatura
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'documento_id', 'ged_documento', 'versao_id', 'ged_versao_documento', 'criada_por_id', 'usuario',
    'versao_selo_id', 'ged_versao_documento');
CREATE TRIGGER ged_assinante_tenant BEFORE INSERT OR UPDATE ON ged_assinante
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('solicitacao_id', 'ged_solicitacao_assinatura', 'usuario_id', 'usuario');
CREATE TRIGGER ged_comentario_tenant BEFORE INSERT OR UPDATE ON ged_comentario
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'documento_id', 'ged_documento', 'versao_id', 'ged_versao_documento',
    'solicitacao_id', 'ged_solicitacao_assinatura', 'autor_id', 'usuario');
CREATE TRIGGER ged_comunicacao_tenant BEFORE INSERT OR UPDATE ON ged_comunicacao
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant(
    'documento_id', 'ged_documento', 'usuario_id', 'usuario', 'assinante_id', 'ged_assinante');
CREATE TRIGGER ged_preferencia_notificacao_tenant BEFORE INSERT OR UPDATE ON ged_preferencia_notificacao
  FOR EACH ROW EXECUTE FUNCTION ged_mesmo_tenant('usuario_id', 'usuario');
-- ged_acesso_log: sem trigger (registra também tentativas negadas; o app grava sempre via gedDb com a organização da sessão)

-- ── Imutabilidade ──
CREATE TRIGGER ged_tramite_imutavel BEFORE UPDATE OR DELETE ON ged_tramite
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();
CREATE TRIGGER ged_comentario_imutavel BEFORE UPDATE OR DELETE ON ged_comentario
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();

-- Versões nunca são excluídas; versão selada só admite atualizar o status de indexação do texto.
CREATE OR REPLACE FUNCTION ged_versao_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GED: versões de documento não podem ser excluídas' USING ERRCODE = '23514';
  END IF;
  IF OLD.selada AND (
    (to_jsonb(NEW) - 'texto_status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'texto_status' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'GED: versão selada é imutável' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ged_versao_imutavel BEFORE UPDATE OR DELETE ON ged_versao_documento
  FOR EACH ROW EXECUTE FUNCTION ged_versao_imutavel();

-- Assinatura/recusa registrada não pode ser alterada nem excluída.
CREATE OR REPLACE FUNCTION ged_assinante_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'GED: registros de assinatura não podem ser excluídos' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('ASSINADO', 'RECUSADO') THEN
    RAISE EXCEPTION 'GED: assinatura ou recusa já registrada é imutável' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ged_assinante_imutavel BEFORE UPDATE OR DELETE ON ged_assinante
  FOR EACH ROW EXECUTE FUNCTION ged_assinante_imutavel();
