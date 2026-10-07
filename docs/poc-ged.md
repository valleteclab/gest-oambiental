# Roteiro da demonstração (PoC) – Gestão de Documentos

Roteiro dos **13 itens** do Anexo VII (design §8, `docs/ged-design.md`) com os logins e cliques da massa de demonstração `npm run seed:ged-demo`. Visão geral e arquitetura: [`docs/ged.md`](ged.md). Todos os dados são **fictícios**.

- Rótulos de botões e abas das telas das outras frentes: **conforme entregue** – ensaie o roteiro uma vez antes e ajuste os nomes se a tela mudou.
- Senha de todos os usuários: `Demo@2026licencia`. Entrar em `/login` **deixando o campo "Órgão" em branco**; o sistema leva para `/ged`.
- Use **duas janelas/perfis de navegador** (uma por usuário) para os itens 3, 8 e 12.

## 0. Antes do dia da apresentação (preparação)

| # | Preparação | Como |
|---|---|---|
| 1 | Massa de demonstração carregada | `npm run seed:ged-demo` (Railway: `SEED_GED_DEMO=true`). Idempotente; rodar de novo não duplica. Conferir 13 documentos em VAC e 6 em AAC |
| 2 | Chromium para PDFs | `CHROMIUM_PATH` definido no serviço (item 2: "Finalizar" do editor gera PDF) |
| 3 | Worker no ar | `npm run jobs` (extração de texto, notificações, lembretes). Sem worker: `GED_TEXTO_INLINE=true` e o e-mail/WhatsApp do item 5/6 só sai pelo envio imediato |
| 4 | E-mail (item 5) | `SMTP_URL` apontando para caixa de teste (Mailpit/Mailtrap) ou SMTP real; abrir a caixa em outra aba. `APP_URL` correto (link da mensagem) |
| 5 | WhatsApp (item 6) | **Com número pareado:** em `/ged/admin` configurar o canal (provedor Evolution/Z-API), parear o aparelho (QR), cadastrar o telefone do destinatário em `/ged/minha-conta/notificacoes` e confirmar o código de opt-in. **Plano B:** deixar o canal em **modo simulado** – a comunicação aparece como `SIMULADA` em `/ged/logs` → Comunicações |
| 6 | Certificado A1 do órgão (item 12) | Em `/ged/admin` (certificado) enviar o e-CNPJ A1 (`.pfx` + senha) do órgão, ou, só para ensaio, rodar `npm run seed:certificado-demo` (certificado de **TESTE**, sem valor legal). Sem certificado o PDF sai com aviso de "assinatura eletrônica avançada" |
| 7 | HTTPS (item 13) | Ambiente público com HTTPS e HSTS; conferir cabeçalhos com `curl -sI https://<host>/ged` |
| 8 | Backup/replicação | `BACKUP_S3_*` configurado (outro provedor) e uma execução manual de `storage-replicar` (ver `docs/backup.md` §4) |
| 9 | Navegadores | Testar Chrome, Edge, Firefox e Safari/mobile em 320 px |

## 1. Logins da demonstração

| Cliente | Usuário | Papel | Uso na demonstração |
|---|---|---|---|
| **VAC** – Câmara Municipal de Vale das Acácias (DEMO) | `admin.vac@gestaodocumentos.demo` | Administrador | itens 3, 13 (membros, setores, ACL) |
| | `gestor.vac@gestaodocumentos.demo` | Gestor | itens 3, 5, 7, 12 (2º signatário) |
| | `servidor1.vac@gestaodocumentos.demo` | Usuário | itens 1, 2, 4, 5, 7, 8, 9 |
| | `servidor2.vac@gestaodocumentos.demo` | Usuário | itens 3, 7 (recebe o trâmite) |
| | `vereador.vac@gestaodocumentos.demo` | Leitor (signatário) | itens 3, 8, 10, 12 (1º signatário) |
| | `auditor.vac@gestaodocumentos.demo` | Auditor | itens 3, 11 |
| **AAC** – Autarquia de Águas do Cerrado (DEMO) | `admin.aac@`, `gestor.aac@`, `servidor.aac@gestaodocumentos.demo` | Admin / Gestor / Usuário | item 13 (isolamento) |

## 2. Roteiro

