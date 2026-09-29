# Relatório de Implementação – LicenciaGov

**Modelo – Termo de Referência, item 5.3**

> Instruções de preenchimento: substitua todos os campos entre [COLCHETES]. Anexe as evidências indicadas (capturas de tela, exportações, listas de presença). Remova esta caixa na versão final.

---

## 1. Identificação

| Campo | Informação |
|---|---|
| Contratante | [NOME DO CONSÓRCIO / MUNICÍPIO CONTRATANTE] – CNPJ [00.000.000/0000-00] |
| Municípios atendidos | [LISTA DOS MUNICÍPIOS / ÓRGÃOS AMBIENTAIS] |
| Contratada | Valletec Lab – [RAZÃO SOCIAL COMPLETA] – CNPJ [00.000.000/0000-00] |
| Contrato / Ata de Registro de Preços | [Nº DO CONTRATO] / [Nº DA ATA] – Pregão Eletrônico SRP nº [005/2026] |
| Objeto | Solução SaaS de gestão de licenciamento e fiscalização ambiental municipal (LicenciaGov) |
| Data de assinatura do contrato | [dd/mm/aaaa] |
| Ordem de serviço / início da implantação | [dd/mm/aaaa] |
| Prazo de implantação | 60 (sessenta) dias – até [dd/mm/aaaa] |
| Fiscal do contrato (Contratante) | [NOME] – [CARGO] – [matrícula] |
| Gestor do contrato (Contratante) | [NOME] – [CARGO] |
| Responsável pela implantação (Contratada) | [NOME] – [CARGO] |
| Período coberto por este relatório | [dd/mm/aaaa] a [dd/mm/aaaa] |
| Versão do sistema em produção | [vX.Y.Z] |
| Endereços | Produção: [https://...] · Homologação/treinamento: [https://...] · Portal público: [https://.../orgao/SIGLA] |

---

## 2. Escopo da implantação

### 2.1 Módulos disponibilizados em produção

| Módulo | Situação | Observações |
|---|---|---|
| Autenticação, perfis e isolamento multi-município | [Implantado] | Perfis: administrador, técnico do consórcio, técnico municipal, gestor municipal, fiscal, SEMA/INEMA (leitura), requerente |
| Cadastros (pessoas, responsáveis técnicos, empreendimentos com mapa, tipologias) | [Implantado] | |
| Processo de licenciamento (requerimento online, balcão, triagem, pendências, checklist, vistoria, parecer, decisão) | [Implantado] | |
| Motor de prazos e alertas (sino e e-mail) | [Implantado] | |
| Documentos oficiais com QR Code, código verificador e validação pública | [Implantado] | |
| Assinatura digital ICP-Brasil (A1) / eletrônica avançada | [Implantado / sem certificado cadastrado] | Certificados cadastrados: [quantidade] |
| Fiscalização (denúncias, vistoria mobile com GPS/fotos, autos, notificações, mapa) | [Implantado] | |
| Monitoramento por satélite (DETER/PRODES × CAR × licenças) | [Implantado / não aplicável] | Municípios com código IBGE real sincronizados: [lista] |
| Assistente de denúncias (WhatsApp, chat do site, e-mail) | [Implantado / não contratado] | Canais ativos: [lista] |
| Demandas urbanas (poda/corte, som em evento, carro de som) | [Implantado / não aplicável] | |
| Cobrança de taxas (Pix/boleto – conta da prefeitura) | [Ativado em: ... / não ativado] | Depende de lei municipal e conta do município |
| Portal público (consulta, licenças, validação, denúncia) | [Implantado] | |
| Painel de indicadores e relatórios PDF/XLSX | [Implantado] | |
| Backup diário, teste de restauração mensal e exportação completa | [Implantado] | |

### 2.2 Itens da fase de implantação (P1 – até 60 dias)

| Item | Situação | Data de entrega | Observações |
|---|---|---|---|
| Importação de planilhas legadas dos municípios | [Concluído / Em andamento / Pendente] | [dd/mm/aaaa] | |
| Condicionantes (acompanhamento) e renovação de licenças | [ ] | [ ] | |
| Modelos de Termo de Referência para estudos ambientais | [ ] | [ ] | |
| Conselhos municipais de meio ambiente (pautas, atas, deliberações) | [ ] | [ ] | |
| Registro de chamados de suporte e relatório mensal de SLA | [ ] | [ ] | |
| 1º ciclo de treinamento | [ ] | [ ] | Ver seção 6 |
| Manual operacional | [Entregue] | [ ] | `manual-do-usuario.md` |
| Relatório de implementação (este documento) | [Entregue] | [ ] | |

---

## 3. Cronograma executado

| # | Etapa | Planejado (início – fim) | Realizado (início – fim) | Responsável | Situação / evidência |
|---|---|---|---|---|---|
| 1 | Reunião de abertura (kickoff), plano de implantação e matriz de responsabilidades | [dd/mm] – [dd/mm] | [dd/mm] – [dd/mm] | [ ] | Ata nº [ ] |
| 2 | Levantamento: tipos de ato, tipologias, documentos exigidos, prazos, modelos oficiais, fluxo de decisão (delegação) por município | [ ] | [ ] | [ ] | Questionário/planilha de parametrização |
| 3 | Provisionamento do ambiente de produção e de homologação (região Brasil, domínios, HTTPS) | [ ] | [ ] | Valletec Lab | Endereços na seção 1 |
| 4 | Cadastro da organização e municípios (onboarding), brasões e logotipo | [ ] | [ ] | Valletec Lab | Captura de /admin/municipios |
| 5 | Parametrização (tipos de ato, tipologias, documentos exigidos, checklists, prazos, feriados, modelos) | [ ] | [ ] | Valletec Lab + Contratante | Seção 4 |
| 6 | Criação de usuários e papéis | [ ] | [ ] | Valletec Lab + administrador | Seção 5 |
| 7 | Configurações opcionais: certificados digitais, cobrança/taxas, canais de atendimento | [ ] | [ ] | [ ] | |
| 8 | Carga de dados legados / migração | [ ] | [ ] | [ ] | Seção 6 |
| 9 | Testes de aceite com a equipe do Contratante | [ ] | [ ] | [ ] | Seção 7 |
| 10 | 1º ciclo de treinamento | [ ] | [ ] | Valletec Lab | Listas de presença (anexo) |
| 11 | Entrada em produção (go-live) e comunicação aos requerentes | [dd/mm/aaaa] | [dd/mm/aaaa] | [ ] | |
| 12 | Operação assistida (hipercuidado) | [ ] | [ ] | Valletec Lab | Chamados do período |
| 13 | Desativação de usuários/dados de demonstração e troca das senhas iniciais | [ ] | [ ] | Valletec Lab | Log de auditoria |
| 14 | Entrega deste relatório e termo de aceite | [ ] | [ ] | [ ] | Seção 11 |

---

## 4. Parametrizações realizadas

### 4.1 Por município

| Município (sigla) | Código IBGE | Órgão ambiental | Brasão | Distribuição automática | Delega decisão ao consórcio | Prazos com exceção municipal | Feriados municipais | Cobrança ativa | Certificado e-CNPJ | Canal de atendimento | Ativo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [Município A] ([AAA]) | [0000000] | [Secretaria ...] | [Sim/Não] | [Sim/Não] | [Sim/Não] | [Sim/Não] | [nº] | [Sim/Não] | [Sim/Não – validade] | [WhatsApp/Chat/E-mail] | [Sim] |
| [Município B] ([BBB]) | | | | | | | | | | | |
| [...] | | | | | | | | | | | |

### 4.2 Configurações da organização

| Item | Quantidade | Fonte / base legal | Validado por (Contratante) |
|---|---|---|---|
| Tipos de ato ativos | [nº] – [LP, LI, LO, LS, LU, LAC, RLO, AA, ASV, CERT_DISP, DECL, APC, ASE, ACS…] | [legislação municipal / SEMA-INEMA] | [NOME] |
| Tipologias ativas | [nº] | [Resolução CEPRAM nº 4.327/2013 e atualizações] | [ ] |
| Documentos exigidos (tipo de ato × tipologia) | [nº] | [ ] | [ ] |
| Checklists de análise | [nº] | [ ] | [ ] |
| Configuração de prazos (padrão + exceções) | Triagem [5 d úteis]; análise curta [30 d]; análise longa [60 d]; pendência [30 d]; vistoria [15 d úteis]; decisão [10 d úteis]; alerta [x] dias antes | [ ] | [ ] |
| Feriados estaduais/municipais | [nº] | [ ] | [ ] |
| Modelos de documento personalizados | [nº] – [licença, certidão, parecer, auto, notificação] | [modelos oficiais do município] | [ ] |
| Tabela de taxas | [nº linhas] | [Lei Municipal nº ...] | [ ] |
| Certificados digitais (e-CNPJ/e-CPF) | [nº] | ICP-Brasil A1 | [ ] |
| Canais de atendimento | [nº] | – | [ ] |

---

## 5. Usuários criados

| Perfil | Quantidade | Municípios | Observação |
|---|---|---|---|
| Administrador da organização | [ ] | Organização | |
| Técnico da organização (consórcio) | [ ] | Organização | |
| Técnico municipal | [ ] | [por município] | |
| Gestor ambiental municipal | [ ] | [por município] | |
| Fiscal ambiental | [ ] | [por município] | |
| Gestor estadual (SEMA/INEMA) | [ ] | Organização (somente leitura) | |
| Requerentes (cadastro próprio até a data) | [ ] | – | |
| **Total de usuários internos ativos** | **[ ]** | | |

- Senhas temporárias entregues por [canal seguro]; troca obrigatória no primeiro acesso confirmada em [nº]/[nº] usuários (coluna "Troca de senha" em Administração → Usuários e papéis).
- Usuários de demonstração desativados: [Sim/Não – data].
- Relação nominal de usuários: [anexo – exportação da tela de usuários].

---

## 6. Dados migrados / importados

| Conjunto | Origem (planilha/sistema) | Registros na origem | Importados | Rejeitados | Motivo das rejeições | Conferido por |
|---|---|---|---|---|---|---|
| Pessoas (requerentes, RTs) | [ ] | [ ] | [ ] | [ ] | [CPF/CNPJ inválido, duplicado…] | [ ] |
| Responsáveis técnicos | [ ] | | | | | |
| Empreendimentos | [ ] | | | | | |
| Processos em andamento | [ ] | | | | | |
| Licenças vigentes (histórico) | [ ] | | | | | |
| Denúncias / autos / notificações | [ ] | | | | | |
| Tipologias (CSV) | [ ] | | | | | |
| Anexos digitalizados | [ ] | [nº arquivos / GB] | | | | |

Procedimento: [descrever – planilha-modelo enviada em dd/mm, saneamento com o município, carga em homologação, conferência por amostragem, carga em produção]. Dados pessoais importados foram cifrados na carga. [A ferramenta de importação de planilhas legadas é item P1 – indicar a versão utilizada.]

---

## 7. Testes de aceite

Roteiro baseado nos itens da Prova de Conceito (SPEC §13 / Formulário de Avaliação da PoC), executado no ambiente de **produção** do Contratante com dados reais ou de teste identificados, e/ou no ambiente de homologação.

| # | Item | Roteiro resumido | Resultado esperado | Data | OK? | Observações / evidência |
|---|---|---|---|---|---|---|
| T1 | Processo completo | Requerente cria requerimento de LO, anexa documentos e protocola; técnico abre pendência; requerente responde; técnico preenche checklist e emite parecer favorável com condicionantes; gestor defere | Nº `SIGLA-ANO-000000` e recibo PDF; LO emitida; linha do tempo com todas as etapas, datas, usuários e despachos | [ ] | [ ] | |
| T2 | Cadastros e histórico | Abrir a ficha de um empreendimento com processos LP, LI e LO | Requerente, RT com registro no conselho, coordenadas no mapa, lista de processos e licenças vinculadas | [ ] | [ ] | |
| T3 | Prazos e alertas | Técnico com um processo vencendo em até 3 dias e outro vencido acessa o sistema | Alertas no sino; processos nas abas "Vencem em 7 dias"/"Vencidos" com semáforo; e-mail de alerta recebido | [ ] | [ ] | |
| T4 | Fiscalização mobile | Fiscal no celular registra vistoria a partir de denúncia com "Capturar localização" e 2 fotos; gera Auto de Infração e Notificação | Vistoria no mapa no ponto capturado; PDFs numerados emitidos | [ ] | [ ] | |
| T5 | Autenticidade | Ler o QR Code da LO do T1 com outro celular; cancelar o documento e validar de novo | `/validar/{código}` mostra "VÁLIDO" e, após o cancelamento, "CANCELADO" | [ ] | [ ] | |
| T6 | Dashboard | Filtrar o Painel por um município e depois "Todos" | Cards, gráficos e tabela por município mudam coerentemente | [ ] | [ ] | |
| T7 | Perfis e isolamento | Técnico do município A tenta ver processo do município B (lista e URL direta); SEMA/INEMA navega; visitante sem login | Técnico A não vê B (URL → 403); SEMA/INEMA vê tudo sem botões de ação; visitante só acessa o portal | [ ] | [ ] | |
| T8 | Portal público | Sem login, consultar o processo do T1 pelo número | Linha do tempo pública e CPF/CNPJ mascarado | [ ] | [ ] | |
| T9 | Relatórios | Exportar "Indicadores por município" em PDF e XLSX | Arquivos com cabeçalho institucional e os mesmos números da tela | [ ] | [ ] | |
| T10 | Backup e portabilidade | Abrir Administração → Backup; solicitar exportação completa | Último backup ≤ 24 h e último teste de restauração; ZIP com CSV/JSON por tabela, anexos e `manifest.json` | [ ] | [ ] | |
| T11 | Balcão (complementar) | Servidor protocola requerimento em nome de requerente presente | Processo protocolado com registro "Protocolado no balcão por …" e recibo | [ ] | [ ] | |
| T12 | Isolamento entre organizações (complementar) | Usuário de organização distinta tenta acessar dados | Nenhum dado de outra organização visível | [ ] | [ ] | |
| T13 | Denúncia por chat/WhatsApp (se contratado) | Cidadão registra denúncia pelo assistente | Protocolo `DEN-SIGLA-000/ANO` na fila de Denúncias e no Atendimento; acompanhamento público | [ ] | [ ] | |
| T14 | Monitoramento por satélite (se aplicável) | Sincronizar município com código IBGE real e abrir um alerta | Alertas DETER/PRODES com cruzamento CAR e sugestão; "Abrir fiscalização" funciona | [ ] | [ ] | |
| T15 | Demandas urbanas (se aplicável) | Solicitar poda/corte pelo portal; técnico decide | Autorização emitida com QR Code | [ ] | [ ] | |
| – | Assinatura digital (se houver certificado) | Emitir documento e validar no validar.iti.gov.br | Assinatura ICP-Brasil reconhecida (integridade e cadeia) | [ ] | [ ] | |
| – | Cobrança (se ativada) | Gerar taxa no protocolo; pagar (sandbox) ou baixa manual | Baixa automática/manual refletida na tramitação e no Financeiro | [ ] | [ ] | |

---

## 8. Pendências

| # | Descrição | Impacto | Responsável | Prazo | Situação |
|---|---|---|---|---|---|
| 1 | [Ex.: aguardando lei municipal de taxas do município X para ativar cobrança] | [Baixo/Médio/Alto] | [Contratante] | [dd/mm/aaaa] | [Aberta] |
| 2 | [Ex.: certificado e-CNPJ do município Y não fornecido – documentos saem com assinatura eletrônica avançada] | | | | |
| 3 | [Ex.: planilha legada do município Z com CPF/CNPJ inválidos a sanear] | | | | |

## 9. Riscos identificados

| # | Risco | Probabilidade | Impacto | Mitigação | Responsável |
|---|---|---|---|---|---|
| 1 | Baixa adesão de servidores/municípios (meta de adesão do convênio) | [ ] | [ ] | Treinamento, acompanhamento do indicador "Adesão dos municípios" no Painel, operação assistida | [ ] |
| 2 | Qualidade dos dados legados | [ ] | [ ] | Saneamento prévio, carga em homologação, conferência por amostragem | [ ] |
| 3 | Indisponibilidade de serviços externos (SICAR, INPE, IBGE, gateway de pagamento, WhatsApp) | [ ] | [ ] | Funcionalidades degradam sem afetar o fluxo principal; sincronizações automáticas de recuperação | Valletec Lab |
| 4 | Vencimento de certificados digitais | [ ] | [ ] | Alertas automáticos a 30/15/7/1 dia(s) | Contratante |
| 5 | Parametrização legal incompleta (tipos de ato, tipologias, taxas) | [ ] | [ ] | Validação com SEMA/INEMA e procuradoria municipal | Contratante |

## 10. Próximos passos

- [ ] Concluir as pendências da seção 8.
- [ ] Entregar o 1º Relatório Mensal de Disponibilidade e Chamados em [dd/mm/aaaa] (`relatorio-mensal-sla.md`).
- [ ] [2º ciclo de treinamento / reciclagem em dd/mm/aaaa].
- [ ] Reunião de avaliação pós-implantação em [dd/mm/aaaa].
- [ ] [Evoluções P2 de interesse do Contratante: integração SEIA, login gov.br, assinatura gov.br/A3, app offline – mediante planejamento].

---

## 11. Termo de aceite

Declaramos que os serviços de implantação descritos neste relatório foram executados e verificados, [com / sem] as pendências relacionadas na seção 8, que serão tratadas nos prazos indicados.

[Local], [dd] de [mês] de [aaaa].

| Pela Contratante | Pela Contratada |
|---|---|
| \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| [NOME] | [NOME] |
| Fiscal do contrato – [CARGO] | [CARGO] – Valletec Lab |
| \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | |
| [NOME] | |
| Gestor do contrato – [CARGO] | |

### Anexos

1. Ata da reunião de abertura.
2. Planilhas de parametrização validadas.
3. Relação de usuários criados.
4. Relatório de carga de dados (quantitativos e rejeições).
5. Evidências dos testes de aceite (capturas de tela, PDFs, ZIP de exportação).
6. Listas de presença e avaliações do treinamento.
7. Captura da tela de backup (último backup e último teste de restauração).
