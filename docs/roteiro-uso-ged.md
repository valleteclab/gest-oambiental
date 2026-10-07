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
1. **Importar ZIP** → envie um ZIP com subpastas (ex.: `Licitação/2026/edital.pdf`).
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

## Roteiro rápido de apresentação (15 min)
1. Login e visão geral (1 min)
2. Importar ZIP de uma pasta digitalizada (3 min)
3. Busca pelo conteúdo, incluindo o scan com OCR (3 min)
4. Trâmite entre dois servidores (2 min)
5. Assinatura com dois signatários e verificação pública (4 min)
6. Logs com o auditor e isolamento com o outro cliente (2 min)

## O que ainda não existe
Upload de imagens e Word, scanner direto pela web (agente local), metadados por IA, portal do cliente, pacote de fechamento mensal, temporalidade e retenção, motor de anonimização.
