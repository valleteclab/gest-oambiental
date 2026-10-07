# Gestão de Documentos – roteiro de uso e demonstração

Guia de apresentação do módulo, funcionalidade por funcionalidade. Ambiente de demonstração com dados **fictícios**.

- Site: https://licenciagov.valleteclab.com.br (na tela de login, deixe "Escolher depois de entrar")
- Senha de todos os usuários: `Demo@2026licencia`
- Cliente 1: Câmara Municipal de Vale das Acácias (DEMO) – `admin.vac@`, `gestor.vac@`, `servidor1.vac@`, `servidor2.vac@`, `vereador.vac@`, `auditor.vac@` (`@gestaodocumentos.demo`)
- Cliente 2: Autarquia de Águas do Cerrado (DEMO) – `admin.aac@`, `gestor.aac@`, `servidor.aac@` (`@gestaodocumentos.demo`)

## Visão geral: o que o módulo entrega
Um repositório digital de documentos por órgão, com busca pelo conteúdo, tramitação, assinatura digital, trilha de auditoria e separação total entre clientes. Cada órgão é um cliente isolado da mesma plataforma.

## 1. Cadastro e organização de documentos
**Para quê:** guardar cada documento com número, tipo, remetente, data e sensibilidade, em pastas.
**Como mostrar (admin.vac@):**
1. Menu **Documentos** → lista com número (ex.: `VAC-DOC-2026-000013`), tipo, status e sensibilidade.
2. **Novo** → envie um PDF, escolha tipo, pasta, remetente e sensibilidade (público, interno, restrito, sigiloso).
3. Abra o documento: ficha com versões, histórico, marcadores e abas de trâmite, comentários e logs.
4. **Pastas** → árvore de pastas; as permissões de uma pasta valem para o que está dentro (herança).
**Ponto forte:** nova versão do arquivo preserva as anteriores; nada se perde.

## 2. Busca por conteúdo
**Para quê:** achar o documento pelo texto que está dentro do PDF, sem lembrar o título.
**Como mostrar:** em **Documentos**, busque uma palavra do corpo do documento, com e sem acento. Os resultados mostram o trecho encontrado. Só aparecem documentos que o usuário tem permissão de ver.

## 3. Importação em lote (ZIP) – o fluxo de "cópia mensal"
**Para quê:** subir de uma vez as pastas digitalizadas do mês.
**Como mostrar (admin.vac@):**
1. **Importar pasta/ZIP** → na aba **Enviar pasta** (recomendada) escolha ou arraste a pasta do mês (ex.: `LICITAÇÃO-AGOSTO-2026`) sem zipar; confira o resumo (PDFs, ZIPs duplicados que não serão enviados, formatos ignorados) e clique em **Enviar pasta**. Se a internet cair, o lote fica "Aguardando envio": abra-o e escolha a mesma pasta de novo (só o que faltou é enviado). Pacotes já zipados: aba **Enviar ZIP** (até ~2 GB, em partes). Pastas repetidas (A/A) são mantidas; marque "Unir pastas repetidas" só se quiser colapsá-las.
2. As pastas viram a árvore do GED; acompanhe o andamento e o relatório por arquivo.
3. Reenvie o mesmo ZIP: tudo aparece como duplicado (comparação por hash).
**Observação:** hoje só PDF; outros arquivos aparecem como "ignorado".

## 4. OCR de documentos digitalizados
**Para quê:** deixar pesquisável o PDF que é só imagem.
**Como mostrar:** envie um PDF escaneado; na ficha acompanhe o estado (pendente, processando, concluído). Depois busque uma palavra que só existe dentro do scan. O arquivo original continua guardado e há botão "Reprocessar OCR". A cota mensal de páginas fica em **Admin → Configurações**.

## 5. Permissões e sigilo
**Para quê:** cada pessoa vê só o que deve.
**Como mostrar:** papéis Administrador, Gestor, Usuário, Leitor e Auditor. Compare a lista de `admin.vac@` com a de `servidor1.vac@`. Documentos sigilosos exigem permissão explícita: nem o administrador os vê sem ela. Setores e permissões por pasta ou documento ficam no painel de acesso.

## 6. Editor de documentos
**Para quê:** redigir ofícios e memorandos dentro do sistema.
**Como mostrar (servidor1.vac@):** **Editor** → crie um texto, formate, salve e gere o PDF, que entra como documento com número.

## 7. Trâmite digital e comentários
**Para quê:** encaminhar o documento entre setores e pessoas, com histórico.
**Como mostrar:** `servidor1.vac@` tramita para `servidor2.vac@` com despacho; `servidor2.vac@` vê na caixa de entrada e comenta. O histórico de trâmite e os comentários **não podem ser alterados nem apagados**.

## 8. Assinatura digital
**Para quê:** colher assinaturas de várias pessoas, em ordem ou em paralelo.
**Como mostrar:**
1. `gestor.vac@` solicita assinatura de `vereador.vac@` e do próprio gestor.
2. Cada signatário assina em **Assinaturas**, confirmando com a senha (ou recusa com justificativa).
3. Ao concluir, o PDF final é selado com o certificado do órgão e ganha um QR em todas as páginas.
4. Abra `/verificar/<código>` sem login: a página confere o documento e permite arrastar o arquivo para comparar o hash no navegador.
5. Subir uma nova versão cancela a solicitação em aberto.
**Observação:** o certificado da demonstração é de teste, sem valor legal.

