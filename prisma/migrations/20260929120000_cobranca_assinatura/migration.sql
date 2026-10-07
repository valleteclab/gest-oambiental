-- CreateEnum
CREATE TYPE "FaseCobranca" AS ENUM ('UNICA', 'ANALISE', 'VISTORIA', 'EMISSAO');

-- CreateEnum
CREATE TYPE "StatusCobranca" AS ENUM ('PENDENTE', 'PAGA', 'VENCIDA', 'CANCELADA', 'ESTORNADA', 'ISENTA');

-- CreateEnum
CREATE TYPE "GatewayCobranca" AS ENUM ('ASAAS', 'MANUAL');

-- CreateEnum
CREATE TYPE "TitularCertificado" AS ENUM ('ORGAO', 'USUARIO');

-- AlterTable
ALTER TABLE "documento_oficial" ADD COLUMN     "assinado_em" TIMESTAMP(3),
ADD COLUMN     "assinatura_tipo" TEXT,
ADD COLUMN     "assinaturas" JSONB,
ADD COLUMN     "certificado_id" UUID;

-- CreateTable
CREATE TABLE "config_cobranca" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "gateway" "GatewayCobranca" NOT NULL DEFAULT 'ASAAS',
    "asaas_api_key_cifrada" TEXT,
    "asaas_sandbox" BOOLEAN NOT NULL DEFAULT true,
    "asaas_webhook_token" TEXT,
    "dias_vencimento" INTEGER NOT NULL DEFAULT 10,
    "exige_pagamento" BOOLEAN NOT NULL DEFAULT true,
    "multa_percentual" DECIMAL(5,2),
    "juros_mensal_percentual" DECIMAL(5,2),
    "instrucoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "config_cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tabela_taxa" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID,
    "tipo_ato_id" UUID,
    "fase" "FaseCobranca" NOT NULL,
    "porte" "Porte",
    "potencial" "PotencialPoluidor",
    "valor" DECIMAL(12,2) NOT NULL,
    "descricao" TEXT,
    "base_legal" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "tabela_taxa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobranca" (
    "id" UUID NOT NULL,
    "municipio_id" UUID NOT NULL,
    "processo_id" UUID,
    "numero" TEXT,
    "fase" "FaseCobranca" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "StatusCobranca" NOT NULL DEFAULT 'PENDENTE',
    "gateway" "GatewayCobranca" NOT NULL,
    "pagador_id" UUID,
    "asaas_customer_id" TEXT,
    "asaas_payment_id" TEXT,
    "invoice_url" TEXT,
    "boleto_url" TEXT,
    "linha_digitavel" TEXT,
    "pix_copia_cola" TEXT,
    "pix_qr_base64" TEXT,
    "pix_expira_em" TIMESTAMP(3),
    "pago_em" TIMESTAMP(3),
    "valor_pago" DECIMAL(12,2),
    "forma_pagamento" TEXT,
    "baixa_manual" BOOLEAN NOT NULL DEFAULT false,
    "baixa_por" UUID,
    "baixa_motivo" TEXT,
    "comprovante_key" TEXT,
    "cancelado_motivo" TEXT,
    "erro_gateway" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificado_digital" (
    "id" UUID NOT NULL,
    "organizacao_id" UUID NOT NULL,
    "municipio_id" UUID,
    "usuario_id" UUID,
    "titular" "TitularCertificado" NOT NULL,
    "pfx_cifrado" TEXT NOT NULL,
    "senha_cifrada" TEXT NOT NULL,
    "nome_titular" TEXT NOT NULL,
    "documento_titular" TEXT,
    "emissor" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "thumbprint_sha1" TEXT NOT NULL,
    "valido_de" TIMESTAMP(3) NOT NULL,
    "valido_ate" TIMESTAMP(3) NOT NULL,
    "icp_brasil" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "certificado_digital_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "config_cobranca_municipio_id_key" ON "config_cobranca"("municipio_id");

-- CreateIndex
CREATE INDEX "tabela_taxa_organizacao_id_fase_idx" ON "tabela_taxa"("organizacao_id", "fase");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_asaas_payment_id_key" ON "cobranca"("asaas_payment_id");

-- CreateIndex
CREATE INDEX "cobranca_municipio_id_status_idx" ON "cobranca"("municipio_id", "status");

-- CreateIndex
CREATE INDEX "cobranca_processo_id_idx" ON "cobranca"("processo_id");

-- CreateIndex
CREATE INDEX "certificado_digital_organizacao_id_idx" ON "certificado_digital"("organizacao_id");

-- AddForeignKey
ALTER TABLE "documento_oficial" ADD CONSTRAINT "documento_oficial_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_digital"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_cobranca" ADD CONSTRAINT "config_cobranca_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabela_taxa" ADD CONSTRAINT "tabela_taxa_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabela_taxa" ADD CONSTRAINT "tabela_taxa_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabela_taxa" ADD CONSTRAINT "tabela_taxa_tipo_ato_id_fkey" FOREIGN KEY ("tipo_ato_id") REFERENCES "tipo_ato"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_digital" ADD CONSTRAINT "certificado_digital_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_digital" ADD CONSTRAINT "certificado_digital_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_digital" ADD CONSTRAINT "certificado_digital_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