| Item | O que mostrar | Login | Passo a passo | Resultado esperado | Plano B / observação |
|---|---|---|---|---|---|
| **1** Localizar documentos por título, data, remetente e **conteúdo** | Filtros avançados e busca dentro do PDF | `servidor1.vac` | 1) Menu **Documentos** (`/ged/documentos`). 2) Campo **Título**: `Contrato` → lista com Contrato 001/2026 e Termo Aditivo. 3) Limpar; **Remetente**: `Luminar` → contrato, empenho e nota fiscal. 4) Intervalo de datas dos últimos 10 dias. 5) Limpar; em **Buscar no conteúdo dos arquivos** digitar `iluminação pública` → **Buscar** | Documentos cujo **texto interno** contém a expressão (Contrato 001/2026, Empenho 045/2026, Nota fiscal 1021, Parecer 07/2026) com **trecho destacado**. Repetir com `aquisição de medicamentos` (Edital e Ata do Pregão 03/2026) | Palavra que só existe no PDF (não no título) prova a busca por conteúdo. O PDF digitalizado "Ofício recebido nº 0045" aparece como **Sem texto** (OCR é fase 2) |
| **2** Criar documento no editor e enviar PDF | Editor de texto → PDF; upload | `servidor1.vac` | **Editor:** **Documentos → Novo → Criar no editor** (`/ged/editor/novo`), título `Ofício 20/2026`, tipo Ofício, pasta Controle interno/Relatórios, escrever um parágrafo, **Finalizar** (gera o PDF com cabeçalho do órgão). Abrir o rascunho existente "Minuta de Ofício 15/2026" para mostrar a edição. **Upload:** **Novo → Enviar PDF** (`/ged/documentos/novo`), arrastar `tests/fixtures/documento-exemplo.pdf` | Documentos com número `VAC-DOC-2026-…`, versão 1, pré-visualização do PDF; o texto aparece na busca em poucos segundos (job de extração) | Limite de 25 MB e só PDF. Sem Chromium, "Finalizar" falha: ver preparação 2 |
| **3** Permissões: Ver / Editar / Assinar por usuário, herança de pasta e sigilo | ACL por usuário e por setor; documento sigiloso | `admin.vac` → `servidor2.vac` / `vereador.vac` / `auditor.vac` | 1) `admin.vac`: **Pastas** → Documentação da licitação → painel de **Permissões**: mostrar o setor **Licitações** (Ver/Editar/Tramitar) e, em **Editais**, o usuário `vereador` (**só Ver**). 2) Abrir **Contrato 001/2026 → aba Permissões** e conceder `servidor2` = **Ver** (já existe) e depois **Editar**. 3) Entrar como `servidor2.vac`: abrir o Contrato (vê), tentar editar/assinar (botão ausente ou 403). 4) Entrar como `vereador.vac`: só vê o Edital (por ACL da pasta) e os documentos em que é signatário. 5) **Sigilo:** em **Pessoal**, o *Processo Administrativo Disciplinar 003/2026* (SIGILOSO): `admin.vac` abre `/ged/documentos/<id>` → **não encontrado** (administrador não vê sigiloso sem ACL); `servidor2.vac` e `auditor.vac` veem (ACL explícita; a de `servidor2` expira em 30 dias) | Matriz clara: cada login enxerga só o que lhe foi concedido; pasta **Pessoal** não herda permissão | Pode-se demonstrar a herança concedendo uma ACL nova em "Documentação da licitação" e abrindo um documento de **Editais** como o beneficiado |
| **4** Marcadores (etiquetas) com cor | Criar, aplicar e filtrar | `servidor1.vac` (criar: `gestor.vac`) | 1) `gestor.vac`: **Administração → Marcadores** → novo marcador `Auditoria 2026`, cor `#f59e0b`. 2) Abrir um documento → **Marcadores** → aplicar `Urgente` e `Auditoria 2026`. 3) Em **Documentos**, filtro **Marcador = Urgente** | Lista só com os documentos marcados, chips coloridos; Ofício 12/2026 e Termo Aditivo 001/2026 já vêm com `Urgente` | — |
| **5** Notificação por **e-mail** com data e hora do envio | Trâmite dispara e-mail | `servidor1.vac` → caixa de e-mail do destinatário | 1) Abrir **Minuta de Ofício 15/2026** (ou um documento novo) → **Tramitar → Enviar** para o usuário `servidor2` com despacho "Para conferência". 2) Abrir a caixa de teste (Mailpit/SMTP) e ler a mensagem. 3) Em `/ged/logs` → aba **Comunicações** (`auditor.vac`/`admin.vac`) mostrar a linha | Mensagem com texto "**Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)**", link para o documento e **sem anexo** (título omitido se SIGILOSO). Log com canal, destinatário mascarado, status `ENVIADA` e hora real | Sem SMTP: mostrar apenas o log (`SIMULADA`/`ERRO`) e os exemplos já semeados (Comunicações de VAC) |
| **6** Notificação por **WhatsApp** | Mesmo evento por WhatsApp | `servidor1.vac` | Repetir o item 5 com o destinatário que tem telefone confirmado (opt-in) | Mensagem no aparelho pareado; log `ENVIADA` canal WhatsApp | **Modo simulado:** o log mostra `SIMULADA` (o semeado "ASSINATURA_SOLICITADA/WHATSAPP" também). Canal oficial fora da janela de 24 h → `IGNORADA` |
| **7** Tramitação entre setores, despacho, ciência e devolução | Linha do tempo imutável | `servidor1.vac` → `gestor.vac` → `servidor2.vac` | 1) Abrir **Ofício 12/2026 → aba Trâmite** (histórico já semeado: ENVIO Protocolo→Licitações, DESPACHO ao Financeiro, CIENCIA). 2) Como `servidor2.vac`: **Trâmite** (`/ged/tramite`, caixa de entrada) → abrir o Ofício → **Dar ciência** → **Devolver** ao Protocolo com despacho. 3) Como `gestor.vac`: **Enviar a um setor** (Licitações) com prazo | Linha do tempo cronológica com quem/quando/para quem e despacho; nada pode ser editado ou apagado (tentar não é possível – trigger no banco) | — |
| **8** Painel de assinaturas com status por signatário | `/ged/assinaturas` | `gestor.vac`, `vereador.vac`, `servidor1.vac` | 1) `servidor1.vac` → **Assinaturas** → aba **Enviadas por mim**: Contrato 001/2026 (em andamento), Termo Aditivo 001/2026, Parecer 07/2026 (recusada). 2) Abrir o Contrato: signatários em ordem (**1º Gestor – Pendente**, **2º Vereador – Aguardando a vez**), prazo, mensagem. 3) `gestor.vac` → aba **Aguardando minha assinatura**. 4) `vereador.vac` → vê o Termo Aditivo na vez dele | Cada documento com status por signatário (Pendente/Aguardando/Assinado/Recusado), modo sequencial respeitado | Abas: Aguardando minha assinatura · Enviadas por mim · Concluídas · Recusadas |
| **9** Comentários antes e durante a assinatura | Comentários no documento e na solicitação | `servidor1.vac`, `gestor.vac` | Abrir **Contrato 001/2026 → aba Comentários**: 3 comentários semeados (geral e de assinatura). Adicionar um novo como `gestor.vac` | Comentários cronológicos com autor, hora e contexto (GERAL/ASSINATURA); imutáveis | — |
| **10** Recusa com justificativa e registro | Assinatura recusada | `vereador.vac` (ao vivo) / `servidor1.vac` (resultado) | **Resultado pronto:** `servidor1.vac` abre **Parecer 07/2026** (status **Recusado**) → aba **Assinaturas** (justificativa do vereador) e **Trâmite** (RECUSA). **Ao vivo (opcional):** `vereador.vac` abre o **Termo Aditivo 001/2026 → Recusar**, justificativa ≥ 10 caracteres | Status `Recusado`, justificativa visível ao autor, registro no histórico e no log de auditoria; solicitação encerrada | **Não recuse o Termo Aditivo se for assiná-lo no item 12** – use o Parecer 07/2026 (já recusado) ou crie outra solicitação |
| **11** Logs de acesso, alteração e comunicação | `/ged/logs` | `auditor.vac` (ou `admin.vac`) | **Logs**: aba **Acessos** (visualizações, downloads, buscas, acessos negados – ex.: `admin.vac` **NEGADO** ao Processo Administrativo Disciplinar), aba **Alterações** (criação de documentos, ACL, assinaturas), aba **Comunicações** (e-mail/WhatsApp com status). Filtrar por documento e período | Quem, quando, o quê, IP; e-mails e WhatsApp com data/hora real do envio | O auditor lê logs mas não o conteúdo dos documentos (só por ACL) |
| **12** PDF **selado** com QR em cada página; verificação pública | Assinar ao vivo e verificar | `vereador.vac` → `gestor.vac` | 1) `vereador.vac` abre **Termo Aditivo 001/2026 → Assinar** (reautenticação por senha ou código por e-mail/WhatsApp). 2) `gestor.vac` assina em seguida (2º, sequencial). 3) O sistema gera a **folha de assinaturas** e o **selo PAdES do órgão**; baixar o PDF: **QR Code no rodapé de cada página**. 4) Ler o QR (celular) → `/verificar/<código>` (sem login): órgão, nº, data do selo, signatários, cadeia de hashes. 5) Na página, escolher o PDF baixado: o navegador calcula o SHA-256 e confirma **íntegro**. 6) Alterar **um byte** do PDF (ex.: editor hexadecimal) e escolher de novo → **falha**. 7) Opcional: validar o PDF em validar.iti.gov.br | Documento `Assinado`, versão selada (imutável), código verificador, falha de verificação ao adulterar | **Pendente (Parte 2):** o documento **já assinado e selado** pré-semeado (`criarDocumentoAssinadoDemo`) depende do serviço de assinaturas; enquanto isso, assine o Termo Aditivo ao vivo. Sem certificado A1 do órgão: o selo sai como "assinatura eletrônica avançada" com aviso visível; com `seed:certificado-demo` o certificado é de **teste** |
| **13** Segurança, isolamento, certificado A1, LGPD, navegadores | Checklist técnico | `admin.vac`, `admin.aac` | **HTTPS/HSTS e cabeçalhos:** `curl -sI https://<host>/ged` (HSTS, `X-Content-Type-Options`, `X-Frame-Options`/CSP). **Isolamento:** em duas janelas, `servidor1.vac` e `servidor.aac` abrem "Contrato 001/2026" e "Ofício 12/2026" (**mesmos títulos, conteúdos diferentes**); `servidor.aac` busca `iluminação pública` → **nada**; colar na URL de AAC o ID de um documento de VAC → **404**. Mostrar o spec `tests/e2e/t16-ged-isolamento.spec.ts` verde. **Certificado A1:** `/ged/admin` (certificado do órgão). **LGPD:** Ata da Sessão 018/2026 marcada **contém dados pessoais**, sensibilidade Restrito, anonimização **pendente** (não pode ser pública); sigilo; logs; operador × controlador. **Navegadores:** Chrome, Edge, Firefox, Safari e celular 320 px | Evidências: cabeçalhos, 404 entre clientes, busca sem vazamento, política LGPD | Para o ID entre clientes: `E2E_GED_IDS=1 npm run seed:ged-demo` grava `tests/e2e/.ged-ids.json` com os IDs de VAC |