## 9. Notificações
**Para quê:** avisar por e-mail (e WhatsApp, se a pessoa autorizar) sobre pedidos de assinatura, trâmites e prazos.
**Como mostrar:** **Minha conta → Notificações** para escolher canais. Os e-mails trazem "Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)" e não levam o arquivo anexo, só o link.

## 10. Logs e auditoria
**Para quê:** saber quem viu, alterou ou enviou o quê.
**Como mostrar (auditor.vac@):** **Logs** → acessos, alterações e comunicações, com filtros. Cada documento também tem a aba de logs própria.

## 11. Administração do cliente
**Como mostrar (admin.vac@):** **Admin** → membros e papéis, setores, tipos de documento, marcadores, canais de envio, certificado digital, exportação dos dados e configurações (cota de OCR).

## 12. Isolamento entre clientes (o argumento de venda)
**Como mostrar:** entre como `admin.aac@`. Nenhum documento da Câmara aparece, nem na busca, nem em links diretos (o sistema responde "não encontrado"). A separação é garantida no código e no banco de dados, e vale também para arquivos e exportações.

## 13. Protocolo: entrada, saída, controle interno e portal do cidadão
**Para quê:** dar número, data e comprovante a tudo que entra, sai ou circula, e deixar o cidadão ou o fornecedor entregar documentos sem ir ao balcão.
**Como mostrar (servidor1.vac@):**
1. Menu **Protocolo** → o livro, com filtros por livro (entrada, saída, interno), ano, situação, setor e busca (inclusive por CPF/CNPJ).
2. **Novo protocolo** → *Entrada*: remetente, assunto, destino (setor ou pessoa) e os PDFs. Ao registrar saem o número (`PROT-ENT-2026-…`) e o **comprovante em PDF** (CPF/CNPJ mascarado, lista de arquivos com hash, QR). Repita com *Saída* e *Interno*.
3. Abra o protocolo: andamento, anexos (que já seguiram ao setor pelo trâmite) e ações — iniciar análise, encaminhar, responder, devolver ou indeferir (com justificativa) e arquivar. O histórico não pode ser alterado.
**Portal do cidadão (sem login):** abra `/protocolo/vale-das-acacias-demo`, preencha como cidadão (CPF válido fictício, e-mail, assunto, descrição, um PDF, aceite da LGPD) e envie. A tela mostra o **número** e o **código de consulta** e oferece o comprovante. Em **Acompanhar** informe número e código: aparecem a situação e o andamento, sem dados pessoais. Respondendo o protocolo como servidor, o cidadão vê a resposta e recebe o e-mail ("Enviado em dd/mm/aaaa às HH:mm (horário de Brasília)", sem anexo).
**Verificação pública:** leia o QR do comprovante (ou abra `/verificar/protocolo/<código>`): o site mostra órgão, número, data e situação e confere o arquivo; arrastar o PDF recebido compara o hash no navegador, e um byte alterado falha.
**Ligar o portal de outro órgão (admin.aac@):** **Administração → Configurações → Protocolo online**: endereço público, responsável, orientação, limites e assuntos. Vem desligado; enquanto estiver, o endereço responde "não encontrado".
**Ponto forte:** cada cliente tem seu próprio livro e numeração; um órgão nunca enxerga o protocolo do outro, nem pelo portal.

## 14. Baixar pasta como ZIP (prestação de contas no TCM-BA)
**Para quê:** levar a pasta do mês, com as subpastas, para subir no SIGA/e-TCM.
**Como mostrar (admin.vac@):**
1. **Pastas** → escolha a pasta (ex.: *Processos de pagamento*) → **Baixar pasta (ZIP)**. O arquivo se chama `NOME-AAAA-MM-DD.zip`.
2. Abra o ZIP: a mesma árvore de pastas, os PDFs com o nome do envio original (repetidos viram `nome (2).pdf`), mais `MANIFESTO.csv` (número, título, tipo, data, sha256, tamanho, páginas, assinatura) e `LEIAME.txt` (data/hora de Brasília, quem exportou).
3. Entre como `servidor1.vac@`: documentos sigilosos que ele não pode ver ficam de fora e o manifesto só diz "omitido: sem permissao", sem título. Em **Logs** aparecem a exportação e um "Baixou" por documento.
**Atenção:** o TCM-BA exige PDF digitalizado abaixo de 250 DPI. O sistema **não** confere a resolução (a coluna `dpi_ok` diz "nao verificado"): confira antes de enviar. Acima de 20.000 documentos, baixe por subpasta.

## Roteiro rápido de apresentação (15 min)
1. Login e visão geral (1 min)
2. Importar uma pasta digitalizada (ou um ZIP) (3 min)
3. Busca pelo conteúdo, incluindo o scan com OCR (3 min)
4. Trâmite entre dois servidores (2 min)
5. Assinatura com dois signatários e verificação pública (4 min)
6. Logs com o auditor e isolamento com o outro cliente (2 min)
7. (opcional, +3 min) Protocolo: registrar uma entrada no balcão, protocolar pelo portal do cidadão e verificar o comprovante pelo QR

## O que ainda não existe
Upload de imagens e Word, scanner direto pela web (agente local), metadados por IA, portal do cliente para consulta de documentos publicados (o protocolo online já existe), pacote de fechamento mensal (hoje há o ZIP por pasta, sem verificação de DPI), temporalidade e retenção, motor de anonimização. No protocolo: busca por nome do interessado, anexar arquivos depois de registrado, WhatsApp ao cidadão e captcha.
