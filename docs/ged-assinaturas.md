# GED – Assinaturas e verificação pública

Frente D do módulo Gestão de Documentos (itens 8, 9, 10 e 12 do edital). Especificação: `docs/ged-design.md` §3. Código em
`lib/ged/assinaturas/`, telas em `/ged/assinaturas`, API em `/api/v1/ged/assinaturas`, página pública em `/verificar/{codigo}`,
job `jobs/ged-assinaturas.ts`.

## Fluxo

1. **Solicitar** (aba *Assinaturas* do documento ou `POST /api/v1/ged/assinaturas`). Exige a capacidade `solicitar_assinatura`
   (Admin, Gestor, Usuário), `VER` e (`EDITAR` **ou** `ADMINISTRAR`) no documento; o documento precisa estar RASCUNHO, PUBLICADO ou
   RECUSADO e ter a versão atual em PDF. Escolhe-se de 1 a 20 signatários entre os **membros ativos do mesmo cliente** (qualquer
   papel exceto Auditor, que não tem a ação ASSINAR), o modo **sequencial** (só o da vez fica PENDENTE; os demais AGUARDANDO) ou
   **paralelo** (todos PENDENTE), o prazo (padrão `GedConfig.assinatura_prazo_dias`, termina às 23:59 de Brasília) e uma
   mensagem opcional (vira o primeiro comentário, contexto `ASSINATURA`). O servidor relê o arquivo no storage, recalcula o
   SHA-256 e grava `sha256_alvo`; o documento vira EM_ASSINATURA. **Uma só solicitação ABERTA por documento** (o documento é
   travado na transação). O signatário recebe VER + ASSINAR pela regra 4 de `permissoes.ts` (sem ACL manual).
2. **Comentários** antes e durante: autor e signatários comentam enquanto a solicitação está aberta (tela de assinatura e aba).
3. **Assinar** (`/ged/assinaturas/{id}`): pré-visualização da versão exata, conversa, declaração de consentimento e **senha do
   próprio signatário** (re-autenticação; ver limites). Numa transação: trava a solicitação, confere que a linha do usuário está
   PENDENTE e é a sua vez, **relê o arquivo e recalcula o SHA-256 (aborta com 409 `INTEGRIDADE` se ≠ `sha256_alvo`)**, grava
   horário do servidor, IP, navegador, método `ELETRONICA_AVANCADA`, `reautenticacao='SENHA'`, `hash_documento` e `hash_cadeia`,
   libera o próximo (sequencial) e audita (`GED_ASSINATURA_ASSINADA`). Duas assinaturas simultâneas do mesmo usuário: só uma passa.
4. **Recusar**: justificativa de no mínimo 10 caracteres. Linha RECUSADO, solicitação RECUSADA (também no paralelo), documento
   RECUSADO, comentário `RECUSA`, trâmite `RECUSA`, autor notificado, auditoria. O autor pode abrir nova solicitação.
5. **Selar** (`selarDocumento`, após a última assinatura): estampa QR + código curto no rodapé de **todas** as páginas
   (respeitando rotação), anexa a **folha de assinaturas**, assina o PDF final com **PAdES** usando o certificado A1 do cliente
   (e-CNPJ, titular ORGAO, `municipio_id` nulo, ativo e válido) e cria a versão `SELO` (`selada`, derivada da assinada).
   Documento: ASSINADO, `sha256_final` (hash do arquivo selado), `codigo_verificador`. Sem certificado válido, selo "eletrônica
   avançada" com aviso visível na folha. Se existe certificado mas não abre (senha/DATA_KEY), o selo **não** é rebaixado em
   silêncio: a assinatura já feita fica registrada, a solicitação segue ABERTA com "selo pendente" e o job (ou o botão *Tentar
   selar novamente*) refaz. O selo é idempotente: o trabalho pesado ocorre fora de transação e a gravação é uma única transação
   que trava a solicitação; repetir ou concorrer nunca duplica a versão SELO.
6. **Cancelar**: autor da solicitação ou quem tem ADMINISTRAR. Editar o documento ou criar nova versão também cancela (gancho abaixo).
7. **Lembretes e expiração** (job horário, minuto 7): lembretes D-3/D-1/D0 (`GedConfig.lembrete_dias`) aos PENDENTES, entre 8h e 20h
   de Brasília, uma vez por limiar (`ultimo_lembrete_em` + compare-and-set); depois do prazo a solicitação vira EXPIRADA, os
   pendentes EXPIRADO, o documento volta a PUBLICADO e o autor é notificado. Também conclui selos pendentes.

## Evidências guardadas por assinatura

`assinado_em` (relógio do servidor, estritamente crescente dentro da solicitação), `ip`, `user_agent`, `metodo`, `reautenticacao`,
`hash_documento`, `hash_cadeia`, linha de auditoria (`LogAuditoria`, com hash do texto de consentimento) e comentários. Linhas
ASSINADO/RECUSADO e versões seladas são imutáveis (triggers do banco).

**Cadeia de hashes:** `hash_cadeia(i) = sha256(hash_cadeia(i-1) | assinante_id | usuario_id | hash_documento | assinado_em ISO | metodo)`,
com `sha256_alvo` no lugar de `hash_cadeia(0)`. A ordem é a cronológica. `verificarCadeia` (puro) recalcula tudo e aponta o elo
alterado; é usada no selo e na página pública.

## Verificação pública `/verificar/{codigo}`

