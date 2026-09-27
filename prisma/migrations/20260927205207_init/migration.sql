-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('ADMIN', 'TEC_CONSORCIO', 'TEC_MUNICIPAL', 'GESTOR_MUNICIPAL', 'FISCAL', 'SEMA_INEMA', 'REQUERENTE');

-- CreateEnum
CREATE TYPE "TipoPessoa" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "PotencialPoluidor" AS ENUM ('BAIXO', 'MEDIO', 'ALTO');

-- CreateEnum
CREATE TYPE "Porte" AS ENUM ('MICRO', 'PEQUENO', 'MEDIO', 'GRANDE', 'EXCEPCIONAL');

-- CreateEnum
CREATE TYPE "CategoriaAto" AS ENUM ('LICENCA', 'AUTORIZACAO', 'CERTIDAO', 'DECLARACAO');

-- CreateEnum
CREATE TYPE "StatusEmpreendimento" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "StatusProcesso" AS ENUM ('RASCUNHO', 'PROTOCOLADO', 'EM_TRIAGEM', 'AGUARDANDO_REQUERENTE', 'EM_ANALISE', 'AGUARDANDO_VISTORIA', 'AGUARDANDO_DECISAO', 'DEFERIDO', 'INDEFERIDO', 'CONCLUIDO', 'ARQUIVADO');

