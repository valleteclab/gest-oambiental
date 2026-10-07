# Agente de denúncias ambientais (WhatsApp, chat do site e e-mail)

O **Assistente Ambiental** recebe denúncias pelo WhatsApp (Evolution API, Z-API ou Chatwoot/API oficial), pelo chat do
site (`/denuncia` e `/orgao/{SIGLA}`) e por e-mail, e cria **as mesmas denúncias** do módulo de fiscalização
(`criarDenunciaCanal()` em `lib/fiscalizacao/servico.ts`: protocolo `DEN-{SIGLA}-{000}/{ANO}`, status NOVA, mapa,
vistoria). As fotos da conversa viram anexos da denúncia (`anexo.denuncia_id`).

Migração: `prisma/migrations/20260928200000_agente_denuncias`.

## Arquitetura

```
provedor ──POST /api/webhooks/{canalId}──▶ verifica segredo (401) ─▶ evento_webhook (bruto) ─▶ 200
                                                                        │
             worker no ar? ── sim ─▶ varredura 2 s → fila pg-boss `canal-mensagem` (jobs/worker.ts)
                           └─ não ─▶ processarEvento() em segundo plano no próprio web (fire-and-forget)
processarEvento → provedor.parseWebhook() → InboundEvent[] normalizados
  → processarInbound(): lock por chat (pg_advisory_xact_lock + fila em memória) → dedup
    UNIQUE(canal_id, provider_message_id) → mídia baixada NA HORA para o storage ({sigla}/conversas/{id}/…)
    → áudio transcrito (Groq) → orquestrador → máquina de estados → ações → respostas (enviarRespostas)
chat do site ──POST /api/v1/public/chat/mensagens──▶ processarInbound() (síncrono) ; GET = polling de 5 s
```

| Pasta | Conteúdo |
|---|---|
| `lib/canais/` | Abstração de provedores (`tipos.ts` – `InboundEvent`/`Provedor`), `evolution.ts`, `zapi.ts`, `chatwoot.ts`, `webchat.ts`, `email.ts`; `telefone.ts` (E.164, 9º dígito), `contato.ts` (HMAC de contato/chat), `index.ts` (registro, config cifrada, URL do webhook, ritmo 3–8 s, envio simulado) |
| `lib/agente/` | `maquina.ts` (máquina de estados pura), `interpretar.ts` (questionário determinístico), `llm.ts` (OpenRouter + Groq), `prompt.ts` (prompt/anti-injeção), `orquestrador.ts`, `ingestao.ts`, `envio.ts`, `notificar.ts`, `manutencao.ts`, `atendimento.ts` (back-office), `canais-admin.ts`, `webchat.ts`, `acompanhar.ts` |
| Telas | `/atendimento` (lista/conversa), `/admin/canais`, `/denuncia` (chat + formulário), `/denuncia/acompanhar`, botão flutuante em `/orgao/{SIGLA}` |
| API | `POST /api/webhooks/{canalId}`; `GET/POST/DELETE /api/v1/public/chat/mensagens`; `GET /api/v1/atendimento/conversas[/{id}]`, `POST /api/v1/atendimento/conversas/{id}` (`assumir`, `devolver`, `responder`, `encerrar`, `criar_denuncia`); `GET/POST /api/v1/admin/canais`, `PATCH/POST /api/v1/admin/canais/{id}` (`conectar`, `status`, `testar`) |

### Máquina de estados (em código)

`INICIO → AGUARDANDO_LGPD → COLETANDO ⇄ CONFIRMANDO → REGISTRADA → ENCERRADA`, com `HUMANO` (IA pausada por 3 h).

* **LGPD**: botões Sim/Não; consentimento gravado em `conversa.lgpd_consentimento_em` (vale 180 dias para o mesmo contato no canal).
* **Coleta** (o código decide o que falta – `proximoCampo()`): município (canal da organização) → tipo (11 tipos) → descrição →
  local (pin GPS preferido, ou endereço + referência) → fotos (até 5, ou "não tenho") → anônimo/identificado (+ nome) →
  contato para acompanhar (só no chat do site).