## 3. Planos de contingência (resumo)

| Falha | O que fazer |
|---|---|
| SMTP indisponível | Mostrar o log de Comunicações (linha `ERRO` semeada e a mensagem de erro) e a caixa de teste; reenvio pelo job `ged-notificar` quando voltar |
| WhatsApp sem pareamento/banido | Modo **simulado** (`SIMULADA`) + log; mostrar o registro `ASSINATURA_SOLICITADA/WHATSAPP` semeado |
| Sem Chromium (editor/PDF) | Usar upload de PDF (item 2) e os documentos semeados; corrigir `CHROMIUM_PATH` |
| Worker parado | `GED_TEXTO_INLINE=true` para a busca (item 1); notificações ficam `PENDENTE` até o worker voltar |
| Sem certificado A1 | `npm run seed:certificado-demo` (teste) ou mostrar a verificação com assinatura eletrônica avançada |
| Seed alterado durante a demonstração | O seed é idempotente por título: documentos já existentes **não** são restaurados. Para voltar ao estado inicial, use um banco novo (documentos assinados/recusados não podem ser apagados – imutáveis) |

## 4. Lista de verificação do ensaio (conforme entregue)

- [ ] `/ged/documentos` com filtros **Título / Remetente / datas / Marcador / Buscar no conteúdo** e trechos destacados.
- [ ] Editor: **Finalizar** gera PDF; upload de PDF aceita 25 MB.
- [ ] Painel de permissões em pasta e documento (usuário e setor); documento SIGILOSO não aparece para o administrador sem ACL.
- [ ] Aba **Trâmite** com ENVIO/DESPACHO/CIENCIA/DEVOLUCAO; `/ged/tramite` (caixa).
- [ ] `/ged/assinaturas` (4 abas), `/ged/assinaturas/[id]` (por signatário), recusa com justificativa.
- [ ] `/ged/logs` (Acessos / Alterações / Comunicações) para Auditor e Admin.
- [ ] Selagem: PDF com QR em cada página; `/verificar/<código>` e comparação do SHA-256 no navegador.
- [ ] Notificações por e-mail (data/hora de Brasília) e WhatsApp (ou simulado).
- [ ] Certificado A1 do órgão cadastrado em `/ged/admin`.
- [ ] `t16-ged-isolamento.spec.ts` verde contra o ambiente da demonstração.
