# Entregáveis contratuais – LicenciaGov

Modelos dos documentos exigidos pelo Termo de Referência do Pregão Eletrônico SRP nº 005/2026 (e aplicáveis a outros contratantes), redigidos em português, em Markdown, com campos a preencher entre **[COLCHETES]** (nº do contrato, datas, nomes, CNPJ da contratada e do contratante, municípios).

Contratada: **Valletec Lab** – [confirmar razão social e CNPJ antes de emitir qualquer documento].

## Documentos

| Arquivo | Documento | Base | Quando entregar | Observações |
|---|---|---|---|---|
| [`manual-do-usuario.md`](manual-do-usuario.md) | Manual operacional / do usuário, por perfil | TR item 5.3; SPEC §15 | Versão preliminar pode acompanhar a proposta/PoC; **versão final até 60 dias** após a assinatura do contrato | Descreve telas, menus e botões reais da versão atual. Inserir as capturas de tela nos pontos "[captura de tela]" a partir do ambiente de homologação (dados fictícios). Atualizar a cada versão relevante |
| [`relatorio-de-implementacao.md`](relatorio-de-implementacao.md) | Modelo de Relatório de Implementação com termo de aceite | TR item 5.3; SPEC §15 | **Até 60 dias** após a assinatura do contrato (fim da implantação) | Roteiro de aceite baseado nos itens T1–T10 da PoC (SPEC §13) + T11–T15 complementares |
| [`plano-de-treinamento.md`](plano-de-treinamento.md) | Plano do 1º ciclo de treinamento, com questionários, lista de presença, certificado e cronograma | SPEC §15 (1º ciclo de treinamento) | Plano no início da implantação; execução **dentro dos 60 dias**; evidências anexadas ao Relatório de Implementação | Cargas horárias propostas: requerentes/balcão 2 h, técnicos 8 h, gestores 4 h, fiscais 4 h (com prática de campo), administradores 6 h |
| [`acordo-de-nivel-de-servico.md`](acordo-de-nivel-de-servico.md) | Acordo de Nível de Serviço e suporte | SPEC §9.1 (99%), §9.2 (backup), §9.3 (LGPD); docs/operacao.md §7 | Pode acompanhar a proposta; vigente a partir da assinatura/go-live | Fórmula de disponibilidade, severidades e prazos, backup/RPO/RTO, LGPD, escalonamento, glosas |
| [`relatorio-mensal-sla.md`](relatorio-mensal-sla.md) | Modelo do Relatório Mensal de Disponibilidade e Chamados | SPEC §11 item 6 e §15; docs/operacao.md §7 | **Mensalmente**, a partir do 1º mês de produção (até o [5º] dia útil do mês seguinte) | Dados: monitor externo (`/api/health`), registros da tela Administração → Backup, painel/relatório "Indicadores por município" e controle de chamados |

## Fontes usadas

- `docs/SPEC.md` (fonte da verdade do produto e do escopo P0/P1/P2);
- `docs/operacao.md` (monitoramento e fórmula de disponibilidade), `docs/backup.md` e `docs/restore.md` (backup diário, retenção de 30 dias, RPO ≤ 24 h, RTO ≤ 4 h, teste de restauração mensal);
- `docs/cobranca.md`, `docs/assinatura-digital.md`, `docs/agente-denuncias.md`, `docs/monitoramento.md`, `docs/mapas.md`;
- telas em `app/`, menu `components/nav-interno.tsx` e matriz de permissões `lib/rbac.ts`.

## Itens a conferir com o TR completo e a Errata 01 (não estão no repositório)

Antes de emitir qualquer destes documentos, confrontar com o Termo de Referência (Anexo X), a Errata 01 e o contrato assinado:

1. **Prazos de atendimento do SLA** (1ª resposta e solução por severidade), classificação de severidades, horário de suporte e exigência de atendimento 24 x 7 – os valores do ANS são proposta de mercado (Crítica 1 h/4 h, Alta 4 h/1 dia útil, Média 1 dia útil/5 dias úteis, Baixa 2 dias úteis/próxima versão).
2. **Antecedência de manutenção programada** (proposto: 48 h) e limite mensal de manutenção.
3. **Glosas/penalidades** e limites percentuais – o ANS traz apenas faixas de referência; prevalecem contrato e Lei nº 14.133/2021.
4. **Carga horária, modalidade, número de turmas e certificação do treinamento** – valores propostos no plano.
5. **Prazo de comunicação de incidentes de segurança** ao Controlador (proposto: 48 h) e prazo de devolução/eliminação de dados ao fim do contrato.
6. **Acessibilidade – e-MAG** (Modelo de Acessibilidade em Governo Eletrônico): o sistema segue boas práticas (labels em todos os campos, navegação por teclado, "Pular para o conteúdo", contraste, responsividade a partir de 320 px), mas **não há relatório formal de conformidade e-MAG no repositório**; se exigido, produzir avaliação (ex.: checklist e-MAG 3.1 + ferramenta automática) antes de declarar conformidade.
7. **Atestados de capacidade técnica** e demais documentos de habilitação – não fazem parte destes modelos.
8. Hospedagem: confirmar **provedor e região (Brasil)** do ambiente de produção a declarar no ANS/Relatório de Implementação (a SPEC recomenda região Brasil; a documentação de backup cita Railway e provedores S3-compatíveis de DR).
9. Conteúdo mínimo exigido do **manual operacional** e do **relatório de implementação** pelo item 5.3 do TR.
10. Periodicidade e data de entrega do **relatório mensal**.

## Funcionalidades citadas como "previstas para a fase de implantação (até 60 dias)"

Não implementadas na versão atual e por isso sinalizadas nos documentos: importação de planilhas legadas; conselhos municipais (pautas, atas, deliberações); acompanhamento/baixa de condicionantes e fluxo de renovação (hoje há alertas de prazo de condicionantes e de vencimento de licenças a 120/60/30 dias); modelos de Termo de Referência para estudos; registro de chamados de suporte no sistema e geração automática do relatório mensal de SLA. Evoluções P2 (fora do escopo inicial): integração SEIA, login gov.br, assinatura gov.br/A3, app offline de fiscalização.
