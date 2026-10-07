# Acordo de Nível de Serviço (ANS/SLA) e Suporte – LicenciaGov

| | |
|---|---|
| Contratante | [NOME DO CONSÓRCIO / MUNICÍPIO CONTRATANTE] – CNPJ [00.000.000/0000-00] |
| Contrato | [Nº DO CONTRATO] – Pregão Eletrônico SRP nº [005/2026] |
| Contratada | Valletec Lab – [RAZÃO SOCIAL] – CNPJ [00.000.000/0000-00] |
| Vigência | [dd/mm/aaaa] a [dd/mm/aaaa] (acompanha a vigência do contrato) |
| Versão | [1.0] – [dd/mm/aaaa] |

> Este documento detalha operacionalmente os níveis de serviço. Em caso de divergência, **prevalecem o Termo de Referência, a Errata 01 e o contrato**. Os valores marcados com [ajustar conforme o Termo de Referência] são propostas de mercado a confirmar.

---

## 1. Objeto e abrangência

Níveis de serviço da solução LicenciaGov fornecida em modelo SaaS: disponibilidade do ambiente de produção, atendimento de suporte, manutenção corretiva, backup e restauração, segurança da informação e proteção de dados pessoais, e relatórios mensais de acompanhamento.

Abrange: aplicação web (painel interno, área do requerente, portal público), API `/api/v1`, geração e validação de documentos, envio de e-mails e rotinas automáticas (alertas, backup, sincronizações).

Não abrange: equipamentos, rede e internet do Contratante; serviços de terceiros contratados diretamente pelo Contratante (ex.: conta de pagamentos Asaas, número de WhatsApp, certificados digitais, chave Google Maps); disponibilidade de serviços públicos externos consultados pelo sistema (SICAR/CAR, INPE, IBGE, INCRA, MMA/ICMBio, validador do ITI).

## 2. Disponibilidade

### 2.1 Meta

**Disponibilidade mínima mensal de 99%** do ambiente de produção (SPEC §9.1), apurada 24 horas por dia, 7 dias por semana.

### 2.2 Forma de medição

- Monitor externo independente verifica a cada **1 minuto** o endereço `GET /api/health` do ambiente de produção, que testa a aplicação, o **banco de dados** e o **armazenamento de arquivos** (HTTP 200 = disponível; 503 ou sem resposta = indisponível).
- Um minuto é considerado **com falha** quando a verificação falha e a falha é confirmada (ao menos 2 verificações consecutivas com falha, a partir de mais de uma localidade quando o monitor permitir).

**Fórmula:**

```
Disponibilidade (%) = [1 − (minutos com falha confirmada − minutos excluídos) / (minutos do mês − minutos de manutenção programada)] × 100
```

Referência: 99% corresponde a até **7 h 18 min** de indisponibilidade em um mês de 30 dias (43.200 min × 1% = 432 min). [ajustar conforme o Termo de Referência]

### 2.3 Manutenção programada

- Comunicada ao Contratante com **no mínimo 48 horas de antecedência** [ajustar conforme o Termo de Referência], por e-mail aos contatos cadastrados e aviso no sistema, com data, horário, duração prevista e impacto.
- Realizada preferencialmente fora do horário comercial: [dias úteis, entre 22h e 6h, ou fins de semana].
- Limite de manutenção programada: [8 horas por mês]. O que exceder conta como indisponibilidade.
- Atualizações rotineiras são publicadas com implantação gradual (sem interrupção) sempre que possível.

### 2.4 Exclusões (não contam como indisponibilidade)

1. Manutenção programada comunicada conforme 2.3;
2. Falhas de equipamentos, rede, energia ou internet do Contratante ou do usuário;
3. Indisponibilidade de serviços externos listados no item 1 (as funções que dependem deles degradam sem interromper o fluxo principal do licenciamento);
4. Caso fortuito ou força maior, inclusive falha generalizada do provedor de nuvem reconhecida publicamente, observado o plano de continuidade (seção 6);
5. Suspensão solicitada pelo Contratante ou decorrente de uso indevido/ataque originado de credenciais do Contratante;
6. Funções em versão de avaliação/homologação.