Sem login, sem cache, limitada por IP (120 consultas e 15 "não encontrado" a cada 10 min por processo). Mostra cliente, número,
data de selagem, situação, signatários **com nome abreviado**, método e horário, cadeia de hashes e as conferências feitas na hora
pelo servidor (cadeia, arquivo selado × `sha256_final`, PAdES com `verificarAssinaturaPdf`). O **título só aparece se a
sensibilidade for PÚBLICO**; nunca há comentários, IP ou dados de outros documentos/clientes. Código desconhecido, malformado ou de
documento ainda não selado dá a mesma resposta genérica. O widget *Conferir arquivo* calcula o SHA-256 no navegador (WebCrypto, sem
upload) e compara com o hash do selado e do original; um byte alterado dá "FALHA".

Código: `XXXX-XXXX-XXXX` (`gerarCodigoVerificador`), único em `ged_documento` (todos os clientes) **e** `documento_oficial`.

## Verificar um PDF selado fora do sistema

- Hash: `sha256sum arquivo.pdf` deve igualar o "SHA-256 do arquivo selado" da página pública.
- QR/URL: o rodapé de cada página traz o QR para `{APP_URL}/verificar/{codigo}`.
- PAdES: abra no Adobe Acrobat Reader ou envie a <https://validar.iti.gov.br>. Com certificado de teste (sem ICP-Brasil) o
  validador do ITI acusará cadeia não confiável: esperado em demonstração.
- `openssl`: extraia o conteúdo de `/Contents` e os bytes do `/ByteRange` e use `openssl cms -verify -inform DER -binary -content bytes.bin -noverify`.

## Limites declarados (design §3)

- O horário de cada assinatura individual é o do **servidor**; não há carimbo do tempo RFC 3161.
- O selo é PAdES-B-B, **sem LTV** (sem OCSP/CRL embutidos).
- Não há assinatura ICP-Brasil **por signatário** (exigiria PAdES incremental; `pdf-lib` regrava o arquivo). Cada signatário assina
  com assinatura eletrônica avançada; o certificado é do **órgão** (e-CNPJ).
- **Re-autenticação = senha** do signatário. OTP por e-mail/WhatsApp ficou fora do escopo atual: as colunas `otp_hash`,
  `otp_expira_em` e `otp_tentativas` seguem **sem uso**; `reautenticacao` grava sempre `SENHA`. Senha errada: 5 tentativas por
  usuário/15 min (e 20 por IP), em memória por processo (como `lib/limite-login.ts`).
- Em ambiente de demonstração o certificado é de TESTE, sem valor legal.

## Notas jurídicas

- **Lei nº 14.063/2020, art. 4º, II**: assinatura eletrônica avançada (identifica o signatário, é vinculada ao documento, detecta
  alterações posteriores). Sua aceitação entre as partes depende da escolha do órgão; para atos que exijam assinatura qualificada
  use certificado ICP-Brasil do signatário (fora do escopo atual).
- **MP nº 2.200-2/2001**: o selo PAdES com certificado ICP-Brasil do órgão tem presunção de integridade/autoria do órgão (art. 10, §1º).
- Documento digitalizado (Decreto 10.278/2020): confirmar com a assessoria jurídica; este módulo não afirma equivalência.

## APIs e integrações para as demais frentes

| O quê | Onde |
|---|---|
| Cancelar solicitações abertas ao editar/versionar (**B/C devem chamar na mesma transação**) | `cancelarSolicitacoesAbertas(tx, ctx, documentoId, motivo)` em `lib/ged/assinaturas/cancelamento.ts` |
| Cancelar pela pessoa | `cancelarSolicitacao(ctx, { solicitacao_id, motivo? })` em `servico.ts` |
| Contador do menu | `contarAguardandoMinhaAssinatura(ctx)` em `consultas.ts` |
| Resolver código público | `resolverCodigoVerificador(codigo)` em `lib/ged/db.ts` |
| Job entre clientes | `solicitacoesAbertasEntreClientes()` em `lib/ged/db.ts` |
| Certificado do selo | `certificadoDoCliente(ctx)` em `selo.ts` (a tela de upload é da frente E) |

Evento de cancelamento: o contrato de notificações não tem `ASSINATURA_CANCELADA`; usa-se `ASSINATURA_EXPIRADA` com
`dados.cancelada = "1"` e `dados.motivo` (constante `EVENTO_CANCELAMENTO` em `ponte.ts`). Se a frente E criar o evento, troque a constante.

API: `GET/POST /assinaturas`, `GET /assinaturas/candidatos?q=`, `GET /assinaturas/{id}`, `POST /assinaturas/{id}/{assinar|recusar|cancelar|comentarios|selar}`
(todas com `rota()` + `ctxGedApi()`, erros `{code,message,details}`; 401 senha incorreta, 429 muitas tentativas, 409 fora da vez / arquivo alterado).

## Testes

- `tests/unit/ged-assinaturas.test.ts` (vitest, puro): cadeia (adulteração de cada campo), turno sequencial/paralelo, transições,
  prazo/lembretes (Brasília), código/URL/rodapé, folha HTML, validação, estampa QR em todas as páginas (inclusive rotacionadas).
- `tests/unit/ged-assinaturas.integracao.ts` (banco real + Chromium; **banco descartável**, instruções no cabeçalho do arquivo):
  fluxos paralelo/sequencial, recusa, cancelamento, expiração/lembretes, assinatura concorrente, arquivo adulterado, selo
  pendente e reconciliação, imutabilidade, verificação pública e isolamento entre clientes.
