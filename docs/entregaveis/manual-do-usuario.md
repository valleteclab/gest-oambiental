# Manual Operacional do Usuário – LicenciaGov

**Sistema de Gestão de Licenciamento e Fiscalização Ambiental Municipal**

| | |
|---|---|
| Contratante | [NOME DO CONSÓRCIO / MUNICÍPIO CONTRATANTE] |
| Contrato | [Nº DO CONTRATO] – [Pregão Eletrônico SRP nº 005/2026 / processo administrativo nº ...] |
| Contratada | Valletec Lab – [RAZÃO SOCIAL COMPLETA] – CNPJ [00.000.000/0000-00] |
| Documento | Manual operacional (Termo de Referência, item 5.3) |
| Versão do manual | [1.0] – [dd/mm/aaaa] |
| Versão do sistema | [vX.Y.Z] |
| Endereço de acesso | [https://endereço-de-produção] (produção) · [https://endereço-de-homologação] (treinamento/homologação) |

> Este manual descreve as telas e funções **efetivamente disponíveis** na versão indicada acima. Funções previstas para a fase de implantação (até 60 dias após a assinatura do contrato) estão sinalizadas como tal. Os exemplos usam dados fictícios (ex.: município "Lagoa do Orvalho", sigla LOR).

---

## Sumário

1. [Introdução](#1-introdução)
2. [Acesso ao sistema](#2-acesso-ao-sistema)
3. [Elementos comuns da tela](#3-elementos-comuns-da-tela)
4. [Requerente (empresa, cidadão ou responsável técnico)](#4-requerente)
5. [Balcão de atendimento (protocolo presencial)](#5-balcão-de-atendimento)
6. [Técnico (municipal ou do consórcio)](#6-técnico)
7. [Gestor ambiental municipal](#7-gestor-ambiental-municipal)
8. [Fiscal ambiental](#8-fiscal-ambiental)
9. [Atendimento e Assistente Ambiental de denúncias](#9-atendimento-e-assistente-ambiental-de-denúncias)
10. [Demandas urbanas (poda/corte, som em evento, carro de som)](#10-demandas-urbanas)
11. [Administrador da organização](#11-administrador-da-organização)
12. [Gestor estadual (SEMA/INEMA) – consulta](#12-gestor-estadual-semainema)
13. [Portal público (cidadão, sem login)](#13-portal-público)
14. [Perguntas frequentes](#14-perguntas-frequentes)
15. [Glossário](#15-glossário)
16. [Suporte](#16-suporte)

---

## 1. Introdução

### 1.1 O que é o LicenciaGov

O LicenciaGov é um sistema web (acessado pelo navegador, sem instalação) para órgãos ambientais municipais e consórcios públicos. Ele reúne em um só lugar:

- **Licenciamento ambiental**: requerimento pela internet ou no balcão, protocolo numerado, triagem, análise, pendências, checklist, vistoria, parecer, decisão e emissão de licenças, autorizações e certidões;
- **Motor de prazos e alertas**: prazos por etapa, semáforo, avisos no sino e por e-mail;
- **Documentos oficiais** com QR Code, código verificador, hash SHA-256 e assinatura (digital ICP-Brasil, quando houver certificado, ou eletrônica avançada);
- **Fiscalização**: denúncias, vistoria pelo celular com GPS e fotos, autos de infração, notificações, mapa;
- **Monitoramento por satélite** de alertas de desmatamento (INPE) cruzados com o CAR e as licenças do município;
- **Atendimento** de denúncias por WhatsApp, chat do site e e-mail (Assistente Ambiental);
- **Demandas urbanas**: poda/corte de árvore, som em evento e carro de som;
- **Cobrança de taxas** por Pix/boleto na conta da própria prefeitura (quando configurada);
- **Painel de indicadores e relatórios** em PDF e XLSX;
- **Portal público** de transparência (consulta de processo, licenças emitidas, validação de documentos, denúncia).

### 1.2 Perfis de acesso

Cada usuário recebe um ou mais **papéis**. Papéis municipais valem somente nos municípios vinculados; papéis de organização valem em todos os municípios da organização (consórcio) contratante – e **nunca** em municípios de outra organização.

| Perfil (como aparece no sistema) | Escopo | Principais atribuições |
|---|---|---|
| Administrador da organização | Todos os municípios da organização | Tudo o que os técnicos fazem, decisão, cancelamento de documentos e todas as configurações (menu **Administração**) |
| Técnico da organização (consórcio) | Todos os municípios da organização | Triagem, análise, pendências, checklist, parecer, vistoria, fiscalização; decide quando o município **delega a decisão** ao consórcio |
| Técnico municipal | Somente o(s) seu(s) município(s) | Igual ao técnico do consórcio, no próprio município |
| Gestor ambiental municipal | Seu município | Distribuir, aceitar, **deferir/indeferir**, emitir e cancelar documentos, baixa manual/isenção de taxas, protocolo no balcão |
| Fiscal ambiental | Seu município | Denúncias, vistorias, autos de infração, notificações, monitoramento |
| Gestor estadual (SEMA/INEMA) | Todos os municípios da organização | **Somente leitura** de tudo, relatórios e exportação de dados |
| Requerente | Seus próprios processos | Requerer, anexar, responder pendências, pagar taxas, baixar documentos |
| Cidadão (sem login) | – | Portal público |

> A segurança é aplicada no servidor: um registro fora do seu escopo não aparece nas listas e, se acessado por endereço direto, retorna **"Acesso negado (403)"**.

### 1.3 Requisitos de uso

- Navegador atualizado: Google Chrome, Microsoft Edge ou Mozilla Firefox (computador) e Chrome no Android (celular).
- Conexão com a internet. As telas funcionam a partir de 320 px de largura (celulares).
- Para a vistoria de campo: celular com GPS e câmera, com permissão de localização concedida ao navegador.
- Arquivos aceitos em anexos: **PDF, JPG/JPEG, PNG, DWG, KML, KMZ e ZIP (shapefile)**, até **25 MB** por arquivo.

---

## 2. Acesso ao sistema

### 2.1 Entrar (login)

1. Acesse [https://endereço-de-produção] e clique em **Entrar** (ou abra diretamente `/login`).
2. Informe **E-mail** e **Senha**.
3. Campo **Órgão**: escolha o município/órgão ambiental em que vai atuar ou deixe **"Escolher depois de entrar"**.
   - A lista mostra os órgãos agrupados por organização; a permissão é conferida ao entrar.
   - Se você só tem acesso a um órgão, ele é escolhido automaticamente.
   - Se tem acesso a vários e não escolheu, o sistema abre a tela **Trocar órgão**.
4. Clique em **Entrar**.

[captura de tela: tela de login com os campos Órgão, E-mail e Senha]

Após o login, usuários internos vão para o **Painel**; requerentes vão para **Meus processos**.

**Segurança da conta**

- Após **5 tentativas** de senha incorreta, a conta é **bloqueada por 15 minutos**.
- A sessão expira após períodos de inatividade (sessão curta renovada automaticamente por até 8 horas). Ao expirar, faça login novamente.
- Todos os acessos, falhas de login e ações ficam registrados no log de auditoria.

### 2.2 Primeiro acesso e troca de senha

- Usuários internos são criados pelo administrador, que recebe uma **senha temporária** para entregar ao servidor por canal seguro.
- No primeiro acesso (ou após redefinição pelo administrador), o sistema abre a tela **Trocar senha**: informe **Senha atual** (a temporária), **Nova senha** e **Confirmar nova senha** e clique em **Salvar**.
- Política: mínimo de **10 caracteres**; a nova senha deve ser diferente da atual.
- Para trocar a senha a qualquer momento, acesse o endereço `/trocar-senha` estando logado.

**Esqueci minha senha**: a redefinição é feita pelo administrador da organização (Administração → Usuários e papéis → usuário → **Redefinir senha**), que gera nova senha temporária. Requerentes devem procurar o órgão ambiental do município. [Recuperação de senha por e-mail em autoatendimento: previsto para a fase de implantação (até 60 dias), se exigido pelo TR.]

### 2.3 Órgão ativo e "Trocar órgão"

O **órgão ativo** aparece no topo da tela, com o link **Trocar órgão**. Ele define o contexto de trabalho: o cabeçalho, o **filtro padrão** das listagens (Painel, Processos, Prazos) e o município padrão de novos requerimentos. Ele **não** amplia nem reduz suas permissões.

1. Clique em **Trocar órgão** no topo da tela.
2. Escolha o município/órgão na lista (aparecem somente os que seu usuário pode acessar).
3. O sistema volta à tela anterior já no novo contexto.

[captura de tela: tela "Trocar órgão" com os brasões dos municípios]

> Técnicos municipais veem apenas os seus municípios; administradores, técnicos do consórcio e SEMA/INEMA veem todos os municípios da organização; requerentes podem escolher qualquer órgão ativo para requerer.

### 2.4 Sair

Clique em **Sair** no canto superior direito. Em computadores compartilhados, sempre saia ao terminar.

### 2.5 Cadastro de requerente (autoatendimento)

Veja [4.1](#41-criar-conta).

---

## 3. Elementos comuns da tela

### 3.1 Menu lateral (usuários internos)

No computador o menu fica à esquerda; no celular fica recolhido em **Menu ▾**. Cada usuário vê apenas os itens permitidos ao seu perfil:

| Item do menu | Admin | Téc. consórcio | Téc. municipal | Gestor | Fiscal | SEMA/INEMA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Painel | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Caixa de entrada | ✔ | ✔ | ✔ | ✔ | – | – |
| Processos | ✔ | ✔ | ✔ | ✔ | ✔ (consulta) | ✔ (consulta) |
| Prazos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Demandas urbanas | ✔ | ✔ | ✔ | ✔ | ✔ (consulta) | ✔ (consulta) |
| Empreendimentos | ✔ | ✔ | ✔ | ✔ (consulta) | ✔ (consulta) | ✔ (consulta) |
| Pessoas / Responsáveis técnicos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (consulta) |
| Fiscalização / Denúncias / Mapa | ✔ | ✔ | ✔ | ✔ (consulta; emite autos/notificações) | ✔ | ✔ (consulta) |
| Monitoramento | ✔ | ✔ | ✔ | ✔ (consulta) | ✔ | ✔ (consulta) |
| Atendimento | ✔ | ✔ | ✔ | ✔ (consulta) | ✔ | ✔ (consulta) |
| Documentos emitidos | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (consulta) |
| Financeiro | ✔ | ✔ (consulta) | ✔ (consulta) | ✔ | ✔ (consulta) | ✔ (consulta) |
| Relatórios | ✔ | ✔ | ✔ | ✔ | – | ✔ |
| Meu certificado digital | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| Administração | ✔ (completa) | – | – | – | – | ✔ (somente Exportação completa) |

### 3.2 Barra superior

- **Órgão ativo** e link **Trocar órgão**.
- **Busca global** ("Buscar nº de processo, CPF/CNPJ, nome, empreendimento…"): procura processos, pessoas e empreendimentos no seu escopo. O CPF/CNPJ deve ser digitado completo.
- **Sino de alertas**: mostra os alertas não lidos (prazo vencendo/vencido, pendências, condicionantes, licenças a renovar, certificados, pagamentos, alertas de desmatamento). Clique em um alerta para abrir o registro; em **Meus alertas** (`/alertas`) use **Marcar como lido** ou **Marcar todos como lidos**.
- Nome do usuário, papéis e botão **Sair**.

### 3.3 Semáforo de prazos

| Cor | Significado |
|---|---|
| Verde | Prazo da etapa em dia |
| Amarelo | Dentro da janela de alerta (ex.: faltam 5 dias ou menos) |
| Vermelho | Prazo vencido |
| "Relógio pausado" | Processo aguardando o requerente – o prazo fica suspenso e mostra o saldo de dias |

### 3.4 Situações (status) do processo

| Status interno | O que significa | Como o requerente vê |
|---|---|---|
| Rascunho | Requerimento ainda não protocolado | Rascunho |
| Protocolado | Recebeu número, aguarda distribuição | Protocolado |
| Em triagem | Conferência documental | Em análise |
| Aguardando requerente | Há pendência a responder (relógio pausado) | Pendência – ação necessária |
| Em análise | Análise técnica | Em análise |
| Aguardando vistoria | Vistoria agendada | Em análise |
| Aguardando decisão | Parecer emitido; aguarda o gestor | Em análise |
| Deferido / Indeferido | Decisão tomada | Concluído |
| Concluído | Documento da decisão emitido | Concluído |
| Arquivado | Arquivado com justificativa | Arquivado |

---

## 4. Requerente

### 4.1 Criar conta

1. Na tela de login, clique em **Cadastre-se** (ou acesse `/cadastro`).
2. Escolha o **Tipo de requerente** (pessoa física ou jurídica).
3. Preencha **Nome completo** (ou **Razão social** e **Nome fantasia**), **CPF**/**CNPJ** (validado pelo dígito verificador), **E-mail**, **Telefone**, **Município principal**, **Senha** (mínimo de 10 caracteres) e **Confirmar senha**.
4. Marque o aceite dos termos de uso e da política de privacidade e clique em **Criar conta**.

[captura de tela: formulário de cadastro]

> Se o CPF/CNPJ já tiver cadastro no órgão (ex.: protocolo feito no balcão), o sistema informa e orienta a procurar o atendimento do município para liberar o acesso.

Seus dados pessoais (CPF, e-mail e telefone de pessoa física) são armazenados **criptografados**.

### 4.2 Área do requerente

O menu superior tem **Meus processos**, **Novo requerimento** e **Sair**. Em **Meus processos** aparecem todos os requerimentos em que você é requerente ou responsável técnico, com a situação e um aviso destacado quando há **"Pendência – ação necessária"**.

[captura de tela: lista "Meus processos"]

### 4.3 Novo requerimento (assistente em etapas)

Clique em **Novo requerimento**. Se ainda não escolheu o órgão, o sistema pede para escolher o município (tela **Trocar órgão**). O assistente tem as etapas:

1. **Empreendimento** – selecione um empreendimento já cadastrado ou informe um novo: **Município**, **Logradouro**, **Número**, **Bairro/localidade**, **Área (m²)**, **Nº do CAR (se rural)** e a **Localização** (clique no mapa para marcar o ponto, ou digite **Latitude**/**Longitude**).
2. **Tipologia e porte** – escolha a **Tipologia da atividade** e informe a grandeza (ex.: área construída, nº de cabeças). O sistema mostra o **Porte calculado** e o **Potencial poluidor** (o porte pode ser revisto pelo técnico).
3. **Tipo de ato** – escolha o ato requerido (ex.: LP, LI, LO, LS, LU, LAC, RLO, AA, ASV, Certidão de Dispensa, Declaração – conforme a lista parametrizada pelo órgão). Clique em **Salvar rascunho e continuar**: a partir daqui o rascunho fica salvo e pode ser retomado depois (**Continuar preenchimento** em Meus processos).
4. **Documentos** – a lista de documentos exigidos é gerada automaticamente para o tipo de ato (e tipologia). Anexe cada documento no seu item; use "Outros documentos (opcional)" para complementos. Limite de 25 MB por arquivo.
5. **Revisão e protocolo** – confira o resumo. Se faltar documento obrigatório, o sistema avisa ("Faltam documentos obrigatórios…" – **Anexar agora**). Clique em **Protocolar requerimento**.

[captura de tela: assistente – etapa Documentos]

Após o protocolo:

- o processo recebe número no formato `SIGLA-ANO-000000` (ex.: `LOR-2026-000042`);
- o **recibo de protocolo em PDF** fica disponível em **Documentos** na ficha do processo;
- se o órgão cobrar taxa no protocolo, a cobrança aparece na ficha (ver 4.6).

### 4.4 Acompanhar o processo

Em **Meus processos**, clique no número do processo. A ficha mostra:

- **Andamento** (linha do tempo com datas das etapas);
- **Pendências** abertas e respondidas;
- **Documentos** enviados e **documentos emitidos** (recibo, licença, ofício etc.) com botão **Baixar PDF** e link **Validar**;
- **Taxa a pagar** (se houver);
- **Contato do órgão**.

Você recebe e-mail quando há pendência, pagamento confirmado e emissão de documento.

### 4.5 Responder pendência

Quando o órgão pede complementação, o processo aparece como **"Pendência – ação necessária"** e o prazo de análise do órgão fica suspenso.

1. Abra o processo e leia o texto em "O órgão ambiental solicitou as informações abaixo".
2. Escreva **Sua resposta**.
3. Use **Anexar arquivo(s)** para enviar os documentos pedidos.
4. Clique em **Enviar resposta ao órgão ambiental**.

> Observe o prazo da pendência (padrão: 30 dias corridos, configurável). Pendência não respondida no prazo pode levar ao arquivamento do processo, conforme a regulamentação do órgão.

### 4.6 Pagar taxas (Pix, boleto ou cartão)

Somente quando o município tiver ativado a cobrança. A ficha do processo mostra **Taxa a pagar** com valor, vencimento e situação:

- **Pix**: leia o QR Code no aplicativo do banco ou use **Copiar código Pix** (Pix copia e cola);
- **Boleto**: **Copiar linha digitável** ou **Abrir boleto**;
- **Pagar (Pix, boleto ou cartão)**: abre a fatura online.

A confirmação é automática; o processo segue para a próxima etapa e você recebe e-mail. O valor é pago diretamente à conta da prefeitura.

> Em ambiente de homologação/treinamento os códigos Pix e boletos são **fictícios** e identificados como "não pague".

### 4.7 Baixar a licença e demais documentos

Na ficha do processo, em **Documentos**, clique em **Baixar PDF**. Todo documento oficial traz número, QR Code, código verificador e informação de assinatura. Guarde o PDF original: ele pode ser conferido no portal (ver 13.3).

### 4.8 Validar um documento

Clique em **Validar** ao lado do documento ou acesse o portal público `/validar` (ver 13.3).

---

## 5. Balcão de atendimento

Para o requerente que comparece ao órgão. Disponível para administrador, técnicos e gestor (não para fiscal e SEMA/INEMA), somente nos municípios do seu escopo.

1. Menu **Processos** → **Novo processo (balcão)**.
2. **Buscar requerente** por nome, razão social ou CPF/CNPJ completo. Se encontrado, clique em **Selecionar** / **Usar o cadastro existente**. Se não, preencha **Cadastrar novo requerente** (tipo de pessoa, nome/razão social, CPF/CNPJ, telefone, endereço opcional) e clique em **Cadastrar e continuar**.
3. Confirme o **Município do processo** e, opcionalmente, o **Responsável técnico**.
4. Siga as mesmas etapas do assistente do requerente (empreendimento, tipologia e porte, tipo de ato, documentos – digitalize os documentos entregues – e revisão).
5. Clique em **Protocolar requerimento**.
6. **Imprimir recibo** / **Gerar recibo de protocolo** e entregue ao requerente.

A tramitação registra "Protocolado no balcão por {nome do servidor}". Se o requerente não possui login, entregue o recibo impresso com o número do processo; ele poderá acompanhar pelo portal público (ver 13.1).

**Registrar resposta de pendência no balcão**: quando o requerente entrega a documentação pessoalmente, o técnico usa o botão **Responder pendência** na ficha do processo ("Resposta do requerente (registro em balcão)") e anexa os arquivos na aba **Documentos**.

[captura de tela: balcão – busca do requerente]

---

## 6. Técnico

Vale para **Técnico municipal** e **Técnico da organização (consórcio)**. O administrador também pode executar todas estas ações.

### 6.1 Caixa de entrada

Menu **Caixa de entrada**: o quadro **Aguardando distribuição** lista os processos protocolados ainda sem técnico; o quadro **Meus processos (por prazo)** lista os processos distribuídos a você, ordenados pelo prazo, com contagem de **vencidos** e **vencendo** e o semáforo. Clique no número para abrir; **Todos os processos** leva à lista completa.

[captura de tela: caixa de entrada do técnico]

### 6.2 Lista de processos e busca

Menu **Processos**: filtros **Município**, **Status**, **Tipo de ato**, **Técnico** (inclusive "Sem técnico") e **Busca** (nº, empreendimento ou requerente). Rascunhos não aparecem por padrão.

### 6.3 A ficha do processo

Cabeçalho: número, tipo de ato, empreendimento, requerente, técnico, **status**, **prazo da etapa** com semáforo e a **barra de ações** (somente os botões permitidos para o seu perfil e para o status atual).

Abas: **Dados · Documentos · Tramitação · Pendências · Checklist · Parecer · Vistorias · Documentos emitidos · Taxas · Log**.

[captura de tela: ficha do processo com as abas]

| Aba | Conteúdo |
|---|---|
| Dados | Dados do processo, empreendimento (link para a ficha), coordenadas, tipologia, porte, potencial poluidor, requerente (CPF/CNPJ mascarado) e RT |
| Documentos | Lista de documentos exigidos com a situação (**Anexado / Faltando / Opcional**), arquivos enviados com data, autor e SHA-256; botão **Anexar documento** |
| Tramitação | Linha do tempo completa: status, data/hora, usuário e despacho (registro imutável) |
| Pendências | Pendências documentais e técnicas, prazos e respostas |
| Checklist | Checklist de análise do tipo de ato |
| Parecer | Pareceres emitidos e formulário **Emitir parecer técnico** |
| Vistorias | Vistorias vinculadas e botão **Registrar vistoria** |
| Documentos emitidos | Recibo, parecer, licença, ofício… com código verificador e **PDF** |
| Taxas | Cobranças do processo (quando a cobrança está ativa) |
| Log | Registros de auditoria relacionados ao processo |

### 6.4 Distribuição

Processos protocolados podem ser distribuídos automaticamente (rodízio entre técnicos do município, quando o município está configurado assim) ou manualmente:

1. Na ficha, clique em **Distribuir**.
2. Em **Técnico responsável**, escolha o técnico ou **"Automático (rodízio entre técnicos do município)"**.
3. Clique em **Confirmar: Distribuir**. O processo passa a **Em triagem**.

O mesmo botão permite **redistribuir** o processo em outras etapas.

### 6.5 Triagem

1. Na aba **Documentos**, confira os documentos exigidos (itens "Faltando" em vermelho).
2. Se estiver completo, clique em **Aceitar (iniciar análise)** (despacho opcional). O processo vai para **Em análise** e o prazo de análise começa (análise curta ou longa, conforme o tipo de ato).
3. Se faltar algo, abra uma pendência documental (6.6).

> Se o município exige pagamento da taxa de análise antes da triagem, o aceite fica bloqueado com a mensagem "Aguardando pagamento da taxa …" até a quitação.

### 6.6 Abrir pendência

1. Clique em **Abrir pendência**.
2. Em **Pendências a comunicar ao requerente**, descreva cada item (use o botão para adicionar mais itens ou **Remover**).
3. Informe o **Prazo para resposta (dias)**.
4. Confirme. O processo vai para **Aguardando requerente**, o requerente recebe e-mail e **o relógio do processo fica pausado** até a resposta. Ao responder, o processo volta à etapa de origem (triagem ou análise) com o saldo de prazo restante.

### 6.7 Checklist de análise

1. Aba **Checklist**: responda cada item (Sim/Não, texto, número ou opção de lista).
2. Salve. O aviso "Itens obrigatórios pendentes" indica o que falta.

> O parecer só pode ser emitido com o checklist completo.

### 6.8 Vistoria técnica do processo

1. Clique em **Agendar vistoria** e informe a **Data prevista** e observações. O processo passa a **Aguardando vistoria**.
2. Em campo, registre a vistoria pelo celular (aba **Vistorias** → **Registrar vistoria**, ver 8.2) – ela fica vinculada ao processo.
3. De volta à ficha, clique em **Concluir vistoria** ("Relato / conclusão da vistoria" – obrigatório se a vistoria não foi registrada no módulo de fiscalização). O processo volta para **Em análise**.

### 6.9 Parecer técnico e condicionantes

1. Clique em **Emitir parecer** (abre a aba **Parecer**).
2. Escolha a **Conclusão**: Favorável, Desfavorável ou Favorável com condicionantes.
3. Redija o **Texto do parecer**.
4. Se houver condicionantes, preencha para cada uma **Descrição**, **Periodicidade** e **Prazo (dias)**.
5. Clique em **Emitir parecer técnico**. O sistema gera o PDF do parecer (numerado, com QR Code) e o processo vai para **Aguardando decisão**.

As condicionantes do parecer são impressas na licença emitida e geram alertas de prazo. [Acompanhamento do cumprimento de condicionantes (registro de entrega/baixa) e fluxo de renovação: previsto para a fase de implantação (até 60 dias).]

### 6.10 Prazos

Menu **Prazos**: abas **Vencidos**, **Vencem em 7 dias**, **Em dia** e **Pausados**, com filtros por **Município** e **Técnico** ("Meus processos", "Todos do meu escopo", "Sem técnico"). Cada linha mostra semáforo, etapa, prazo e saldo de dias.

Prazos-padrão (configuráveis pelo administrador): triagem 5 dias úteis; análise curta 30 dias; análise longa 60 dias; resposta a pendência 30 dias; vistoria 15 dias úteis; decisão 10 dias úteis. Os alertas são enviados alguns dias antes do vencimento (ex.: 5 dias) e ao vencer.

### 6.11 Cadastros

- **Empreendimentos** → **Novo empreendimento**: município, nome, requerente (titular), RT atual, tipologia, grandeza/porte, endereço, ponto no mapa, polígono (desenhar ou importar KML/KMZ/GeoJSON/Shapefile .zip), **Nº do CAR** (botão **Buscar imóvel no CAR neste ponto** consulta o SICAR). Alterar o porte calculado exige **Justificativa do porte**. Trocar o RT encerra o vínculo anterior e mantém o **Histórico de RTs**.
- A **ficha do empreendimento** mostra requerente, RT, localização no mapa, **processos**, **licenças** (com link de autenticidade) e **fiscalizações**.
- **Pessoas** → **Nova pessoa** (PF/PJ; CPF/CNPJ validado e criptografado).
- **Responsáveis técnicos** → **Novo responsável técnico** (formação, conselho, nº de registro, UF).

### 6.12 Mapas

Os mapas têm base **Satélite** (padrão) e **Mapa (OpenStreetMap)** e camadas que podem ser ligadas no controle de camadas: CAR (imóveis rurais), limite do município, divisas, hidrografia, PRODES/DETER, Unidades de Conservação e áreas embargadas do ICMBio. As camadas externas dependem da disponibilidade dos serviços públicos de origem.

---

## 7. Gestor ambiental municipal

### 7.1 Caixa de entrada do gestor

A **Caixa de entrada** do gestor mostra os quadros **Aguardando distribuição** (processos protocolados sem técnico) e **Aguardando decisão** (processos com parecer emitido no seu município).

### 7.2 Distribuir e acompanhar

O gestor pode **Distribuir** processos (ver 6.4), **Aceitar** na triagem e **Arquivar** com justificativa. Use **Prazos** e o **Painel** para acompanhar a equipe.

### 7.3 Decisão (deferir ou indeferir)

1. Abra o processo em **Aguardando decisão** e leia o parecer (aba **Parecer**).
2. **Deferir**: informe o despacho (opcional) e confirme. O documento (licença/autorização/certidão) é **emitido automaticamente** com as condicionantes do parecer e o processo é concluído. Se o parecer for desfavorável, o sistema exibe o alerta "Atenção: o parecer técnico é desfavorável."
3. **Indeferir**: informe a **Motivação do indeferimento** (obrigatória) – ela constará do **ofício de indeferimento** enviado ao requerente.

> Se o botão **Emitir documento** aparecer em processo **Deferido/Indeferido** (por exemplo, quando a taxa de emissão ainda não foi paga), clique nele após a quitação para gerar o documento e concluir o processo.
>
> Quando o município **delega a decisão** ao consórcio (configuração do município), o técnico do consórcio também pode decidir. Tipos de ato que dispensam parecer podem ser decididos diretamente a partir da análise.

### 7.4 Documentos emitidos, cancelamento e substituição

Menu **Documentos emitidos**: filtros por tipo, município, situação (Válido, Cancelado, Substituído), período e busca por nº/código/processo. Na ficha do documento:

- **Abrir PDF** e **Página de validação**;
- **Cancelar documento**: informe o **Motivo do cancelamento** (obrigatório). A ação é irreversível; o PDF não muda, mas a validação pública passa a mostrar **CANCELADO**;
- **Corrigir: emitir substituto**: informe o **Motivo da substituição** e, se necessário, a **Nova validade**. O original passa a **SUBSTITUÍDO** com link para o novo.

Cancelamento e substituição: administrador e gestor.

### 7.5 Assinatura digital

Os documentos são assinados no momento da emissão, na ordem: **e-CPF do servidor que emite → e-CNPJ do órgão (município) → e-CNPJ da organização → assinatura eletrônica avançada** (Lei 14.063/2020, art. 4º, II) quando não houver certificado.

Para assinar com seu próprio certificado:

1. Menu **Meu certificado digital**.
2. Envie o **Arquivo do certificado (.pfx ou .p12)** – A1, com chave privada, até 50 KB – e a **Senha do certificado**.
3. Clique em **Validar e salvar**. O sistema confere o arquivo, a senha e a validade.

Certificados A3 (token/cartão) ainda não são suportados. O sistema avisa 30/15/7/1 dia(s) antes do vencimento do certificado.

### 7.6 Painel de indicadores

Menu **Painel** ("Painel de indicadores"): filtros de município (todos ou um), período, tipo de ato e técnico → **Aplicar**. Mostra:

- processos protocolados, em andamento e concluídos no período, prazo vencido, tempo médio de tramitação;
- **Processos por status** e **Processos por tipo de ato**;
- **Licenças emitidas por tipo e município** e **Licenças vencendo em 90 dias**;
- denúncias recebidas/apuradas, fiscalizações, autos de infração (e valor das multas), notificações;
- alertas de desmatamento novos (satélite);
- **Indicadores por município** (tabela comparativa) e **Adesão dos municípios** (aderido = ao menos 1 usuário municipal ativo e 1 processo protocolado).

[captura de tela: painel de indicadores]

### 7.7 Relatórios

Menu **Relatórios**: todos saem em **PDF** e **XLSX** com cabeçalho institucional, filtros aplicados, data de emissão e usuário:

1. Processos por período, status e tipo;
2. Licenças emitidas e vencimentos;
3. Fiscalização;
4. Produtividade por técnico;
5. Indicadores por município.

### 7.8 Financeiro (taxas)

Menu **Financeiro** ("Financeiro – taxas de licenciamento"): filtros por situação, município, fase e período; totais **Arrecadado**, **Pendente**, **Vencido** e isento. Ações do gestor e do administrador (os demais perfis apenas consultam):

- **Baixa manual**: para pagamentos fora do sistema (DAM pago no banco, dinheiro no caixa, transferência, Pix direto) – informe forma, **Data do pagamento**, **Valor pago (R$)**, descrição (obrigatória) e, opcionalmente, o comprovante; clique em **Registrar baixa**;
- **Isentar**: informe o **Fundamento da isenção** (dispositivo legal) – a etapa do processo é liberada;
- **Cancelar**: informe o motivo (remove também a cobrança no gateway);
- **Tentar novamente** (erro na geração) e **Reenviar ao requerente**;
- **Gerar cobrança** manual na aba **Taxas** do processo.

Pagamentos e isenções ficam registrados na tramitação do processo.

---

## 8. Fiscal ambiental

### 8.1 Visão geral da fiscalização

Menu **Fiscalização**: indicadores (Denúncias novas, Autos de infração, Notificações em aberto) e lista de **Vistorias** com filtros (município, origem, constatação, busca). Submenus: **Denúncias**, **Mapa**, **Monitoramento**; atalhos para **Autos de infração** e **Notificações**.

### 8.2 Registrar vistoria pelo celular (GPS e fotos)

1. Menu **Fiscalização** → **Registrar vistoria** (ou, a partir de uma denúncia/processo, botão **Registrar vistoria**). A origem é definida automaticamente: "Apuração de denúncia", "Vistoria de processo de licenciamento" ou "Fiscalização de rotina".
2. **Município**.
3. **1. Localização**: toque em **📍 Capturar localização** e aguarde "Obtendo sinal de GPS…". O sistema grava latitude, longitude e precisão. Se necessário, use **Capturar novamente** ou **Marcar/ajustar no mapa** (fica registrado "Marcado manualmente no mapa").
4. **2. Fotos**: toque em **📷 Tirar / escolher fotos** (câmera do celular ou galeria), até 20 fotos. Fotos acima de 1,5 MB são reduzidas no aparelho.
5. **3. Constatação e relato**: **Constatação** (Regular, Irregular ou Inconclusiva), **Relato da vistoria** e **Data e hora**.
6. **4. Empreendimento e equipe**: vincule o empreendimento (buscar por nome) e os membros da equipe.
7. Toque em **Salvar vistoria (N fotos)**.

[captura de tela: vistoria no celular – botão Capturar localização]

> Dicas de campo: ative o GPS e permita a localização ao navegador; em área aberta a precisão é melhor. É necessária conexão de dados no momento de salvar – se falhar ("Falha ao salvar. Verifique a conexão e tente novamente."), não feche a tela e tente de novo quando houver sinal. [Modo offline com sincronização posterior: evolução prevista (P2), fora do escopo inicial.]

A ficha da vistoria mostra os dados, as fotos, o ponto no mapa e **Imagens de satélite – antes e depois** (comparação de datas para verificar supressão de vegetação ou obras).

### 8.3 Gerar Auto de Infração

1. Na ficha da vistoria, clique em **Gerar Auto de Infração**.
2. **Autuado** (selecione ou cadastre a pessoa), **Enquadramento legal** (ex.: artigo de lei federal/municipal), **Descrição da infração**, **Penalidade** (advertência, multa, embargo, interdição, outra), valor da multa (se houver) e **Prazo de defesa (dias)**.
3. Clique em **Lavrar auto e gerar PDF**. O auto recebe número `AI-SIGLA-000/ANO`, QR Code e código verificador.

### 8.4 Gerar Notificação

1. Na ficha da vistoria, clique em **Gerar Notificação**.
2. **Notificado**, **Exigência** e **Prazo para atendimento (dias)** (o sistema calcula o **Prazo final**).
3. Clique em **Emitir notificação e gerar PDF** (número `NOT-SIGLA-000/ANO`).

Listas: **Fiscalização → Autos de infração** e **Notificações**. O prazo das notificações gera alertas.

### 8.5 Denúncias

Menu **Denúncias** ("Fila de denúncias ambientais por município"): filtros por município, situação e busca. Situações: **Nova**, **Em apuração**, **Concluída**, **Arquivada**.

- **Registrar denúncia** (recebida presencialmente, por telefone ou outro canal): **Município**, **Canal**, **Descrição**, **Endereço / referência**, **Local no mapa (opcional)**, nome e contato do denunciante (opcionais).
- Na ficha da denúncia: relato, local, fotos, origem (portal, assistente, atendente, interno), **Histórico e despachos**, **Registrar vistoria** e **Alterar situação** (**Nova situação** + **Despacho**). Ao registrar a vistoria, a denúncia passa a "Em apuração".
- Toda mudança de situação é comunicada ao cidadão que deixou contato (WhatsApp/e-mail/chat).

### 8.6 Mapa da fiscalização

Menu **Mapa** ("Mapa da fiscalização"): vistorias e denúncias georreferenciadas, por status e município. Clique no ponto para abrir a ficha.

### 8.7 Monitoramento por satélite

Menu **Monitoramento** ("Monitoramento por satélite"): alertas de desmatamento **DETER** e **PRODES Cerrado** (INPE) no município, cruzados com o **CAR** (SICAR) e com as licenças/autorizações locais. Sincronização automática diária (06:30); **Sincronizar agora** para administrador e técnicos.

- Lista com filtros, indicadores (alertas no período, área total, com imóvel no CAR, sem autorização local) e mapa.
- **Sugestão** do sistema (nunca aplicada automaticamente): autorizado, possível irregularidade, sem CAR, indeterminado. Autorizações estaduais (INEMA/SEIA) não estão no sistema – "possível irregularidade" exige conferência.
- Ficha do alerta: área sobre o satélite, **Comparar imagens (antes/depois)**, imóveis do CAR sobrepostos, empreendimentos e licenças locais relacionados.
- Tratamento: **Colocar em análise**, **Marcar autorizado** (vincular licença/ASV válida), **Marcar irregular** (com constatação), **Descartar** (com motivo), **Reabrir análise** e **Abrir fiscalização** (cria vistoria agendada no local).

Municípios de demonstração (código IBGE fictício) exibem alertas fictícios.

---

## 9. Atendimento e Assistente Ambiental de denúncias

O **Assistente Ambiental** recebe denúncias pelo **WhatsApp** do órgão, pelo **chat do site** (`/denuncia` e portal do órgão) e por **e-mail**. Ele pede o consentimento LGPD, coleta município, tipo, descrição, local (GPS ou endereço), fotos e identificação (ou anonimato), mostra um resumo e só registra com a confirmação do cidadão. O protocolo tem o formato `DEN-SIGLA-000/ANO` e a denúncia entra na fila **Denúncias** como qualquer outra.

Menu **Atendimento**: lista de conversas com filtros (município, canal, situação). Na conversa:

- **Assumir atendimento**: a IA fica pausada (por 3 h) enquanto você atende; escreva em **Responder como atendente** e clique em **Enviar**;
- **Devolver para IA**;
- **Registrar denúncia** / **Criar denúncia manualmente** a partir dos dados coletados;
- **Encerrar** a conversa;
- **Ver conversa** a partir da ficha da denúncia.

Gestor e SEMA/INEMA consultam em modo somente leitura (para SEMA/INEMA o telefone aparece mascarado). Sem a chave de IA configurada, o assistente funciona como questionário passo a passo.

[captura de tela: tela de atendimento com a conversa e os botões Assumir/Devolver]

---

## 10. Demandas urbanas

Serviços simplificados: **Poda/corte de árvore (APC)**, **Som em evento (ASE)** e **Carro de som (ACS)**.

**Cidadão**: no portal, **Serviços** (`/servicos`) → escolha o município → **Ver serviços** → **Solicitar**. O pedido segue o assistente do requerente com os campos específicos do serviço (ex.: espécie, estado/risco, DAP/altura; datas e horários do evento; placa do veículo).

**Equipe** – menu **Demandas urbanas** (fila própria, filtros por serviço, situação, município e técnico; "Minhas demandas"):

1. A distribuição é automática no protocolo (ou **Distribuir (rodízio)**).
2. **Aceitar** (triagem simplificada: "Documentação conferida").
3. **Análise (checklist)** e **Vistoria de campo** quando aplicável (**Concluir vistoria**).
4. **Decisão** pelo próprio técnico do município: **Deferir e emitir autorização** (condicionantes editáveis que constarão da autorização) ou **Indeferir e emitir ofício** (motivação obrigatória).

O prazo é o de análise do tipo de ato; a autorização sai em PDF com QR Code.

---

## 11. Administrador da organização

Menu **Administração** – cartões de configuração. Todas as configurações valem apenas para a sua organização. Toda alteração fica no log de auditoria.

### 11.1 Municípios

Dados do município e do órgão ambiental: nome, **Sigla (3 letras)** (usada na numeração), **Código IBGE**, **Órgão ambiental**, endereço, telefone, e-mail, **URL do brasão** (usado nos PDFs), **Latitude/Longitude da sede**, **Distribuição automática de processos (rodízio entre técnicos)**, **Delega decisão ao técnico do consórcio** e **Município ativo**.

### 11.2 Usuários e papéis

- Lista com filtros (nome/e-mail, papel, município, situação) e colunas de último acesso e troca de senha pendente.
- **Novo usuário**: **Nome completo**, **E-mail (login)**, **CPF (opcional)** (armazenado criptografado), **Papel inicial** e **Município do papel**. Ao criar, o sistema exibe **uma única vez** a senha temporária.
- Ficha do usuário: **Adicionar papel** / **Remover** (papéis por município), **Redefinir senha** (gera senha temporária, desbloqueia a conta e exige troca no próximo acesso), **Desativar usuário** / **Reativar usuário** e "Últimas alterações".
- Usuários **nunca são excluídos** – apenas desativados, preservando o histórico.

### 11.3 Tipos de ato

Sigla, nome, **Categoria** (Licença, Autorização, Certidão, Declaração, Autorização de poda, Autorização de som), **Validade (meses)**, **Exige vistoria**, **Exige parecer técnico antes da decisão**, **Prazo de análise (dias)** (≤ 30 dias = análise curta; acima = análise longa), **Checklist de análise**, **Modelo do documento** e **Ativo**.

### 11.4 Tipologias

Código, descrição, divisão, **Unidade de porte**, **faixas de porte** (micro a excepcional), **potencial poluidor** (baixo, médio, alto) e situação. **Importar CSV** para carga em lote (a partir da tabela oficial adotada, ex.: Resolução CEPRAM nº 4.327/2013 – a validar com SEMA/INEMA).

### 11.5 Documentos exigidos

Por **Tipo de ato** (e, opcionalmente, **Só para a tipologia**): nome do documento, **Obrigatório** e **Formatos** aceitos. É esta lista que o requerente vê na etapa "Documentos".

### 11.6 Checklists

**Novo checklist**: nome e itens (**Descrição do item**, tipo **Sim/Não**, texto ou **Número**, obrigatório, **Opções de resposta** separadas por ";"). Vincule o checklist ao tipo de ato.

### 11.7 Prazos

Configuração **Padrão da organização** e **exceções por município**, para cada etapa: **Triagem**, **Análise curta**, **Análise longa**, **Resposta a pendência**, **Vistoria**, **Decisão** – com dias, **Alerta (dias antes)** e **Contar apenas dias úteis**.

### 11.8 Feriados

Feriados estaduais e municipais (os nacionais são mantidos pela plataforma) – usados na contagem em dias úteis.

### 11.9 Modelos de documento

Modelos HTML personalizados de licença, autorização, certidão, parecer, auto de infração e notificação, com **Variáveis disponíveis**, **Pré-visualizar HTML** e controle de **versões** (**Editar como nova versão**, **Ativar esta versão**). Versões anteriores nunca são alteradas; documentos já emitidos guardam o próprio PDF. Sem modelo personalizado, é usado o modelo padrão do sistema.

### 11.10 Cobrança de taxas e Tabela de taxas

- **Cobrança de taxas (Pix/boleto)**, por município: **Cobrança ativa**, **Bloquear a etapa seguinte até o pagamento**, **Gateway** (Asaas ou guia manual sem gateway), **Chave da API do Asaas** (somente escrita, guardada cifrada), **Sandbox**, **Vencimento (dias)**, **Multa** e **Juros**, **Instruções / base legal**. Botões **Testar conexão**, **Gerar token** do webhook, **Registrar webhook no Asaas** e **Sincronizar pendentes agora**.
- **Tabela de taxas**: valor por **fase** (única, análise, vistoria, emissão) × **tipo de ato** × **porte** × **potencial poluidor**, com **Base legal**; **Simular valor**. A linha mais específica prevalece.

> A taxa é tributo: só cadastre valores instituídos em lei municipal. Sem configuração ativa, nenhuma cobrança é gerada.

### 11.11 Certificados digitais

Envio de certificado **A1** (.pfx/.p12, até 50 KB) + senha, escolhendo o **Titular do certificado**: órgão/município (e-CNPJ), **Todos os órgãos da organização** ou **Servidor** (e-CPF). Lista com emissor, validade (semáforo "Vence em breve" / "Vencido – não é usado"), selo ICP-Brasil, **Testar assinatura** e **Desativar**.

### 11.12 Canais de atendimento

Configuração do Assistente Ambiental: **WhatsApp (Evolution API, Z-API ou Chatwoot/API oficial)**, **chat do site** e **e-mail**. **Criar canal**, **Criar instância / QR Code** (ler no WhatsApp do órgão em Aparelhos conectados), **Mostrar QR Code**, **Enviar mensagem de teste**, **Editar**, **Desativar** e relatório **Consumo de IA**.

### 11.13 Log de auditoria

Filtros por usuário, ação, entidade, origem e período. Cada registro mostra data/hora, usuário, ação, entidade, IP e os dados **Antes** e **Depois**. O log é imutável.

### 11.14 Caixa de e-mails

Consulta dos e-mails enviados pelo sistema (útil em homologação e para conferir notificações).

### 11.15 Backup

Tela **Backup e restauração**: **Último backup** (verde se ≤ 24 h; "ATRASADO" se mais antigo), tamanho, destino, SHA-256, **Próximo backup**, se a **Cópia fora do provedor** está configurada, **Última restauração testada** e histórico. Botões **Executar backup agora**, **Executar teste de restauração agora** e **Registrar teste de restauração manual (checklist completo)**. O backup é diário e o teste de restauração é mensal e automático.

### 11.16 Exportação completa

**Solicitar exportação completa**: gera um ZIP com **um CSV e um JSON por tabela**, **dicionário de dados**, todos os anexos e PDFs e `manifest.json` com hashes SHA-256. Acompanhe a situação (Na fila, Processando, Concluída) e clique em **Baixar ZIP**. Disponível para administrador e SEMA/INEMA; o download fica registrado na auditoria. Dados pessoais cifrados saem cifrados (a chave é entregue ao órgão por canal separado, mediante termo, em caso de migração/rescisão).

### 11.17 Itens previstos para a fase de implantação (até 60 dias)

- Importação de planilhas legadas dos municípios (processos e licenças anteriores);
- Conselhos municipais de meio ambiente (pautas, atas e deliberações);
- Acompanhamento do cumprimento de condicionantes e fluxo de renovação;
- Modelos de Termo de Referência para estudos ambientais;
- Registro de chamados de suporte no próprio sistema e relatório mensal de SLA.

---

## 12. Gestor estadual (SEMA/INEMA)

O perfil **Gestor estadual (SEMA/INEMA)** tem **acesso somente de leitura** a todos os municípios da organização:

- **Painel**, **Processos** (com todas as abas, sem barra de ações), **Prazos**, **Empreendimentos**, **Pessoas**, **Fiscalização**, **Denúncias**, **Mapa**, **Monitoramento**, **Atendimento** (telefone mascarado), **Documentos emitidos**, **Financeiro**;
- **Relatórios** em PDF e XLSX;
- **Administração → Exportação completa** e consulta da tela de backup.

Nenhum botão de ação (distribuir, decidir, emitir, cancelar, alterar situação) é exibido para este perfil.

---

## 13. Portal público

Acessível sem login pela página inicial ou pelo **portal do órgão** (`/orgao/SIGLA`, ex.: `/orgao/LOR`), que mostra números em tempo real (processos em andamento, documentos vigentes, denúncias recebidas) e atalhos para os serviços.

### 13.1 Consultar processo

`/consulta`: informe o **Nº do processo** (ex.: `LOR-2026-000042`) e, opcionalmente, o **CPF/CNPJ do requerente**. O portal mostra situação, município/órgão, empreendimento, requerente (CPF/CNPJ mascarado e nome de pessoa física abreviado), **Linha do tempo** pública e **Documentos públicos emitidos**. Despachos internos e dados pessoais não são exibidos (LGPD).

### 13.2 Licenças emitidas

`/licencas`: transparência ativa – licenças, autorizações e certidões emitidas, com filtros por município, tipo, situação e período, e link **Validar** para cada documento.

### 13.3 Validar documento

`/validar`: digite o **Código verificador** (12 caracteres, formato `XXXX-XXXX-XXXX`; hífens opcionais; não há letras O e I nem números 0 e 1) ou leia o **QR Code** do documento com a câmera do celular. O resultado mostra:

- **"Documento autêntico e válido."**, **"… com prazo de validade expirado"**, **"… CANCELADO pelo órgão emissor"** ou **"… SUBSTITUÍDO por outro"**;
- tipo, número, titular (mascarado), empreendimento, município, validade, emissão, hash SHA-256 e dados da **Assinatura** (ICP-Brasil ou eletrônica avançada);
- **Conferir um arquivo PDF que você recebeu**: selecione o PDF; o navegador calcula o hash e informa "Arquivo íntegro" ou "Arquivo diferente do original".

### 13.4 Denúncia ambiental

`/denuncia`: escolha a **Forma de envio** – conversar com o Assistente Ambiental (chat) ou preencher o formulário: **Município**, **O que está acontecendo?**, **Endereço ou ponto de referência**, **Local no mapa (opcional)** (ou **Usar minha localização**), identificação (ou anônima) e **Telefone ou e-mail** para acompanhar. Clique em **Enviar denúncia** e anote o **protocolo**.

`/denuncia/acompanhar`: informe o **Protocolo** e o **Telefone (com DDD) ou e-mail** usados na denúncia para ver a linha do tempo.

### 13.5 Serviços urbanos

`/servicos`: escolha o município para ver as autorizações urbanas disponíveis (quando pedir, quem pode pedir, documentos, prazo de resposta, validade) e **Solicitar**.

### 13.6 Privacidade e termos

Links **Política de privacidade** (`/privacidade`) e **Termos de uso** (`/termos`) no rodapé do portal.

---

## 14. Perguntas frequentes

**Não consigo entrar: "Conta bloqueada temporariamente".**
Após 5 senhas erradas a conta fica bloqueada por 15 minutos. Aguarde ou peça ao administrador para **Redefinir senha** (a redefinição também desbloqueia).

**Não vejo um processo que sei que existe.**
Verifique o **órgão ativo** e o filtro de **Município** (o filtro padrão é o órgão ativo; escolha "Todos"). Se o processo é de município fora do seu escopo, ele não aparece por segurança.

**Aparece "Acesso negado (403)".**
O registro é de município ou organização fora do seu escopo, ou o seu perfil não permite a ação. Solicite ao administrador o ajuste de papéis, se for o caso.

**O botão de uma ação não aparece.**
Os botões dependem do **status** do processo e do **perfil**. Ex.: o parecer só aparece "Em análise"; o deferimento só com parecer (quando exigido) e para quem decide; o aceite pode estar bloqueado por taxa pendente.

**O parecer não é emitido.**
Há itens obrigatórios do checklist pendentes. Complete a aba **Checklist**.

**O prazo do processo "parou".**
Em **Aguardando requerente** o relógio fica pausado e é retomado, com o saldo, quando a pendência é respondida.

**Emiti um documento com erro. Posso editar?**
Não. Documento emitido é imutável. Use **Corrigir: emitir substituto** (ou **Cancelar documento**) informando o motivo.

**O GPS não captura a localização.**
Permita a localização ao navegador (ícone de cadeado na barra de endereço), ative o GPS do celular e vá para área aberta. Se necessário, use **Marcar/ajustar no mapa**.

**A foto não envia.**
Verifique a conexão. O sistema aceita até 20 fotos por vistoria; fotos grandes são reduzidas automaticamente.

**O requerente não recebeu o e-mail.**
Confira o e-mail cadastrado e a caixa de spam. O administrador pode verificar o envio em **Administração → Caixa de e-mails**.

**O pagamento foi feito mas não baixou.**
A confirmação é automática; há também sincronização diária. Se pago fora do sistema (guia no banco), o gestor faz a **Baixa manual** no **Financeiro**.

**Como o cidadão confirma que uma licença é verdadeira?**
Lendo o QR Code ou digitando o código em `/validar`; também pode enviar o PDF para conferir o hash.

---

## 15. Glossário

| Termo | Definição |
|---|---|
| Ato / tipo de ato | Espécie de documento requerido (LP, LI, LO, LS, LU, LAC, RLO, AA, ASV, Certidão, Declaração, APC, ASE, ACS) |
| APC / ASE / ACS | Autorização de Poda/Corte de Árvore / para Emissão Sonora em Evento / para Carro de Som |
| Assinatura eletrônica avançada | Assinatura sem certificado ICP-Brasil, vinculada ao usuário autenticado, com hash, código verificador e trilha de auditoria (Lei 14.063/2020, art. 4º, II) |
| Auto de infração | Documento que registra infração ambiental e a penalidade (numeração `AI-SIGLA-000/ANO`) |
| CAR / SICAR | Cadastro Ambiental Rural / sistema federal que o mantém (autodeclaratório) |
| Checklist | Roteiro de conferência da análise, por tipo de ato |
| Código verificador | Código de 12 caracteres impresso no documento para validação pública |
| Condicionante | Obrigação imposta ao titular da licença, com periodicidade e prazo |
| DAM | Documento de arrecadação municipal (guia da taxa) – numeração `DAM-SIGLA-000001/ANO` |
| DETER / PRODES | Sistemas do INPE de alerta e de mapeamento anual de desmatamento |
| e-CPF / e-CNPJ | Certificados digitais ICP-Brasil de pessoa física / jurídica (tipo A1 = arquivo) |
| Empreendimento | Atividade/local objeto do licenciamento, vinculado a um requerente |
| Órgão ativo | Município/órgão ambiental escolhido como contexto de trabalho |
| PAdES | Padrão de assinatura digital em PDF |
| Parecer técnico | Manifestação técnica conclusiva (favorável, desfavorável ou com condicionantes) |
| Pendência | Solicitação de complementação ao requerente; pausa o prazo |
| Porte / potencial poluidor | Classificação do empreendimento pela tipologia (micro a excepcional; baixo, médio, alto) |
| Requerente | Pessoa física ou jurídica que pede o ato |
| RT | Responsável técnico (profissional com registro em conselho) |
| Semáforo | Indicação visual do prazo (verde, amarelo, vermelho) |
| SHA-256 (hash) | "Impressão digital" do arquivo; qualquer alteração muda o valor |
| Tipologia | Classificação da atividade (código, porte, potencial poluidor) |
| Tramitação | Histórico imutável das mudanças de situação do processo |

---

## 16. Suporte

| Canal | Contato | Horário |
|---|---|---|
| Portal/e-mail de suporte | [suporte@...] | [dias úteis, 8h às 18h] |
| WhatsApp de suporte | [(00) 00000-0000] | [dias úteis, 8h às 18h] |
| Plantão para incidentes críticos | [telefone/canal] | [24 x 7] |

Ao abrir um chamado, informe: nome, município, perfil, endereço da tela, número do processo/documento (se houver), descrição do problema, data/hora e, se possível, captura de tela. Prazos de atendimento: ver o **Acordo de Nível de Serviço** (`acordo-de-nivel-de-servico.md`).
