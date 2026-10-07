# Painel do operador da plataforma (`/plataforma`)

Área **exclusiva do dono do SaaS** para cadastrar e gerir clientes (organizações/tenants) **sem script**: criar cliente, módulos, administrador inicial, suspender/reativar e redefinir a senha do administrador. Substitui, para o dia a dia, o `npm run onboard` (que continua funcionando e usa o mesmo serviço).

> Fonte da verdade do código: `lib/plataforma/*`, `app/(plataforma)/plataforma/*`, `scripts/plataforma/operador.ts`, migração `20261013120000_plataforma`. Testes: `tests/unit/plataforma*.test.ts`, E2E `tests/e2e/t28-plataforma.spec.ts`.

## 1. Quem é o operador

Operador = **linha ativa em `operador_plataforma`** ligada a um `Usuario` que **não tem** organização, papéis, cadastro de pessoa nem participação no GED. A linha só é criada por:

| Forma | Como |
| --- | --- |
| CLI | `npm run plataforma:operador -- <email> [--nome "Nome"]` (cria o usuário com senha temporária de 16 caracteres impressa **uma vez**, troca obrigatória; ou promove um usuário **existente elegível**). `--desativar`, `--listar`. |
| Bootstrap por ambiente | `PLATAFORMA_OPERADORES=dono@empresa.com,outro@empresa.com` — o `scripts/predeploy.sh` executa `plataforma:operador -- --env` (idempotente). `PLATAFORMA_OPERADOR_SENHA` fixa a senha inicial dos usuários novos. |

**Nenhuma tela, API ou Server Action de cliente grava `operador_plataforma`** (varredura em `tests/unit/plataforma-fontes.test.ts`; `operador.ts` só atualiza `ultimo_acesso`).

### Por que uma tabela própria (e não um papel)

- `usuario.organizacao_id = NULL` significa **requerente global** em todo o sistema. Um "papel PLATAFORMA" em `Papel`/`UsuarioPapel` herdaria ambiguidade: seria um usuário sem organização com papel, e qualquer código que presuma "sem organização = requerente" (ou que liste papéis para o admin do cliente atribuir) o trataria errado. Um **enum de papel também apareceria** nas telas de administração de usuários dos clientes.
- Tabela separada ⇒ o admin de um cliente **não tem como** atribuir/ver/virar operador: `/admin/usuarios` nunca lista o operador (sem organização e sem pessoa), `criarUsuario` recusa e-mail existente e não existe campo "operador" em nenhum formulário.
- **Defesa em profundidade no banco** (migração): trigger em `operador_plataforma` recusa quem tem organização/papel/pessoa; triggers em `usuario` e `usuario_papel` recusam dar organização, pessoa ou papel a quem já é operador. O onboarding (CLI e painel) também recusa e-mail de operador (`recusarOperador`).
- **Elegibilidade reconferida a cada requisição** (`obterOperador`): linha ativa + usuário ativo + sem organização/papéis/pessoa/GED. Se algo mudar, o acesso cai na hora.

## 2. Modelo de ameaça

| Ameaça | Mitigação |
| --- | --- |
| Admin de cliente (ou qualquer interno) tenta abrir `/plataforma` ou chamar as ações | **404** (`notFound()`), indistinguível de rota inexistente: em layout, **toda página** e **toda Server Action** (`exigirOperador`/`operadorDaPagina`/`exigirOperadorAcao`). Teste E2E reproduz a Server Action de outro usuário e exige 404 sem efeito. Varredura de fontes garante o guarda em cada `page.tsx`/`layout.tsx`/ação. |
| Requerente (organização NULL) confundido com operador | Operador exige linha em `operador_plataforma`; requerente nunca a tem. Sem papéis ⇒ nada de negócio. |
| Admin de cliente vira operador | Só CLI/env criam a linha; CLI recusa quem tem organização/papéis/pessoa/GED; triggers do banco; cliente não tem tela para isso. |
| Sessão roubada (cookie `lg_access`) | **Reautenticação por senha** para abrir qualquer tela do painel: cookie próprio `lg_plat` (JWT HS256 com segredo derivado, `typ=plataforma`, `sub` = operador, **15 min**, `HttpOnly`, `Secure`, `SameSite=Strict`, `path=/plataforma`). Token Bearer de API **não** vale em `/plataforma` (só cookies). Não existe OTP/2FA no projeto hoje (veja pendências). |
| Força bruta da reautenticação | Falhas por IP (10/15 min) e por operador (5/15 min), mais o bloqueio normal da conta no login. Auditado (`PLATAFORMA_REAUTH_FALHA`, `..._BLOQUEADA`). |
| Abuso por operador comprometido | Limite de 60 ações/5 min por operador; trilha completa (abaixo); suspensão exige **confirmação digitada** da sigla e motivo; não existe exclusão de cliente. |
| Operador xeretando dados dos clientes | O painel e o serviço **não importam** módulos de negócio (varredura de fontes proíbe `lib/processo|documentos|ged|cadastros|...`). Mostra só: nome, sigla, CNPJ, slug, módulos, status, datas, **contagens** (usuários, órgãos, processos, documentos GED) e a lista de usuários (nome, e-mail, papéis, último acesso). Nunca processos, documentos, protocolos, pessoas, senhas ou CPF. |
| Cliente enxergando o operador | Ações do operador têm ator fora da organização e `acao` `PLATAFORMA_*`: não aparecem em `/admin/auditoria` (filtrada por usuários da organização) e são excluídas da exportação do cliente (`filtroTabela`). |
| Segredos em log | Senha temporária e link do convite aparecem **uma vez** na resposta da ação (não são gravados em claro; a auditoria guarda só e-mail/entrega). O convite guarda apenas o **SHA-256** do token. Teste E2E confere que nenhuma senha/token aparece na trilha. |
| Token de convite vazado | 256 bits aleatórios, uso único (consumo atômico), validade 72 h, convites anteriores do usuário invalidados, formato validado antes do banco, limite por IP nas tentativas inválidas. O e-mail do convite fica em `email_enviado` (como todo e-mail do sistema) – o link só vale uma vez. |
| Quebra de isolamento ao criar cliente | Criação **tudo-ou-nada** (`prisma.$transaction`) com o mesmo `onboarding()` da CLI; recusa sigla/slug/IBGE/e-mail já existentes (nunca "adota" cadastro de outro cliente). |

