# Cobrança de taxas de licenciamento (Pix/boleto – Asaas)

O LicenciaGov gera as guias (DAM) das taxas de licenciamento de cada processo e as cobra por **Pix, boleto ou cartão**
pela conta **Asaas da própria prefeitura**: o dinheiro cai direto na conta do município – o LicenciaGov não recebe,
não repassa e não guarda valores. A confirmação do pagamento é automática (webhook) e libera a etapa seguinte do processo.

Sem configuração **ativa** no município nada muda: nenhuma cobrança é gerada e o fluxo do processo é o de sempre.

## 1. Base legal (antes de tudo)

- A taxa de licenciamento é **tributo** (taxa pelo exercício do poder de polícia – CTN art. 77/78): só pode ser cobrada se
  **instituída em lei municipal**, com fato gerador, base de cálculo e valores (em geral por porte × potencial poluidor).
- Cadastre na tabela de taxas exatamente os valores da lei e informe a **base legal** (lei, artigo, anexo) na tabela e nas
  instruções da configuração – esse texto vai na descrição da cobrança que o requerente vê.
- Isenções (entidades sem fins lucrativos, órgãos públicos, agricultura familiar…) também dependem da lei: use
  **Isentar** informando o fundamento.
- Multa (até 2%) e juros (até 1% a.m.) por atraso só se previstos na legislação municipal.

## 2. Conta Asaas da prefeitura

1. A prefeitura (CNPJ do município ou do fundo municipal de meio ambiente) abre a conta em <https://www.asaas.com>
   e conclui a verificação cadastral (documentos do representante legal).
2. Em **Integrações → Chave de API**, gera a chave (`$aact_prod_…`). Para testes, crie uma conta em
   <https://sandbox.asaas.com> – a chave de homologação contém `_hmlg_` e o sistema usa automaticamente
   `https://api-sandbox.asaas.com/v3` (produção: `https://api.asaas.com/v3`).
3. Cadastre uma **chave Pix** na conta (senão o QR Code Pix não é gerado; o boleto e a fatura continuam funcionando).

## 3. Configuração no LicenciaGov (Administração → Cobrança de taxas – `/admin/cobranca`)

Por município (somente o ADMIN da organização):

| Campo | Uso |
| --- | --- |
| Cobrança ativa | Liga a geração de cobranças nos processos do município. |
| Bloquear a etapa seguinte até o pagamento (`exige_pagamento`) | Com a taxa em aberto: não aceita a triagem (taxa de análise/única), não conclui a vistoria (taxa de vistoria) e não emite o documento (taxa de emissão). Mensagem: “Aguardando pagamento da taxa …”. Desligado: a cobrança é gerada, mas o fluxo segue. |
| Gateway | **Asaas** (Pix/boleto/cartão) ou **Sem gateway** (guia sem pagamento online – só baixa manual). |
| Chave da API | **Somente escrita**: é cifrada (AES-256-GCM, `DATA_KEY`) e nunca volta para a tela/API – aparece só `••••1234`. Deixe em branco para manter; “Remover a chave salva” apaga. O prefixo decide o ambiente. |
| Sandbox | Homologação. **Sandbox sem chave = modo simulado** (ver §6). |
| Vencimento (dias) | Vencimento = data da geração + N dias corridos. |
| Multa / juros | Enviados ao Asaas (`fine`/`interest`) – aplicados pelo próprio Asaas após o vencimento. |
| Instruções / base legal | Texto incluído na descrição da cobrança. |

Botões: **Testar conexão** (`GET /myAccount` + `/finance/balance`), **Gerar token** do webhook,
**Registrar webhook no Asaas** (`POST /webhooks`) e **Sincronizar pendentes agora**.

### Webhook

URL: `{APP_URL}/api/v1/webhooks/asaas/{token}` (exibida na tela). O token é aleatório, por município, e deve ser
informado também como **Token de autenticação** do webhook no Asaas (header `asaas-access-token`). O botão
“Registrar webhook no Asaas” faz isso sozinho – exige `APP_URL` público em **HTTPS**. Manualmente: Asaas →
Integrações → Webhooks → Cobranças, envio sequencial, eventos `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`,
`PAYMENT_OVERDUE`, `PAYMENT_DELETED`, `PAYMENT_REFUNDED` (e `PAYMENT_RESTORED`).

O endpoint é público (sem sessão), **sempre responde 200** (token inválido/evento desconhecido são só registrados no log
do servidor, para o Asaas não pausar a fila), autentica pelo token da URL **e** pelo header, só aceita cobranças do
próprio município, grava o evento bruto no log de auditoria (`WEBHOOK_ASAAS`) e é **idempotente** (evento repetido ou
status igual não duplica tramitação nem e-mail). “Gerar novo token” invalida o anterior.

