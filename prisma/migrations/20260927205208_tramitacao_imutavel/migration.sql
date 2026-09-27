-- Tramitação e log de auditoria são imutáveis (SPEC 5.3 / 9.3)
CREATE OR REPLACE FUNCTION bloqueia_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é imutável (operação % bloqueada)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tramitacao_imutavel BEFORE UPDATE OR DELETE ON tramitacao
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();

CREATE TRIGGER log_auditoria_imutavel BEFORE UPDATE OR DELETE ON log_auditoria
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();
