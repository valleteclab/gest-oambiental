-- Painel do operador da plataforma (/plataforma): situação do cliente, operadores e convites de senha.

CREATE TYPE "StatusOrganizacao" AS ENUM ('ATIVO', 'SUSPENSO');

ALTER TABLE "organizacao"
  ADD COLUMN "status" "StatusOrganizacao" NOT NULL DEFAULT 'ATIVO',
  ADD COLUMN "suspensa_em" TIMESTAMP(3),
  ADD COLUMN "suspensa_motivo" TEXT;

CREATE TABLE "operador_plataforma" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "origem" TEXT NOT NULL,
    "ultimo_acesso" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "operador_plataforma_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "operador_plataforma_usuario_id_key" ON "operador_plataforma"("usuario_id");
ALTER TABLE "operador_plataforma" ADD CONSTRAINT "operador_plataforma_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "convite_senha" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_por" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "convite_senha_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "convite_senha_token_hash_key" ON "convite_senha"("token_hash");
CREATE INDEX "convite_senha_usuario_id_idx" ON "convite_senha"("usuario_id");
ALTER TABLE "convite_senha" ADD CONSTRAINT "convite_senha_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defesa em profundidade: operador da plataforma nunca pode ter organização, papéis ou cadastro de pessoa.
CREATE OR REPLACE FUNCTION operador_plataforma_sem_vinculo() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM usuario u WHERE u.id = NEW.usuario_id AND (u.organizacao_id IS NOT NULL OR u.pessoa_id IS NOT NULL))
     OR EXISTS (SELECT 1 FROM usuario_papel p WHERE p.usuario_id = NEW.usuario_id) THEN
    RAISE EXCEPTION 'Operador da plataforma não pode ter organização, papéis ou cadastro de pessoa.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER operador_plataforma_sem_vinculo BEFORE INSERT OR UPDATE ON "operador_plataforma"
  FOR EACH ROW EXECUTE FUNCTION operador_plataforma_sem_vinculo();

-- E o inverso: um usuário que já é operador não ganha organização, papel ou pessoa.
CREATE OR REPLACE FUNCTION usuario_nao_operador_vinculo() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'usuario_papel' THEN
    IF EXISTS (SELECT 1 FROM operador_plataforma o WHERE o.usuario_id = NEW.usuario_id) THEN
      RAISE EXCEPTION 'Usuário é operador da plataforma e não pode receber papéis.';
    END IF;
  ELSE
    IF (NEW.organizacao_id IS NOT NULL OR NEW.pessoa_id IS NOT NULL)
       AND EXISTS (SELECT 1 FROM operador_plataforma o WHERE o.usuario_id = NEW.id) THEN
      RAISE EXCEPTION 'Usuário é operador da plataforma e não pode ter organização ou cadastro de pessoa.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER usuario_nao_operador_vinculo BEFORE INSERT OR UPDATE ON "usuario"
  FOR EACH ROW EXECUTE FUNCTION usuario_nao_operador_vinculo();
CREATE TRIGGER usuario_papel_nao_operador BEFORE INSERT ON "usuario_papel"
  FOR EACH ROW EXECUTE FUNCTION usuario_nao_operador_vinculo();