### Auditoria

Toda escrita do painel chama `auditarPlataforma(...)` → `log_auditoria` (imutável) com `usuario_id` = operador, **`organizacao_id` = cliente-alvo**, `entidade`, `antes`/`depois`, IP e user-agent. Ações: `PLATAFORMA_CLIENTE_CRIADO`, `_CLIENTE_EDITADO`, `_MODULOS_ALTERADOS`, `_MUNICIPIO_ADICIONADO`, `_CLIENTE_SUSPENSO`, `_CLIENTE_REATIVADO`, `_SENHA_ADMIN_REDEFINIDA`, `_CONVITE_ENVIADO`, mais `_REAUTH`, `_REAUTH_FALHA`, `_REAUTH_BLOQUEADA`, `_ACESSO_NEGADO` (usuário logado que não é operador tentou entrar) e, na CLI, `PLATAFORMA_OPERADOR_CRIADO/PROMOVIDO/DESATIVADO`. O onboarding registra `ONBOARDING` com o operador como autor.

## 3. Funcionalidades

- **Clientes** (`/plataforma`): nome, sigla, módulos, situação (Ativo/Suspenso), nº de usuários, criado em.
- **Novo cliente** (`/plataforma/novo`): nome, sigla única (2–20: A–Z, 0–9, hífen), CNPJ opcional, **endereço público (slug)** único e validado (3–60, minúsculas/números/hífen; reservados: `admin`, `api`, `ged`, `login`, `plataforma`, `protocolo`, `compartilhado`, `definir-senha`… – `SLUGS_RESERVADOS` em `lib/plataforma/regras.ts`), módulos `LICENCIAMENTO` e/ou `GED`.
  - **Licenciamento**: órgãos/municípios iniciais (nome, UF, código IBGE de 7 dígitos; a sigla de 3 letras é derivada e única) + catálogo-base (tipos de ato, documentos, tipologias, checklist, prazos, feriados) + administrador com papel `ADMIN`.
  - **GED**: `GedConfig` (cota padrão 10 GB, editável no formulário; limites de OCR/protocolo/compartilhamento = padrões do schema; portal de protocolo **desligado**; sem canal de WhatsApp), setores `ADM`/`PROT`/`JUR`, 10 tipos de documento comuns, administrador como `GED_ADMIN` (chefe do setor ADM). O WhatsApp do administrador (opcional) é guardado **cifrado** em `GedMembro.telefone_cifrado` **sem** opt-in: o consentimento para mensagens continua sendo o do próprio usuário.
- **Administrador inicial**: nome, e-mail, WhatsApp opcional. Entrega do acesso: **senha temporária** forte (16 caracteres), exibida **uma vez**, troca obrigatória no primeiro acesso (`/trocar-senha`, fluxo existente); e/ou **convite por e-mail** (`/definir-senha/{token}`, uso único, 72 h; usa `lib/email` → SMTP ou caixa de teste `/admin/emails`).
- **Editar cliente**: nome, CNPJ, slug (mudar o slug quebra links já divulgados).
- **Módulos**: ativar/desativar. **Desativar não apaga dados**, só bloqueia: a sessão perde os papéis de licenciamento (`montarSessao`), o GED responde 403 (`ctxGedDeUsuario`), portais públicos de licenciamento/GED respondem 404. Ativar o GED num cliente existente cria config/setores/tipos padrão e dá `GED_ADMIN` aos admins; ativar o licenciamento aplica o catálogo-base (cadastre órgãos em "Órgãos/municípios").
- **Suspender / reativar**: ver §4. Exige motivo e a sigla digitada. **Não há exclusão** (§5).
- **Usuários do cliente**: nome, e-mail, papéis, último acesso, situação; **redefinir a senha do administrador** (senha temporária e/ou convite). Senhas existentes nunca são exibidas.