* **Confirmação**: resumo 📋 "Está tudo correto? Posso registrar?". Registra **somente** com botão/"sim" (mensagem inteira)
  ou `confirma:true` da IA **no estado CONFIRMANDO**. "Corrigir" → lista de campos.
* **Determinístico (sem IA)**: saudação/agradecimento, `sair`, emergência (193/190/199), consulta de protocolo
  (`DEN-XXX-000/AAAA`) – respondida **só se o hash do contato da conversa for igual ao da denúncia**, limite de 20 msgs/10 min por
  conversa, avaliação 1–5 ⭐ após "Concluída".
* **IA (opcional)**: (a) `entenderMensagem` – UMA ferramenta forçada `atualizar_denuncia` (argumentos validados com zod; fotos
  enviadas como `image_url` para enriquecer a descrição); (b) `redigirResposta` – redige a pergunta do próximo campo. Texto do cidadão
  higienizado e delimitado como dado; resposta descartada se vazar o prompt (canário) ou afirmar registro/protocolo. Timeout 25 s,
  `finish_reason=length` → fallback determinístico. Sem `OPENROUTER_API_KEY` → questionário passo a passo (também usado nos testes).
* **Atendente humano**: resposta pelo painel, `fromMe` sem ser da API (Z-API `fromApi=false`; Evolution: id não enviado por nós),
  ou mensagem `outgoing` do Chatwoot sem a marca `​` → `HUMANO` por 3 h (job reativa). Inatividade > 6 h → `ENCERRADA`.
* **Avisos de situação**: `alterarStatusDenuncia()` e a vistoria (NOVA→EM_APURACAO) chamam `notificarStatusDenuncia()`. Chatwoot/API
  oficial fora da janela de 24 h: não envia e registra `IGNORADA – requer template aprovado`. E-mail sempre envia.

### Segurança e LGPD
* Credenciais do canal: `canal_atendimento.config.segredos` cifrado (AES-256-GCM `cifrar`); segredo do webhook cifrado; comparação em tempo constante.
* Contato do cidadão: `conversa.contato_cifrado` + `contato_hash` (HMAC com `HASH_PEPPER`); denúncia anônima guarda só o **hash**
  (acompanhamento pelo próprio cidadão), nunca o telefone em claro.
* Escopo: `/atendimento` usa o escopo por município (`escopoMunicipios`); conversas ainda sem município só para papéis de organização.
  SEMA_INEMA e GESTOR são somente leitura (telefone mascarado para SEMA).
* Auditoria: `DENUNCIA_CANAL` (usuário nulo), `ASSUMIR_ATENDIMENTO`, `DEVOLVER_ATENDIMENTO_IA`, `RESPONDER_ATENDIMENTO`,
  `CRIAR_DENUNCIA_ATENDIMENTO`, CRUD de canais.
* `evento_webhook` (payload bruto, contém telefones) é apagado após `CANAIS_RETENCAO_EVENTOS_DIAS` (15) e não entra na exportação por organização.
* Exportação completa: `canal_atendimento`, `conversa`, `mensagem_conversa`, `uso_ia` por organização (colunas cifradas continuam cifradas).

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `OPENROUTER_API_KEY` | Liga a IA. Sem ela: questionário determinístico. |
| `OPENROUTER_MODEL` | Padrão `anthropic/claude-sonnet-5` (escolhido em 28/09/2026 na lista `GET /api/v1/models`: Sonnet atual com tools + imagem, US$ 2/10 por 1M tokens). |
| `OPENROUTER_MODEL_RAPIDO` | Padrão `anthropic/claude-haiku-4.5` (US$ 1/5) – redação das perguntas. |
| `GROQ_API_KEY` | Transcrição de áudio (`whisper-large-v3`). Sem ela: pede para escrever. |
| `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY` | Evolution API já implantada (pode ser sobrescrita por canal). |
| `CANAIS_ENVIO_SIMULADO` | `true` = não chama WhatsApp (status `SIMULADA`, só log). |
| `CANAIS_INLINE`, `CANAIS_INTERVALO_MIN_MS/MAX_MS`, `CANAIS_RETENCAO_EVENTOS_DIAS`, `AGENTE_LIMITE_MSGS`, `AGENTE_INATIVIDADE_H`, `JOBS_CRON_CANAIS`, `JOBS_VARREDURA_CANAIS_MS`, `CHAT_LIMITE_IP` | Ajustes finos (ver `.env.example`). |
| `APP_URL` | Base das URLs de webhook e dos links enviados ao cidadão. |

