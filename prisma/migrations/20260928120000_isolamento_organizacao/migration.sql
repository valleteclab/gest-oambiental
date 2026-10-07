-- Isolamento por organização (tenant/cliente SaaS).
-- Usuários internos, checklists, modelos de documento e exportações passam a pertencer a uma organização.
-- Requerentes (cidadãos/empresas) continuam globais: usuario.organizacao_id NULL.

-- AlterTable
ALTER TABLE "checklist_modelo" ADD COLUMN     "organizacao_id" UUID;

-- AlterTable
ALTER TABLE "exportacao" ADD COLUMN     "organizacao_id" UUID;

-- AlterTable
ALTER TABLE "modelo_documento" ADD COLUMN     "organizacao_id" UUID;

-- AlterTable
ALTER TABLE "usuario" ADD COLUMN     "organizacao_id" UUID;

-- CreateIndex
CREATE INDEX "usuario_organizacao_id_idx" ON "usuario"("organizacao_id");

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_modelo" ADD CONSTRAINT "checklist_modelo_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modelo_documento" ADD CONSTRAINT "modelo_documento_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exportacao" ADD CONSTRAINT "exportacao_organizacao_id_fkey" FOREIGN KEY ("organizacao_id") REFERENCES "organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ───────────── Backfill (bases existentes) ─────────────
-- Organização "padrão" das bases anteriores ao multi-cliente: a de demonstração (CID-DEMO) ou a mais antiga.

-- 1) Usuários com papel municipal → organização do município do papel.
UPDATE "usuario" u
   SET "organizacao_id" = m."organizacao_id"
  FROM "usuario_papel" up
  JOIN "municipio" m ON m."id" = up."municipio_id"
 WHERE up."usuario_id" = u."id" AND up."papel" <> 'REQUERENTE' AND u."organizacao_id" IS NULL;

-- 2) Usuários com papel de organização (ADMIN, TEC_CONSORCIO, SEMA_INEMA) → organização padrão.
UPDATE "usuario" u
   SET "organizacao_id" = COALESCE(
         (SELECT "id" FROM "organizacao" WHERE "sigla" = 'CID-DEMO' LIMIT 1),
         (SELECT "id" FROM "organizacao" ORDER BY "created_at" ASC, "id" ASC LIMIT 1))
 WHERE u."organizacao_id" IS NULL
   AND EXISTS (SELECT 1 FROM "usuario_papel" up WHERE up."usuario_id" = u."id" AND up."papel" IN ('ADMIN', 'TEC_CONSORCIO', 'SEMA_INEMA'));

-- 3) Checklists → organização dos tipos de ato que os usam (ou a padrão).
UPDATE "checklist_modelo" c
   SET "organizacao_id" = COALESCE(
         (SELECT t."organizacao_id" FROM "tipo_ato" t WHERE t."checklist_modelo_id" = c."id" ORDER BY t."created_at" LIMIT 1),
         (SELECT "id" FROM "organizacao" WHERE "sigla" = 'CID-DEMO' LIMIT 1),
         (SELECT "id" FROM "organizacao" ORDER BY "created_at" ASC, "id" ASC LIMIT 1))
 WHERE c."organizacao_id" IS NULL;

-- 4) Modelos de documento editados por um usuário → organização do autor (sem autor = modelo global).
UPDATE "modelo_documento" md
   SET "organizacao_id" = u."organizacao_id"
  FROM "usuario" u
 WHERE md."created_by" = u."id" AND md."organizacao_id" IS NULL;

-- 5) Exportações → organização de quem solicitou.
UPDATE "exportacao" e
   SET "organizacao_id" = u."organizacao_id"
  FROM "usuario" u
 WHERE e."solicitada_por" = u."id" AND e."organizacao_id" IS NULL;