## 4. Suspensão: todos os pontos de entrada

`status = SUSPENSO` (`organizacao.status/suspensa_em/suspensa_motivo`). Dados preservados. Pontos cobertos (e testados no E2E t28 quando marcado ★):

| Entrada | Comportamento |
| --- | --- |
| Sessão ativa (cookie, refresh, Bearer, `getUsuario`, `exigirUsuario`, GED `ctxGed*`, jobs por usuário) | `sessaoPorId` devolve `null` para usuário de organização suspensa ⇒ cai no login ★ |
| Login (`autenticar`, UI e `/api/v1/auth/login`) | Recusado com a mensagem de suspensão **só depois da senha correta** ★ |
| Tokens de API | São os mesmos JWT de sessão ⇒ 401 ★ |
| Lista/resolução de órgãos (`listarOrgaos`, `resolverOrgao`, `getOrgaoAtivo`) | Órgãos do cliente somem |
| Portal público do órgão `/orgao/{sigla}`, home, serviços, denúncia (página, API pública, chat do site, acompanhamento) | 404 / "município inválido" ★ |
| Consulta de processo, validação/lista de licenças e PDFs públicos (`lib/documentos/publico.ts`, `podeBaixarDocumento`) | "não encontrado" |
| Requerente movimentando processo ou criando rascunho no município do cliente | `transicionar`/`salvarRascunho` recusam |
| Portal de protocolo `/protocolo/{slug}`, verificação de comprovante/assinatura (`/verificar/…`), link de compartilhamento `/compartilhado/{token}` | 404 (`resolverSlugPortal`, `resolverCodigoVerificacaoProtocolo`, `resolverCodigoVerificador`, `resolverTokenCompartilhamento` filtram `ORG_GED_ATIVA`) ★ |
| Canais de WhatsApp/e-mail/chat (`carregarCanal`, webhook `/api/webhooks/{canal}`, processamento de eventos) | Canal "inexistente" ⇒ 404 / evento ignorado; nenhuma mensagem enviada |
| Webhook de pagamento (Asaas) | Responde 200 e ignora ("cliente suspenso"); a sincronização de cobranças pula o cliente |
| Jobs: alertas/prazos (`gerarAlertas` do worker), monitoramento por satélite, cobrança, GED (notificações, assinaturas, texto/OCR, importação, retenção) | Varrem só organizações ativas (`ORG_ATIVA`, `ORG_GED_ATIVA`, `whereMun` do motor de alertas) |

Reativar volta tudo ao normal (sessões novas; tokens antigos de 15 min já expiraram).

> Itens que **não** fazem varredura entre clientes (ex.: `jobs/ged-compartilhamento.ts`, `lib/ged/compartilhamento/manutencao.ts`) herdam a regra quando usam `organizacoesGedAtivas()`/`gedDb`; veja "Pendências" no relatório da entrega.

## 5. Remoção definitiva (procedimento manual)

O painel **não exclui clientes** (só suspende). A remoção definitiva é um procedimento **manual, fora da aplicação**:

1. Exporte/arquive o que o cliente precisar (`/admin/exportar` do cliente) e faça **backup do banco e do storage** (`docs/backup.md`).
2. Suspenda o cliente no painel.
3. Limpe o conteúdo do GED com a ferramenta existente: `npm run ged:limpar -- <SIGLA>` (dry-run) e `--executar --confirmar=<SIGLA>` (`docs/ged.md` §15, `scripts/ged/limpar-organizacao.ts`).
4. Dados de licenciamento: sem ferramenta automática; remoção por SQL assistido **após** o backup (tabelas imutáveis `tramitacao`/`log_auditoria` têm trigger – **não** desligar trigger; a auditoria deve ser preservada).

## 6. Operação

- Virar operador em produção: ver `deploy/railway.md` §3 (`PLATAFORMA_OPERADORES` ou CLI).
- Entrar: `/login` (campo "Órgão" vazio) → vai para `/plataforma` → confirmar a senha. Quem digitar `/plataforma` sem ser operador vê 404. O link discreto "Plataforma" só aparece, para o operador, no cabeçalho da área do requerente.
- Esqueceu a senha do operador: `npm run plataforma:operador -- <email> --redefinir-senha` (nova senha temporária, impressa uma vez; troca obrigatória). Para retirar um operador: `--desativar`.
- `npm run plataforma:operador -- --listar` mostra operadores e último login.

## 7. Banco e exportação

Migração `20261013120000_plataforma`: enum `StatusOrganizacao`; colunas `organizacao.status/suspensa_em/suspensa_motivo`; tabelas `operador_plataforma` e `convite_senha`; triggers acima. Regras em `lib/export`: `OperadorPlataforma` nunca exportada; `ConviteSenha` só dos usuários do cliente e sem `token_hash`; `LogAuditoria` exclui `PLATAFORMA_*`.
