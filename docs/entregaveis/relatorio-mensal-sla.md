# Relatório Mensal de Disponibilidade e Chamados – LicenciaGov

**Competência: [mês/aaaa]**

| | |
|---|---|
| Contratante | [NOME DO CONSÓRCIO / MUNICÍPIO CONTRATANTE] |
| Contrato | [Nº DO CONTRATO] |
| Contratada | Valletec Lab – [RAZÃO SOCIAL] – CNPJ [00.000.000/0000-00] |
| Período apurado | [01/mm/aaaa 00:00] a [dd/mm/aaaa 23:59] (horário de Brasília) |
| Data de emissão | [dd/mm/aaaa] |
| Elaborado por | [NOME] – [CARGO] |
| Referência | Acordo de Nível de Serviço (`acordo-de-nivel-de-servico.md`), SPEC §9.1 |

---

## 1. Resumo executivo

| Indicador | Meta | Apurado | Situação |
|---|---|---|---|
| Disponibilidade mensal | ≥ 99,0% | [99,xx]% | [Atendida / Não atendida] |
| Incidentes com indisponibilidade | – | [nº] | |
| Chamados abertos no mês | – | [nº] | |
| Chamados Críticos solucionados no prazo | 100% | [ ]% | |
| Chamados Altos solucionados no prazo | ≥ 95% | [ ]% | |
| Chamados Médios/Baixos no prazo | ≥ 90% | [ ]% | |
| Backups diários com sucesso | 100% dos dias | [nº]/[nº] dias | |
| Teste de restauração mensal | 1 com sucesso | [Sucesso em dd/mm] | |
| Ocorrências de segurança / LGPD | 0 | [nº] | |
| Glosa apurada | – | [0]% | |

Comentário geral: [texto breve sobre o mês – estabilidade, principais ocorrências, melhorias entregues].

---

## 2. Disponibilidade

### 2.1 Apuração

| Item | Valor |
|---|---|
| Minutos do mês | [43.200 / 44.640 / …] |
| Minutos de manutenção programada (comunicada ≥ 48 h) | [ ] |
| Minutos com falha confirmada | [ ] |
| Minutos excluídos (seção 2.4 do ANS) | [ ] |
| **Disponibilidade** = 1 − (falha − excluídos) / (mês − manutenção) | **[ ]%** |
| Ferramenta de monitoramento / frequência | [nome do monitor] – verificação a cada 1 min em `/api/health` |
| Evidência | Exportação do monitor anexa (Anexo A) |

### 2.2 Disponibilidade por dia

| Dia | Disponibilidade (%) | Indisponibilidade (min) | Observação |
|---|---|---|---|
| 01 | [100,00] | [0] | |
| 02 | | | |
| 03 | | | |
| … | | | |
| 30/31 | | | |

### 2.3 Incidentes

| # | Início (data/hora) | Fim (data/hora) | Duração (min) | Abrangência (todos / município / função) | Causa | Ação corretiva | Ação preventiva | Chamado nº | Excluído do cálculo? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | | [Não] |

### 2.4 Manutenções programadas

| # | Data/hora | Duração | Comunicada em | Motivo | Impacto |
|---|---|---|---|---|---|
| 1 | | | | | |

---

## 3. Chamados de suporte

### 3.1 Consolidado por severidade

| Severidade | Abertos no mês | Pendentes do mês anterior | Solucionados | Pendentes ao final | 1ª resposta – meta | 1ª resposta – média | Solução – meta | Solução – média | % no prazo |
|---|---|---|---|---|---|---|---|---|---|
| Crítica | | | | | 1 h | | 4 h | | |
| Alta | | | | | 4 h úteis | | 1 dia útil | | |
| Média | | | | | 1 dia útil | | 5 dias úteis | | |
| Baixa | | | | | 2 dias úteis | | Próxima versão | | |
| **Total** | | | | | | | | | |

### 3.2 Chamados por município e por categoria

| Município | Dúvida de uso | Erro / falha | Configuração | Melhoria | Total |
|---|---|---|---|---|---|
| [Município A] | | | | | |
| [Município B] | | | | | |
| **Total** | | | | | |

### 3.3 Relação de chamados

| Nº | Abertura | Solicitante (município/perfil) | Severidade | Descrição resumida | 1ª resposta | Solução | Tempo 1ª resp. | Tempo solução | No prazo? | Situação |
|---|---|---|---|---|---|---|---|---|---|---|
| [ ] | [dd/mm hh:mm] | | | | | | | | [Sim/Não] | [Encerrado] |

### 3.4 Chamados fora do prazo – justificativas

| Nº | Severidade | Atraso | Justificativa | Medida para evitar recorrência |
|---|---|---|---|---|
| | | | | |

---

## 4. Backup e restauração

Fonte: Administração → Backup (registros de execução) – captura de tela no Anexo B.

