-- GED: no máximo UMA solicitação de assinatura ABERTA por documento (antes garantido só por trava na transação).
-- Índice parcial (o Prisma não o expressa; migração manual, como as demais regras do módulo).
CREATE UNIQUE INDEX ged_solicitacao_unica_aberta ON ged_solicitacao_assinatura (documento_id) WHERE status = 'ABERTA';
