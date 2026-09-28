# Ambiente da PoC – CDS Piemonte do Paraguaçu (Pregão SRP 005/2026)

O Formulário de Avaliação da PoC (SPEC §13) usa o consórcio **real** e seus 8 municípios. Por isso existe um
conjunto de dados próprio, **carregado somente no ambiente da PoC** – nunca na demonstração pública, que continua
com o consórcio fictício `CID-DEMO` (regra do `CLAUDE.md`).

| | Demonstração pública | Ambiente da PoC |
|---|---|---|
| Organização | Consórcio Intermunicipal de Demonstração (`CID-DEMO`, fictício) | Consórcio de Desenvolvimento Sustentável do Piemonte do Paraguaçu (`CDS-PIEMONTE`) |
| Municípios | 6 fictícios (IBGE `99…`) | 8 reais: IAC, IBQ, ITB, ITT, MNV, RJB, RUY, TPM |
| Carga | `SEED_DEMO=true` (`seed:base` + `seed:demo`) | `SEED_CDS_POC=true` (onboarding `cds-piemonte --demo` + `seed:cds-poc`) |
| `DEMO_MODE` | `true` (faixa "Ambiente de demonstração") | **`false`** – a PoC deve parecer produção |
| E2E | `npm run test:e2e` (`E2E_DATASET=demo`) | `npm run test:e2e:poc-cds` (`E2E_DATASET=poc-cds`) |
| Banco / bucket | próprios | **próprios** (nunca compartilhar com a demo) |

**Isolamento entre os ambientes.** Os dois conjuntos ficam em bancos separados (ambientes/projetos distintos). A landing
(`app/(publico)/page.tsx`) lista os órgãos ativos da base: no ambiente da PoC aparecem os 8 municípios do CDS (esperado);
na demonstração pública o CDS não existe, então nunca aparece. Salvaguardas no código:

- `seed:cds-poc` **aborta** com `DEMO_MODE=true` ou se a organização `CID-DEMO` existir na base (a flag `--forcar` só serve para teste local consciente);
- `scripts/predeploy.sh` **aborta** se `SEED_CDS_POC=true` vier junto com `DEMO_MODE=true` ou `SEED_DEMO=true`;
- no ambiente da demonstração pública, **nunca** defina `SEED_CDS_POC` nem inclua `cds-piemonte` em `SEED_ONBOARDING`.

## 1. Dados carregados

**`prisma/seed/clientes/cds-piemonte.json`** (onboarding, `npm run onboard -- cds-piemonte --demo`): organização, 8
municípios/órgãos ("Secretaria Municipal de Meio Ambiente de X", brasão genérico, endereço/e-mail/telefone **nulos**
até o consórcio informar – editar em `/admin/municipios`), catálogo-base e 13 usuários internos:

| Papel | E-mail (`@poc.licenciagov.app`) |
|---|---|
| Admin | `admin.cds@` |
| Técnicos do consórcio | `tec.consorcio1@`, `tec.consorcio2@` |
| Itaberaba / Ruy Barbosa / Iaçu | `tecnico.itb@`, `gestor.itb@`, `fiscal.itb@` (idem `.ruy`, `.iac`) |
| SEMA/INEMA (somente leitura) | `sema@` |

Códigos IBGE conferidos na API de localidades do IBGE; coordenadas = sede municipal, conferidas **dentro da malha
municipal oficial** (`api/v3/malhas/municipios/{id}`):

| Sigla | Município | IBGE | Lat | Lng |
|---|---|---|---|---|
| IAC | Iaçu | 2911907 | −12,7666 | −40,2056 |
| IBQ | Ibiquera | 2912608 | −12,6444 | −40,9338 |
| ITB | Itaberaba | 2914703 | −12,5242 | −40,3059 |
| ITT | Itatim | 2916856 | −12,7099 | −39,6952 |
| MNV | Mundo Novo | 2922102 | −11,8541 | −40,4714 |
| RJB | Rafael Jambeiro | 2925956 | −12,4053 | −39,5007 |
| RUY | Ruy Barbosa | 2927200 | −12,2816 | −40,4931 |
| TPM | Tapiramutá | 2931301 | −11,8475 | −40,7927 |