### 4.1 Backups diários

| Data | Hora | Resultado | Tamanho | Destino (fora do provedor?) | SHA-256 (início) | Observação |
|---|---|---|---|---|---|---|
| [01/mm] | [03:15] | [Sucesso] | [ ] MB | [Sim] | [xxxxxxxx…] | |
| … | | | | | | |

Resumo: [nº] execuções com sucesso, [nº] falhas (tratadas nos chamados [nº]). Retenção vigente: 30 dias. Cópia fora do provedor: [configurada].

### 4.2 Teste de restauração do mês

| Item | Resultado |
|---|---|
| Teste automático (data/hora) | [dd/mm/aaaa hh:mm] – [Sucesso/Falha] |
| Dump utilizado | [licenciagov-AAAAMMDDTHHMMSSZ.dump.enc] |
| Integridade (SHA-256) conferida | [Sim] |
| Contagens restaurado × produção dentro da tolerância | [Sim] |
| Travas de imutabilidade (tramitação/log) verificadas | [Sim] |
| Duração | [ ] min |
| Checklist manual mensal (docs/restore.md, itens 1–10) | [Concluído em dd/mm – registrado na tela de backup] |
| RPO / RTO verificados | RPO [ ] h (meta ≤ 24 h) · RTO [ ] h (meta ≤ 4 h) |

---

## 5. Atualizações de versão

| Data | Versão | Tipo (correção / melhoria / segurança) | Principais mudanças | Interrupção? | Comunicado em |
|---|---|---|---|---|---|
| | | | | [Não] | |

---

## 6. Segurança da informação e LGPD

| Item | Mês |
|---|---|
| Incidentes de segurança com dados pessoais | [0] – [se houver: data, comunicação ao Controlador em dd/mm hh:mm] |
| Tentativas de login bloqueadas (bloqueio após 5 falhas) | [nº] |
| Exportações completas de dados realizadas (auditadas) | [nº] |
| Certificados digitais vencendo em 60 dias | [lista] |
| Solicitações de titulares encaminhadas | [nº] |
| Atualizações de segurança aplicadas | [ ] |

---

## 7. Indicadores de uso

Fonte: Painel de indicadores e relatório "Indicadores por município" (PDF/XLSX anexos).

### 7.1 Por município

| Município | Usuários internos ativos | Acessos no mês | Processos protocolados | Processos concluídos | Tempo médio de tramitação (dias) | Prazos vencidos (fim do mês) | Licenças/autorizações emitidas | Denúncias recebidas / apuradas | Vistorias | Autos | Notificações | Aderido? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| [Município A] | | | | | | | | | | | | [Sim] |
| [Município B] | | | | | | | | | | | | |
| **Total** | | | | | | | | | | | | **[ ]%** |

(Aderido = ao menos 1 usuário municipal ativo e 1 processo protocolado.)

### 7.2 Canais e serviços (quando ativos)

| Indicador | Valor |
|---|---|
| Requerimentos online × balcão | [ ] × [ ] |
| Requerentes cadastrados no mês | [ ] |
| Denúncias por canal (portal, chat, WhatsApp, e-mail, presencial/telefone) | [ ] |
| Demandas urbanas (APC/ASE/ACS) protocoladas / concluídas | [ ] |
| Cobranças geradas / pagas / valor arrecadado (R$) | [ ] |
| Alertas de desmatamento novos / tratados | [ ] |
| Validações públicas de documentos | [se disponível] |

---

## 8. Glosas

| Indicador | Meta | Apurado | Faixa | Glosa (%) |
|---|---|---|---|---|
| Disponibilidade | ≥ 99,0% | | | |
| Chamados Críticos no prazo | 100% | | | |
| Chamados Altos no prazo | ≥ 95% | | | |
| Chamados Médios/Baixos no prazo | ≥ 90% | | | |
| Backup diário | 100% | | | |
| Teste de restauração | 1/mês | | | |
| Entrega do relatório | até o [5º] dia útil | | | |
| **Total (limitado a [10]%)** | | | | **[ ]%** |

---

## 9. Plano de ação e observações

| # | Ação | Responsável | Prazo |
|---|---|---|---|
| 1 | | | |

---

## 10. Anexos

- A – Exportação do monitor externo de disponibilidade (CSV/PDF).
- B – Captura da tela Administração → Backup (último backup e último teste de restauração).
- C – Relatório "Indicadores por município" (PDF e XLSX).
- D – Relatórios de incidente (quando houver).
- E – Notas de versão.

---

## 11. Aceite

| Pela Contratada | Pela Contratante (fiscal do contrato) |
|---|---|
| \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| [NOME] – [CARGO] | [NOME] – [CARGO] |
| Data: [dd/mm/aaaa] | Data: [dd/mm/aaaa] – [ ] Aprovado [ ] Aprovado com ressalvas |