Custos: cada chamada grava `uso_ia` (tokens + `usage.cost` do OpenRouter, ou estimativa pela tabela de preços). Relatório mensal em
`/admin/canais`. Ordem de grandeza: uma denúncia completa ≈ 8–12 chamadas curtas ≈ US$ 0,02–0,05 com os padrões.

## Como conectar cada canal (`/admin/canais`)

1. **Evolution API (recomendado para começar)** – Novo canal → "WhatsApp (Evolution API)", município, nome da instância
   (ex.: `lor-denuncias`). Clique **Criar instância / QR Code**: o sistema cria a instância (`WHATSAPP-BAILEYS`), configura o
   webhook (`/webhook/set`, eventos MESSAGES_UPSERT/MESSAGES_UPDATE/CONNECTION_UPDATE/QRCODE_UPDATED, header `x-webhook-secret`) e
   mostra o QR Code. No celular do órgão: WhatsApp › Aparelhos conectados › Conectar aparelho. "Status" deve mostrar `open`.
   Use um número exclusivo (não oficial: risco de bloqueio; o envio respeita 1 msg a cada 3–8 s).
2. **Z-API** – informe instanceId, token e Client-Token (Segurança › token da conta). No painel da Z-API, Webhooks › "Ao receber":
   cole a URL do webhook exibida (já contém `?token=`), e ative "notificar as enviadas por mim" para detectar o atendente humano.
3. **Chatwoot (WhatsApp Cloud API oficial)** – informe URL, account_id, inbox_id e o `api_access_token` de um agente-bot.
   Em Configurações › Integrações › Webhooks, cole a URL (com `?token=`) e marque "Mensagem criada". Se sua versão assina webhooks,
   informe o segredo HMAC (`X-Chatwoot-Signature`). A IA marca as mensagens com `​`; mensagens de agentes humanos pausam a IA.
   Fora da janela de 24 h, avisos de situação exigem template aprovado (não são enviados; ficam registrados como IGNORADA).
4. **E-mail** – crie o canal (e-mail de entrada = Reply-To). **Postmark** (principal): Servers › Inbound › Webhook URL = URL do canal
   (com `?token=`; também aceita Basic Auth com o segredo como senha). Mapeamento: `FromFull.Email/Name` → contato, `Subject` → conversa
   (remetente + assunto sem "Re:"), `StrippedTextReply`/`TextBody` (sem citação) → texto, `Attachments[]` (base64) → fotos,
   `MessageID` → dedup. **SendGrid Inbound Parse**: mesma URL (multipart: `from`, `subject`, `text`, `headers`, arquivos) – a rota
   converte para JSON. Respostas saem por `lib/email.ts` com assunto `Re: {assunto} [Atendimento #xxxxxxxx]`.
5. **Chat do site** – criado automaticamente por município na primeira conversa; desative em `/admin/canais` para mostrar só o formulário.

"Enviar mensagem de teste" valida credenciais sem criar conversa.

## Testes
* Unitários: `tests/unit/canais.test.ts` (normalização Evolution/Z-API/Chatwoot/Postmark/SendGrid, telefone, hash, idempotência) e
  `tests/unit/agente.test.ts` (transições, confirmação só em CONFIRMANDO, privacidade do protocolo, janela 24 h, anti-injeção).
* E2E: `tests/e2e/t13-chat-denuncia.spec.ts` – chat do site (modo determinístico) até o protocolo, aparece em Denúncias/Atendimento,
  acompanhamento público; webhook Evolution (401 sem segredo, dedup, resposta simulada, privacidade, atendente humano).
  Rode o servidor com `CANAIS_ENVIO_SIMULADO=true` e sem `OPENROUTER_API_KEY`.