**Fallback**: o job `cobranca-sync` do worker (diário 07:00, `JOBS_CRON_COBRANCA`; desligar com
`COBRANCA_SYNC_DESATIVADO=true`) consulta `GET /payments/{id}` das cobranças em aberto, registra no gateway as que
falharam e marca como **Vencida** as vencidas. Avulso: `npm run cobranca:sync [-- SIGLA]`.

## 4. Tabela de taxas (`/admin/taxas`)

Linhas por organização (opcionalmente só para um município): **fase × tipo de ato × porte × potencial poluidor → valor**.
Campos vazios = “qualquer”. A linha **mais específica vence**: município > organização; depois tipo de ato definido >
qualquer; depois porte/potencial definidos > qualquer (empate: a mais recente). O “Simular valor” da tela mostra o
valor de cada fase para uma combinação.

| Fase | Gerada em | Bloqueia (se exigir pagamento) |
| --- | --- | --- |
| Única | protocolo (tem precedência sobre a de análise e dispensa as demais fases) | aceite da triagem |
| Análise | protocolo | aceite da triagem |
| Vistoria | agendamento da vistoria (não nas demandas urbanas) | conclusão da vistoria |
| Emissão | deferimento | emissão do documento (o deferimento fica registrado; “Emitir documento” após a quitação) |

Sem linha aplicável na tabela, a fase não é cobrada. O arquivamento cancela as cobranças em aberto. ADMIN e
GESTOR_MUNICIPAL podem gerar uma cobrança manualmente na aba **Taxas** do processo (valor da tabela ou informado).

## 5. Operação

- **Requerente** (“Meus processos”): valor, vencimento, situação, QR Code Pix, “Copiar código Pix”, linha digitável e
  “Pagar” (fatura Asaas: Pix, boleto ou cartão). Recebe e-mail na geração e na confirmação.
- **Aba Taxas do processo** e **Financeiro** (`/financeiro`): filtros por situação, município, fase e período;
  totais arrecadado / pendente / vencido / isento. Ações (ADMIN e GESTOR_MUNICIPAL do município): **baixa manual**
  (motivo obrigatório, forma, data, valor e comprovante opcional – ex.: DAM pago no banco), **isentar**, **cancelar**
  (também remove a cobrança no Asaas), **tentar novamente** (erro no gateway) e **reenviar** ao requerente. Técnicos,
  fiscais e SEMA/INEMA só consultam.
- Pagamento/isenção entram na **tramitação** (“Taxa de análise paga (Pix) – DAM-…”) e geram aviso no sino do técnico
  (e do gestor, na taxa de emissão). `processo.valor_taxa` = soma das cobranças não canceladas;
  `processo.taxa_paga` = todas quitadas.
- Numeração: `DAM-{SIGLA}-000001/{ANO}` (sequência por município/ano).
- Erro do gateway na geração: a cobrança fica **Pendente** com o erro visível e “Tentar novamente”; o job diário também
  tenta de novo.
- API: `GET /api/v1/cobrancas` (escopo por município; requerente: seus processos), `GET /api/v1/cobrancas/{id}`,
  `POST /api/v1/cobrancas` (gerar), `POST /api/v1/cobrancas/{id}/{baixa|isentar|cancelar|tentar-novamente|reenviar|simular-pagamento}`.

## 6. Homologação / demonstração (sem Asaas)

- `PAGAMENTOS_SIMULADO=true` (todos os municípios) ou config **sandbox sem chave** (por município): nenhuma chamada
  HTTP; Pix copia e cola e linha digitável **fictícios e marcados** (“SIMULACAO-HOMOLOGACAO … NAO-PAGAR”) e botão
  **“Simular pagamento (homologação)”** para o servidor e para o requerente.
- `npm run seed:cobranca-demo` (predeploy `SEED_COBRANCA_DEMO=true`): ativa a cobrança simulada e uma tabela de taxas
  com valores e lei **fictícios** em Riachão das Neves (RDN) e Alto do Umbuzeiro (AUM). Não toca os municípios usados
  pelos testes E2E (LOR/SSR/CSE).

## 7. LGPD e segurança

- Para criar o cliente no Asaas são enviados nome, CPF/CNPJ (decifrado só no momento do envio) e e-mail do requerente –
  tratamento necessário à cobrança do tributo (LGPD art. 7º, II/III e art. 23). O Asaas atua como operador da
  prefeitura (controladora); as notificações do próprio Asaas ficam desligadas (o LicenciaGov avisa o requerente).
- Chave da API cifrada em repouso, nunca devolvida; token do webhook e chave **não** entram na exportação de dados
  (`lib/export/dicionario.ts`). Toda escrita (configuração, tabela, cobrança, baixa, isenção, cancelamento, webhook) vai
  para o log de auditoria.