**`prisma/seed/clientes/cds-poc-demo.ts`** (`npm run seed:cds-poc`, idempotente pelo marcador "Posto Estrela – Ruy
Barbosa"; ~30 s): 5 requerentes com login (`laticinio@`, `posto@`, `joao@`, `maria@`, `ceramica@`), 25 empreendimentos,
44 processos em todos os status, 15 licenças (3 vencendo), 10 denúncias, 8 vistorias com fotos, 4 autos e 5
notificações com PDF, alertas e e-mails. **Tudo fictício** exceto os municípios: empresas, pessoas, CPF/CNPJ (dígitos
verificadores válidos, gerados), RTs/registros em conselho, CAR (sufixo hexadecimal derivado do nome) e coordenadas
(a poucos km da sede, conferidas dentro da malha do IBGE). Sem telefones/endereços reais. **Não cria registros de
backup** – o T10 usa backup real (`/admin/backup` → "Executar backup agora" / job do worker).

Cenários nomeados (SPEC §13): T1 "Laticínio Boa Vista – Itaberaba" (LP e LI concluídas, sem LO aberta); T2 "Posto
Estrela – Ruy Barbosa" (LP, LI, LO concluídas + 3 licenças, RT com CREA); T3 `tecnico.itb` com exatamente 2 processos
com prazo (vence em 3 dias e vencido); T4 denúncias de Itaberaba em apuração; T7 processos em Itaberaba e Iaçu; T11
"Clínica Odontológica Sorriso Ltda" (sem login) com um empreendimento em Itaberaba.

## 2. Subir o ambiente (Railway)

1. Criar um **projeto separado** `licenciagov-poc` (preferível a um *environment* no projeto da demo: banco, bucket,
   variáveis e domínio totalmente isolados). Mesmos serviços de `deploy/railway.md` (app, worker, Postgres, bucket).
2. Variáveis (Shared Variables): as de produção (`AUTH_SECRET`, `DATA_KEY`, `HASH_PEPPER` **novos**, gerados só para a
   PoC; `APP_URL` do domínio da PoC; storage próprio; `SMTP_URL` se houver) e:

   | Variável | Valor |
   |---|---|
   | `DEMO_MODE` | `false` (ou omitir) |
   | `SEED_CDS_POC` | `true` (serviço **worker**) |
   | `ONBOARD_SENHA` | senha de ensaio forte, **não** a senha demo pública (vale para os 13 internos e os 5 requerentes) |
   | `SEED_DEMO`, `SEED_RIACHAO_DEMO` | **não definir** |
   | `SEED_ONBOARDING` | **não incluir `cds-piemonte`** – o bloco `SEED_CDS_POC` já faz o onboarding com `--demo` (o predeploy aborta se ambos estiverem definidos) |

3. Deploy do worker → `scripts/predeploy.sh`: `migrate deploy` → `onboard -- cds-piemonte --demo` → `seed:cds-poc`.
   Confira no log o resumo "Ensaio da PoC (CDS Piemonte do Paraguaçu) carregado" (44 processos; `T3 – tecnico.itb: 2 alerta(s)`).
4. Backup real: em `/admin/backup` executar um backup e um teste de restauração (ou aguardar o job diário) – T10 exige backup ≤ 24 h.
5. Local (equivalente):
   ```bash
   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/licenciagov_poc DEMO_MODE=false
   npx prisma migrate deploy && npm run onboard -- cds-piemonte --demo && npm run seed:cds-poc
   ```
   O `seed:base`/`seed:demo` **não** é necessário: o onboarding copia o catálogo (`prisma/seed/catalogo.ts`) para a organização.

**Senhas.** O `--demo` usa `ONBOARD_SENHA` (padrão `Demo@2026licencia` se vazia – só para ensaio local). Antes da sessão
oficial, rotacionar:
```bash
ONBOARD_SENHA='<nova>' npm run onboard -- cds-piemonte --demo --redefinir-senhas   # 13 usuários internos
ONBOARD_SENHA='<nova>' npm run seed:cds-poc -- --redefinir-senhas                  # 5 requerentes
```
e rodar os E2E com `E2E_SENHA='<nova>'`. Após a PoC: desativar o ambiente (ou os usuários `@poc.licenciagov.app`).

**Recomeçar do zero** (antes da sessão oficial, para T1 partir do estado inicial): um deploy do worker com
`RESET_DB=true` (apaga e recria o banco) e depois remover a variável; em seguida refazer o passo 4 (backup real).

## 3. E2E contra o ambiente da PoC

```bash
E2E_BASE_URL=https://<dominio-da-poc> E2E_SENHA='<senha>' npm run test:e2e:poc-cds          # T1–T12 (T12 pulado)
E2E_BASE_URL=https://<dominio-da-poc> E2E_SENHA='<senha>' E2E_DATASET=poc-cds npm run test:e2e:poc   # só T1–T10
```
A massa de cada conjunto está em `tests/e2e/dados.ts` (usuários, município principal = Itaberaba, t2 = Ruy Barbosa,
outro = Iaçu, cenários, nº de municípios). **T12** (isolamento entre clientes) exige uma segunda organização no mesmo
banco; o ambiente da PoC tem um único cliente, então o T12 é pulado ali e demonstrado no ambiente de demonstração.
T1 grava estado para T5/T8: rodar a suíte na ordem (workers=1, já configurado). Rodar T1 de novo cria outra LO –
para repetir o ensaio do zero, use o "Recomeçar do zero" acima.

CI: job opcional `e2e-poc-cds` em `.github/workflows/ci.yml` (Actions → CI → *Run workflow*).

## 4. Ensaio cronometrado (SPEC §15, D8 – meta ≤ 4 h)

| # | Etapa | Tempo |
|---|---|---|
| 0 | Véspera: deploy com `SEED_CDS_POC=true`, backup + restauração reais, senhas rotacionadas, `test:e2e:poc-cds` verde | (fora do cronômetro) |
| 1 | Abertura: landing com os 8 órgãos, login com escolha do órgão, painel | 10 min |
| 2 | T1 processo completo (requerente → gestor → técnico → requerente → técnico → gestor) | 40 min |
| 3 | T2 cadastros e histórico | 15 min |
| 4 | T3 prazos e alertas | 15 min |
| 5 | T4 fiscalização no celular (Android real) | 30 min |
| 6 | T5 autenticidade (QR com outro celular + cancelamento) | 15 min |
| 7 | T6 dashboard | 10 min |
| 8 | T7 perfis | 20 min |
| 9 | T8 portal público | 10 min |
| 10 | T9 relatórios PDF/XLSX | 15 min |
| 11 | T10 backup e exportação completa | 20 min |
| 12 | Execução dos E2E em produção diante da banca (`test:e2e:poc-cds`, ~10 min) + folga para perguntas | 30 min |
| | **Total** | **≈ 3 h 50 min** |

Se uma etapa estourar o tempo em mais de 50%, registrar o motivo e ensaiar de novo só aquele bloco.

## 5. Roteiro para a banca (T1–T10 → telas)

Contas: e-mails `@poc.licenciagov.app`, senha de ensaio. Órgão no login = município do usuário (escopo organização: Itaberaba).

| Teste | Quem | Telas / passos |
|---|---|---|
| **T1** Processo completo | `laticinio@` → `gestor.itb@` → `tecnico.itb@` → `laticinio@` → `tecnico.itb@` → `gestor.itb@` | `/novo-requerimento`: empreendimento "Laticínio Boa Vista – Itaberaba" → tipologia/porte → **LO** → anexar documentos obrigatórios → protocolar (nº `ITB-2026-xxxxxx`, recibo PDF em `/meus-processos/{id}`). Gestor: `/processos/{id}` → **Distribuir** ao "Técnico(a) de Itaberaba". Técnico: **Abrir pendência**. Requerente: responder com anexo. Técnico: **Aceitar** → aba *Checklist* → aba *Parecer* (favorável com condicionantes). Gestor: **Deferir** → LO emitida (aba *Emitidos*). Aba *Tramitação*: todas as etapas com data, usuário e despacho. |
| **T2** Cadastros | `tecnico.ruy@` | `/empreendimentos` → buscar "Posto Estrela" → ficha "Posto Estrela – Ruy Barbosa": requerente (CNPJ mascarado), RT com CREA, mapa com o ponto, 3 processos (LP, LI, LO) e 3 licenças com link de validação. |
| **T3** Prazos | `tecnico.itb@`; `admin.cds@` | Sino com **2** alertas → `/alertas` (vence em 3 dias / vencido) → `/prazos` "Meus processos": abas *Vencidos* (vermelho) e *Vencem em 7 dias* (amarelo). Admin: `/admin/emails?q=tecnico.itb@…` – e-mails de alerta (caixa de teste ou "Enviado" se houver SMTP). |
| **T4** Fiscalização | `fiscal.itb@` no **celular** | `/fiscalizacao/denuncias` → denúncia de Itaberaba em apuração → **Registrar vistoria** → "Capturar localização" → 2 fotos → Irregular → salvar. Ficha e `/fiscalizacao/mapa?tipo=vistorias` mostram o ponto. **Gerar auto** (multa) e **Gerar notificação** → PDFs numerados. |
| **T5** Autenticidade | outro celular; `gestor.itb@` | Ler o QR da LO de T1 → `/validar/{codigo}` "VÁLIDO" (+ conferência do PDF por hash). Gestor: `/documentos/{id}` → cancelar com motivo → a mesma URL mostra "CANCELADO". |
| **T6** Dashboard | `admin.cds@` | `/dashboard`: filtro "Itaberaba" e depois "Todos" – cards, gráficos e tabela por município (8 linhas + total) coerentes. |
| **T7** Perfis | `tecnico.iac@`; `sema@`; visitante | Técnico de Iaçu: `/processos` só `IAC-…`; URL direta de processo de Itaberaba → 403. SEMA: vê todos, sem botões de ação. Sem login: páginas internas → `/login`; portal público acessível. |
| **T8** Portal público | sem login | `/consulta` com o nº de T1 → linha do tempo pública, CNPJ mascarado, sem despachos internos; landing → órgão Itaberaba → licenças. |
| **T9** Relatórios | `admin.cds@` | `/relatorios` → "Indicadores por município" em PDF e XLSX (cabeçalho institucional; mesmos números do painel). |
| **T10** Backup | `admin.cds@` | `/admin/backup`: último backup real ≤ 24 h e última restauração testada → **Exportação completa** (`/admin/exportar`) → ZIP com CSV/JSON por tabela, `anexos/` e `manifest.json`. |