-- CreateEnum
CREATE TYPE "StatusPendencia" AS ENUM ('ABERTA', 'RESPONDIDA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ConclusaoParecer" AS ENUM ('FAVORAVEL', 'DESFAVORAVEL', 'FAVORAVEL_COM_CONDICIONANTES');

-- CreateEnum
CREATE TYPE "StatusCondicionante" AS ENUM ('PENDENTE', 'CUMPRIDA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('LICENCA', 'AUTORIZACAO', 'CERTIDAO', 'AUTO_INFRACAO', 'NOTIFICACAO', 'PARECER', 'OFICIO', 'RECIBO');

-- CreateEnum
CREATE TYPE "StatusDocumento" AS ENUM ('VALIDO', 'CANCELADO', 'SUBSTITUIDO');

-- CreateEnum
CREATE TYPE "CanalDenuncia" AS ENUM ('PORTAL', 'PRESENCIAL', 'TELEFONE', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusDenuncia" AS ENUM ('NOVA', 'EM_APURACAO', 'CONCLUIDA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "OrigemFiscalizacao" AS ENUM ('DENUNCIA', 'ROTINA', 'PROCESSO');

-- CreateEnum
CREATE TYPE "Constatacao" AS ENUM ('IRREGULAR', 'REGULAR', 'INCONCLUSIVA');

-- CreateEnum
CREATE TYPE "StatusFiscalizacao" AS ENUM ('AGENDADA', 'REALIZADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "Penalidade" AS ENUM ('ADVERTENCIA', 'MULTA', 'EMBARGO', 'INTERDICAO', 'OUTRA');

-- CreateEnum
CREATE TYPE "StatusAuto" AS ENUM ('LAVRADO', 'EM_DEFESA', 'JULGADO', 'PAGO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusNotificacao" AS ENUM ('EMITIDA', 'ATENDIDA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoReuniao" AS ENUM ('ORDINARIA', 'EXTRAORDINARIA');

-- CreateEnum
CREATE TYPE "StatusExportacao" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDA', 'ERRO');

-- CreateEnum
CREATE TYPE "Severidade" AS ENUM ('CRITICO', 'NAO_CRITICO', 'DUVIDA');

-- CreateTable
CREATE TABLE "organizacao" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "sigla" TEXT NOT NULL,
    "logo_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipio" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "sigla" TEXT NOT NULL,
    "codigo_ibge" TEXT NOT NULL,
    "orgao_ambiental_nome" TEXT NOT NULL,
    "brasao_url" TEXT,
    "endereco" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "distribuicao_auto" BOOLEAN NOT NULL DEFAULT false,
    "delega_decisao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "municipio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf_cifrado" TEXT,
    "cpf_hash" TEXT,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "trocar_senha" BOOLEAN NOT NULL DEFAULT true,
    "cargo" TEXT,
    "falhas_login" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_ate" TIMESTAMP(3),
    "ultimo_login" TIMESTAMP(3),
    "pessoa_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario_papel" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "papel" "Papel" NOT NULL,
    "municipio_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "usuario_papel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipologia" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "divisao" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade_porte" TEXT NOT NULL,
    "faixas_porte" JSONB NOT NULL,
    "potencial_poluidor" "PotencialPoluidor" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "tipologia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_ato" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "sigla" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "categoria" "CategoriaAto" NOT NULL,
    "validade_meses_padrao" INTEGER,
    "exige_vistoria" BOOLEAN NOT NULL DEFAULT false,
    "exige_parecer" BOOLEAN NOT NULL DEFAULT true,
    "modelo_documento" TEXT,
    "checklist_modelo_id" UUID,
    "prazo_analise_dias" INTEGER NOT NULL DEFAULT 60,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "tipo_ato_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_exigido" (
    "id" UUID NOT NULL,
    "tipo_ato_id" UUID NOT NULL,
    "tipologia_id" UUID,
    "nome" TEXT NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
    "formatos" TEXT NOT NULL DEFAULT 'pdf',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "documento_exigido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_modelo" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "itens" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "checklist_modelo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prazo_config" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID,
    "etapa" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "dias_alerta" INTEGER NOT NULL DEFAULT 5,
    "conta_dias_uteis" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "prazo_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feriado" (
    "id" UUID NOT NULL,
    "municipio_id" UUID,
    "data" DATE NOT NULL,
    "descricao" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "feriado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelo_documento" (
    "id" UUID NOT NULL,
    "tipo" "TipoDocumento" NOT NULL,
    "nome" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "modelo_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequencia" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "ultimo" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pessoa" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID,
    "tipo" "TipoPessoa" NOT NULL,
    "cpf_cnpj_cifrado" TEXT NOT NULL,
    "cpf_cnpj_hash" TEXT NOT NULL,
    "cpf_cnpj_mascara" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nome_fantasia" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" JSONB,
    "municipio_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "pessoa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responsavel_tecnico" (
    "id" UUID NOT NULL,
    "pessoa_id" UUID NOT NULL,
    "formacao" TEXT NOT NULL,
    "conselho" TEXT NOT NULL,
    "registro_conselho" TEXT NOT NULL,
    "uf_conselho" CHAR(2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "responsavel_tecnico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empreendimento" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "requerente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "endereco" JSONB,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "poligono_geojson" JSONB,
    "tipologia_id" UUID NOT NULL,
    "grandeza_porte" DECIMAL(14,2),
    "porte" "Porte" NOT NULL,
    "porte_justificativa" TEXT,
    "potencial_poluidor" "PotencialPoluidor" NOT NULL,
    "area_m2" DECIMAL(14,2),
    "numero_car" TEXT,
    "status" "StatusEmpreendimento" NOT NULL DEFAULT 'ATIVO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "empreendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empreendimento_rt" (
    "id" UUID NOT NULL,
    "empreendimento_id" UUID NOT NULL,
    "rt_id" UUID NOT NULL,
    "desde" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ate" DATE,

    CONSTRAINT "empreendimento_rt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processo" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "numero" TEXT,
    "empreendimento_id" UUID NOT NULL,
    "requerente_id" UUID NOT NULL,
    "rt_id" UUID,
    "tipo_ato_id" UUID NOT NULL,
    "status" "StatusProcesso" NOT NULL DEFAULT 'RASCUNHO',
    "etapa_atual" TEXT,
    "tecnico_id" UUID,
    "gestor_id" UUID,
    "data_protocolo" TIMESTAMP(3),
    "data_conclusao" TIMESTAMP(3),
    "prazo_etapa_ate" TIMESTAMP(3),
    "prazo_pausado" BOOLEAN NOT NULL DEFAULT false,
    "prazo_saldo_dias" INTEGER,
    "valor_taxa" DECIMAL(12,2),
    "taxa_paga" BOOLEAN NOT NULL DEFAULT false,
    "descricao_atividade" TEXT,
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tramitacao" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "acao" TEXT NOT NULL,
    "de_status" "StatusProcesso",
    "para_status" "StatusProcesso" NOT NULL,
    "de_usuario_id" UUID,
    "para_usuario_id" UUID,
    "despacho" TEXT,
    "publico" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tramitacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anexo" (
    "id" UUID NOT NULL,
    "processo_id" UUID,
    "fiscalizacao_id" UUID,
    "pendencia_id" UUID,
    "documento_exigido_id" UUID,
    "tipo" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "enviado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pendencia" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'DOCUMENTAL',
    "descricao" TEXT NOT NULL,
    "prazo_dias" INTEGER NOT NULL,
    "prazo_ate" TIMESTAMP(3) NOT NULL,
    "status" "StatusPendencia" NOT NULL DEFAULT 'ABERTA',
    "resposta" TEXT,
    "respondida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "pendencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_preenchido" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "checklist_modelo_id" UUID NOT NULL,
    "respostas" JSONB NOT NULL,
    "preenchido_por" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "checklist_preenchido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parecer" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "conclusao" "ConclusaoParecer" NOT NULL,
    "texto_html" TEXT NOT NULL,
    "autor_id" UUID NOT NULL,
    "documento_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "parecer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "condicionante" (
    "id" UUID NOT NULL,
    "processo_id" UUID NOT NULL,
    "documento_id" UUID,
    "descricao" TEXT NOT NULL,
    "periodicidade" TEXT,
    "prazo_ate" TIMESTAMP(3),
    "status" "StatusCondicionante" NOT NULL DEFAULT 'PENDENTE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "condicionante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_oficial" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "processo_id" UUID,
    "fiscalizacao_id" UUID,
    "tipo" "TipoDocumento" NOT NULL,
    "sigla_ato" TEXT,
    "numero" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "codigo_verificador" TEXT NOT NULL,
    "titular_id" UUID,
    "sha256_pdf" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "validade_ate" TIMESTAMP(3),
    "emitido_por" UUID NOT NULL,
    "emitido_por_nome" TEXT NOT NULL,
    "emitido_por_cargo" TEXT,
    "emitido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "StatusDocumento" NOT NULL DEFAULT 'VALIDO',
    "motivo_cancelamento" TEXT,
    "cancelado_em" TIMESTAMP(3),
    "substituto_id" UUID,
    "dados" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documento_oficial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denuncia" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "protocolo" TEXT NOT NULL,
    "canal" "CanalDenuncia" NOT NULL,
    "anonima" BOOLEAN NOT NULL DEFAULT true,
    "denunciante_nome" TEXT,
    "contato" TEXT,
    "descricao" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "endereco" TEXT,
    "status" "StatusDenuncia" NOT NULL DEFAULT 'NOVA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "denuncia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscalizacao" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "origem" "OrigemFiscalizacao" NOT NULL,
    "denuncia_id" UUID,
    "processo_id" UUID,
    "empreendimento_id" UUID,
    "data_hora" TIMESTAMP(3) NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "precisao_m" DECIMAL(10,2),
    "equipe" JSONB,
    "relato" TEXT,
    "constatacao" "Constatacao",
    "status" "StatusFiscalizacao" NOT NULL DEFAULT 'REALIZADA',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "fiscalizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_infracao" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "fiscalizacao_id" UUID NOT NULL,
    "numero" TEXT NOT NULL,
    "autuado_id" UUID NOT NULL,
    "enquadramento_legal" TEXT NOT NULL,
    "descricao_infracao" TEXT NOT NULL,
    "penalidade" "Penalidade" NOT NULL,
    "valor_multa" DECIMAL(14,2),
    "prazo_defesa_dias" INTEGER NOT NULL DEFAULT 20,
    "status" "StatusAuto" NOT NULL DEFAULT 'LAVRADO',
    "documento_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "auto_infracao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "fiscalizacao_id" UUID,
    "processo_id" UUID,
    "numero" TEXT NOT NULL,
    "notificado_id" UUID NOT NULL,
    "exigencia" TEXT NOT NULL,
    "prazo_dias" INTEGER NOT NULL,
    "prazo_ate" TIMESTAMP(3) NOT NULL,
    "status" "StatusNotificacao" NOT NULL DEFAULT 'EMITIDA',
    "documento_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conselho" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "lei_criacao" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "conselho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reuniao_conselho" (
    "id" UUID NOT NULL,
    "conselho_id" UUID NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "tipo" "TipoReuniao" NOT NULL,
    "pauta" TEXT NOT NULL,
    "ata_pdf_key" TEXT,
    "deliberacoes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "reuniao_conselho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerta" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "municipio_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "referencia_tipo" TEXT NOT NULL,
    "referencia_id" UUID NOT NULL,
    "chave" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "vence_em" TIMESTAMP(3),
    "lido" BOOLEAN NOT NULL DEFAULT false,
    "enviado_email" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_enviado" (
    "id" UUID NOT NULL,
    "para" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "erro" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_enviado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_auditoria" (
    "id" UUID NOT NULL,
    "usuario_id" UUID,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exportacao" (
    "id" UUID NOT NULL,
    "solicitada_por" UUID NOT NULL,
    "escopo" TEXT NOT NULL,
    "status" "StatusExportacao" NOT NULL DEFAULT 'PENDENTE',
    "storage_key" TEXT,
    "tamanho" INTEGER,
    "erro" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluida_em" TIMESTAMP(3),

    CONSTRAINT "exportacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_registro" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "executado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tamanho" BIGINT,
    "destino" TEXT,
    "sucesso" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "created_by" UUID,

    CONSTRAINT "backup_registro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chamado_suporte" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "aberto_por" UUID NOT NULL,
    "severidade" "Severidade" NOT NULL,
    "descricao" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ABERTO',
    "aberto_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "primeira_resposta_em" TIMESTAMP(3),
    "resolvido_em" TIMESTAMP(3),

    CONSTRAINT "chamado_suporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "municipio_sigla_key" ON "municipio"("sigla");

-- CreateIndex
CREATE UNIQUE INDEX "municipio_codigo_ibge_key" ON "municipio"("codigo_ibge");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_cpf_hash_key" ON "usuario"("cpf_hash");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_papel_usuario_id_papel_municipio_id_key" ON "usuario_papel"("usuario_id", "papel", "municipio_id");

-- CreateIndex
CREATE UNIQUE INDEX "tipologia_organizacao_id_codigo_key" ON "tipologia"("organizacao_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_ato_organizacao_id_sigla_key" ON "tipo_ato"("organizacao_id", "sigla");

-- CreateIndex
CREATE UNIQUE INDEX "sequencia_municipio_id_tipo_ano_key" ON "sequencia"("municipio_id", "tipo", "ano");

-- CreateIndex
CREATE UNIQUE INDEX "pessoa_cpf_cnpj_hash_key" ON "pessoa"("cpf_cnpj_hash");

-- CreateIndex
CREATE UNIQUE INDEX "responsavel_tecnico_pessoa_id_key" ON "responsavel_tecnico"("pessoa_id");

-- CreateIndex
CREATE INDEX "empreendimento_municipio_id_idx" ON "empreendimento"("municipio_id");

-- CreateIndex
CREATE UNIQUE INDEX "processo_numero_key" ON "processo"("numero");

-- CreateIndex
CREATE INDEX "processo_municipio_id_status_idx" ON "processo"("municipio_id", "status");

-- CreateIndex
CREATE INDEX "tramitacao_processo_id_created_at_idx" ON "tramitacao"("processo_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documento_oficial_codigo_verificador_key" ON "documento_oficial"("codigo_verificador");

-- CreateIndex
CREATE UNIQUE INDEX "documento_oficial_municipio_id_tipo_numero_key" ON "documento_oficial"("municipio_id", "tipo", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "denuncia_protocolo_key" ON "denuncia"("protocolo");

-- CreateIndex
CREATE UNIQUE INDEX "alerta_chave_key" ON "alerta"("chave");

-- CreateIndex
CREATE INDEX "alerta_usuario_id_lido_idx" ON "alerta"("usuario_id", "lido");

-- CreateIndex
CREATE INDEX "log_auditoria_entidade_entidade_id_idx" ON "log_auditoria"("entidade", "entidade_id");

-- CreateIndex
CREATE INDEX "log_auditoria_created_at_idx" ON "log_auditoria"("created_at");

-- AddForeignKey
ALTER TABLE "municipio" ADD CONSTRAINT "municipio_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_papel" ADD CONSTRAINT "usuario_papel_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_papel" ADD CONSTRAINT "usuario_papel_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipologia" ADD CONSTRAINT "tipologia_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipo_ato" ADD CONSTRAINT "tipo_ato_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tipo_ato" ADD CONSTRAINT "tipo_ato_checklist_modelo_id_fkey" FOREIGN KEY ("checklist_modelo_id") REFERENCES "checklist_modelo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_exigido" ADD CONSTRAINT "documento_exigido_tipo_ato_id_fkey" FOREIGN KEY ("tipo_ato_id") REFERENCES "tipo_ato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_exigido" ADD CONSTRAINT "documento_exigido_tipologia_id_fkey" FOREIGN KEY ("tipologia_id") REFERENCES "tipologia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prazo_config" ADD CONSTRAINT "prazo_config_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prazo_config" ADD CONSTRAINT "prazo_config_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feriado" ADD CONSTRAINT "feriado_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pessoa" ADD CONSTRAINT "pessoa_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsavel_tecnico" ADD CONSTRAINT "responsavel_tecnico_pessoa_id_fkey" FOREIGN KEY ("pessoa_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empreendimento" ADD CONSTRAINT "empreendimento_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empreendimento" ADD CONSTRAINT "empreendimento_requerente_id_fkey" FOREIGN KEY ("requerente_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empreendimento" ADD CONSTRAINT "empreendimento_tipologia_id_fkey" FOREIGN KEY ("tipologia_id") REFERENCES "tipologia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empreendimento_rt" ADD CONSTRAINT "empreendimento_rt_empreendimento_id_fkey" FOREIGN KEY ("empreendimento_id") REFERENCES "empreendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empreendimento_rt" ADD CONSTRAINT "empreendimento_rt_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "responsavel_tecnico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_empreendimento_id_fkey" FOREIGN KEY ("empreendimento_id") REFERENCES "empreendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_requerente_id_fkey" FOREIGN KEY ("requerente_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_rt_id_fkey" FOREIGN KEY ("rt_id") REFERENCES "responsavel_tecnico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_tipo_ato_id_fkey" FOREIGN KEY ("tipo_ato_id") REFERENCES "tipo_ato"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_tecnico_id_fkey" FOREIGN KEY ("tecnico_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_gestor_id_fkey" FOREIGN KEY ("gestor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tramitacao" ADD CONSTRAINT "tramitacao_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_fiscalizacao_id_fkey" FOREIGN KEY ("fiscalizacao_id") REFERENCES "fiscalizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo" ADD CONSTRAINT "anexo_pendencia_id_fkey" FOREIGN KEY ("pendencia_id") REFERENCES "pendencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pendencia" ADD CONSTRAINT "pendencia_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_preenchido" ADD CONSTRAINT "checklist_preenchido_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_preenchido" ADD CONSTRAINT "checklist_preenchido_checklist_modelo_id_fkey" FOREIGN KEY ("checklist_modelo_id") REFERENCES "checklist_modelo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parecer" ADD CONSTRAINT "parecer_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condicionante" ADD CONSTRAINT "condicionante_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_oficial" ADD CONSTRAINT "documento_oficial_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_oficial" ADD CONSTRAINT "documento_oficial_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_oficial" ADD CONSTRAINT "documento_oficial_fiscalizacao_id_fkey" FOREIGN KEY ("fiscalizacao_id") REFERENCES "fiscalizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denuncia" ADD CONSTRAINT "denuncia_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscalizacao" ADD CONSTRAINT "fiscalizacao_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscalizacao" ADD CONSTRAINT "fiscalizacao_denuncia_id_fkey" FOREIGN KEY ("denuncia_id") REFERENCES "denuncia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscalizacao" ADD CONSTRAINT "fiscalizacao_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscalizacao" ADD CONSTRAINT "fiscalizacao_empreendimento_id_fkey" FOREIGN KEY ("empreendimento_id") REFERENCES "empreendimento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_infracao" ADD CONSTRAINT "auto_infracao_fiscalizacao_id_fkey" FOREIGN KEY ("fiscalizacao_id") REFERENCES "fiscalizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_infracao" ADD CONSTRAINT "auto_infracao_autuado_id_fkey" FOREIGN KEY ("autuado_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_fiscalizacao_id_fkey" FOREIGN KEY ("fiscalizacao_id") REFERENCES "fiscalizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_notificado_id_fkey" FOREIGN KEY ("notificado_id") REFERENCES "pessoa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conselho" ADD CONSTRAINT "conselho_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reuniao_conselho" ADD CONSTRAINT "reuniao_conselho_conselho_id_fkey" FOREIGN KEY ("conselho_id") REFERENCES "conselho"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_auditoria" ADD CONSTRAINT "log_auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chamado_suporte" ADD CONSTRAINT "chamado_suporte_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