## 3. Canais e horário de atendimento

| Canal | Contato | Uso |
|---|---|---|
| Portal/e-mail de suporte | [suporte@dominio] / [https://portal-de-suporte] | Abertura e acompanhamento de chamados (canal oficial de registro) |
| WhatsApp de suporte | [(00) 00000-0000] | Dúvidas rápidas e abertura de chamados |
| Telefone | [(00) 0000-0000] | Incidentes críticos |
| Plantão de incidentes críticos | [telefone/canal de plantão] | 24 x 7 para severidade Crítica |

- **Horário de atendimento padrão**: dias úteis, das [8h às 18h] (horário de Brasília/Bahia).
- **Severidade Crítica**: atendimento **24 x 7**.
- Os prazos em horas úteis contam apenas dentro do horário de atendimento, exceto para severidade Crítica (horas corridas).
- Quem pode abrir chamados: administradores e pontos focais indicados pelo Contratante; servidores podem abrir chamados identificando nome, município e perfil. Requerentes são atendidos em primeiro nível pelo órgão ambiental do município.
- Cada chamado recebe número de protocolo; o chamado só é encerrado após confirmação do solicitante ou ausência de resposta em [3] dias úteis após a solução.
- [Registro de chamados dentro do próprio sistema: previsto para a fase de implantação (até 60 dias). Até lá, o registro oficial é feito pelo canal de e-mail/portal de suporte.]

**Informações para abertura**: nome, município, perfil, descrição, endereço da tela, número de processo/documento, data/hora, mensagem de erro e captura de tela. Nunca enviar senhas.

## 4. Severidades e prazos

### 4.1 Definições e exemplos

| Severidade | Definição | Exemplos no LicenciaGov |
|---|---|---|
| **Crítica** | Sistema indisponível ou função essencial parada para todos/vários municípios, sem alternativa; risco à integridade ou confidencialidade dos dados | Sistema fora do ar (`/api/health` em falha); login impossível para todos; falha na emissão de todos os documentos oficiais; validação pública de documentos indisponível; suspeita de vazamento de dados pessoais; perda de dados |
| **Alta** | Função importante indisponível ou com erro para um município/perfil, com impacto relevante e alternativa limitada | Protocolo de requerimentos falhando em um município; não é possível emitir parecer/deferir; vistoria mobile não salva; e-mails de alerta não enviados; backup diário falhou; webhook de pagamento não baixa cobranças; assinatura digital falhando com certificado válido |
| **Média** | Falha em função secundária ou com alternativa viável; impacto restrito | Relatório XLSX com erro de formatação; filtro do painel incorreto; camada externa do mapa não carrega; ajuste de modelo de documento; problema em um usuário específico |
| **Baixa** | Dúvida de uso, orientação, solicitação de melhoria, ajuste cosmético | Dúvida sobre como abrir pendência; texto de tela; sugestão de novo relatório; pedido de novo campo |

### 4.2 Prazos

[ajustar conforme o Termo de Referência]

| Severidade | 1ª resposta | Solução ou contorno | Solução definitiva (quando houver contorno) | Contagem |
|---|---|---|---|---|
| Crítica | **1 hora** | **4 horas** | 5 dias úteis | 24 x 7 (horas corridas) |
| Alta | **4 horas úteis** | **1 dia útil** | 10 dias úteis | Horário de atendimento |
| Média | **1 dia útil** | **5 dias úteis** | 20 dias úteis | Horário de atendimento |
| Baixa | **2 dias úteis** | **Próxima versão** (ou prazo acordado) | – | Horário de atendimento |

- **1ª resposta**: contato de um analista confirmando o recebimento, a severidade e o próximo passo (respostas automáticas não contam).
- **Solução ou contorno**: restabelecimento da função ou alternativa operacional que elimine o impacto.
- A severidade é proposta pelo solicitante e pode ser reclassificada pela Contratada, de forma justificada e com ciência do Contratante.
- O prazo fica suspenso enquanto o chamado aguarda informação do Contratante.

## 5. Escalonamento

| Nível | Quem | Quando |
|---|---|---|
| 1 | Suporte (analista de atendimento) | Abertura do chamado |
| 2 | Equipe técnica / desenvolvimento | Chamado que exige correção, dados ou infraestrutura; automaticamente para Crítica |
| 3 | Coordenação técnica da Contratada – [NOME/CARGO/CONTATO] | Prazo de solução com risco de estouro, ou Crítica sem contorno em 2 h |
| 4 | Direção da Contratada – [NOME/CARGO/CONTATO] ↔ Gestor do contrato do Contratante | Descumprimento reiterado de prazos ou incidente de segurança relevante |

Incidentes críticos: comunicação inicial ao Contratante em até **1 hora**, atualizações a cada **2 horas** até a normalização e **relatório de incidente** (causa, linha do tempo, impacto, ações corretivas e preventivas) em até **5 dias úteis**.

## 6. Backup, restauração e continuidade

Conforme a estratégia documentada (docs/backup.md e docs/restore.md):

| Item | Nível de serviço |
|---|---|
| Backup do banco de dados | **Diário** (dump lógico automático às 03:15, criptografado com AES-256), além do backup nativo do provedor |
| Cópia fora do provedor | Enviada a armazenamento em **outro provedor/região** |
| Retenção | **30 dias** |
| Arquivos (anexos e PDFs) | Armazenamento com versionamento e replicação para outro provedor |
| Teste de restauração | **Mensal e automático** (restaura o backup mais recente em banco descartável e confere contagens e travas de imutabilidade), com checklist manual mensal registrado |
| Monitoramento | Tela Administração → Backup (último backup ≤ 24 h, último teste); alerta por e-mail em caso de falha ou atraso |
| RPO (perda máxima de dados) | **≤ 24 horas** |
| RTO (tempo máximo de restabelecimento) | **≤ 4 horas** |
| Portabilidade | Exportação completa a qualquer momento (CSV + JSON por tabela, dicionário de dados, anexos, manifesto com SHA-256) |

Falha no teste de restauração é tratada como chamado **Crítico** e o teste é repetido em até 5 dias úteis.

Ao término do contrato: entrega da exportação completa e, mediante termo, da chave de decifração dos dados pessoais por canal separado; eliminação dos dados pela Contratada após a confirmação do recebimento, em prazo de [30] dias, com declaração formal. [ajustar conforme o Termo de Referência]

## 7. Segurança da informação e LGPD

### 7.1 Papéis

- **Controlador**: o Contratante (município/consórcio), que decide sobre o tratamento dos dados pessoais no exercício de suas competências legais (LGPD, arts. 7º, III, e 23).
- **Operador**: a Contratada (Valletec Lab), que trata os dados exclusivamente conforme as instruções do Controlador e o contrato.
- **Suboperadores** (infraestrutura e serviços): [provedor de nuvem – região], [provedor de armazenamento de backup], [serviço de e-mail transacional], [provedor de IA, quando o assistente estiver ativo], [demais] – lista mantida atualizada e informada ao Controlador.
- **Encarregado (DPO)** da Contratada: [NOME – e-mail]. Encarregado do Contratante: [NOME – e-mail].

### 7.2 Medidas técnicas implementadas

- HTTPS obrigatório (HSTS); cookies seguros; sessão curta com renovação; bloqueio após 5 tentativas de login.
- Senhas com hash argon2id; política mínima de 10 caracteres e troca obrigatória no primeiro acesso.
- CPF/CNPJ, e-mail e telefone de pessoas físicas **criptografados em repouso** (AES-256-GCM), com busca por hash.
- Portal público com mascaramento de CPF/CNPJ e abreviação de nomes de pessoas físicas.
- Isolamento por organização e por município aplicado no servidor.
- **Log de auditoria imutável** de acessos e de toda criação/alteração, emissão/cancelamento de documentos e exportações; tramitação imutável.
- Documentos oficiais com hash SHA-256, código verificador e assinatura.
- Segredos (chaves de API, certificados digitais) cifrados e nunca exibidos.
- Ambientes de homologação e produção separados; dados de demonstração fictícios.

### 7.3 Incidentes de segurança com dados pessoais

1. A Contratada comunica ao Controlador qualquer incidente que possa acarretar risco ou dano relevante aos titulares em até **48 horas** da ciência [ajustar conforme o Termo de Referência], com: descrição, dados e titulares afetados, medidas adotadas, riscos e contato.
2. A comunicação à **ANPD** e aos titulares cabe ao **Controlador**, no prazo da regulamentação vigente (Resolução CD/ANPD nº 15/2024 – 3 dias úteis), com apoio técnico da Contratada.
3. A Contratada preserva evidências e apresenta relatório final em até 5 dias úteis.

### 7.4 Direitos dos titulares

Solicitações de titulares recebidas pela Contratada são encaminhadas ao Controlador em até [2] dias úteis; a Contratada apoia o atendimento (consulta, correção, relatório de dados) dentro das funcionalidades do sistema e da legislação de guarda de documentos públicos.

## 8. Manutenção e atualizações

- **Corretiva**: conforme severidades (seção 4).
- **Adaptativa/evolutiva**: novas versões publicadas sem custo adicional dentro do escopo contratado; notas de versão enviadas ao Contratante.
- Mudanças que alterem fluxos de trabalho são comunicadas com antecedência de [5] dias úteis, com orientação aos usuários.

## 9. Relatório mensal

Até o **[5º] dia útil** de cada mês, a Contratada entrega o **Relatório Mensal de Disponibilidade e Chamados** do mês anterior (modelo: `relatorio-mensal-sla.md`), contendo:

1. Disponibilidade apurada (%), minutos de indisponibilidade, manutenções programadas e exclusões, com exportação do monitor externo anexa;
2. Lista de incidentes (início, fim, duração, causa, ação corretiva);
3. Chamados abertos, atendidos e pendentes por severidade, com tempos de 1ª resposta e de solução e o percentual dentro do prazo;
4. Backups executados, teste de restauração do mês (resultado e evidências);
5. Atualizações de versão publicadas;
6. Indicadores de uso (usuários ativos, processos, documentos emitidos, adesão por município);
7. Ocorrências de segurança;
8. Glosas apuradas, se houver.

## 10. Indicadores e glosas

[ajustar conforme o Termo de Referência e o contrato – as faixas abaixo são referência]

| Indicador | Meta | Faixa de descumprimento | Glosa sobre a fatura mensal |
|---|---|---|---|
| Disponibilidade mensal | ≥ 99,0% | 98,0% a 98,99% | [2]% |
| | | 97,0% a 97,99% | [5]% |
| | | < 97,0% | [10]% |
| Chamados Críticos solucionados no prazo | 100% | por chamado fora do prazo | [1]% |
| Chamados Altos solucionados no prazo | ≥ 95% | abaixo da meta | [0,5]% |
| Chamados Médios/Baixos no prazo | ≥ 90% | abaixo da meta | [0,25]% |
| Backup diário executado | 100% dos dias | dia sem backup válido | [0,5]% por ocorrência |
| Teste de restauração mensal | 1 por mês com sucesso | não realizado | [1]% |
| Relatório mensal entregue no prazo | até o [5º] dia útil | atraso | [0,5]% |

- Limite total de glosas no mês: [10]% da fatura. [ajustar conforme o Termo de Referência]
- As glosas não afastam as sanções administrativas previstas no contrato e na Lei nº 14.133/2021.
- A Contratada pode apresentar justificativa em [5] dias úteis, a ser analisada pela fiscalização do contrato.

## 11. Revisão

Este ANS é revisado a cada [12 meses] ou quando houver alteração contratual, mediante acordo entre as partes.

[Local], [dd/mm/aaaa].

| Pela Contratante | Pela Contratada |
|---|---|
| \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| [NOME] – Gestor do contrato | [NOME] – [CARGO], Valletec Lab |
