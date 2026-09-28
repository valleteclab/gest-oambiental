# Assinatura digital dos documentos oficiais

Todo documento oficial (licença, autorização, certidão, parecer, auto de infração, notificação, ofício, recibo) é emitido por
`emitirDocumento()` (`lib/documentos/emitir.ts`) e sai **assinado**:

| `documento_oficial.assinatura_tipo` | Quando | O que é |
|---|---|---|
| `ICP_BRASIL` | há certificado A1 vigente da cadeia ICP-Brasil (e-CPF do servidor ou e-CNPJ do órgão) | **assinatura qualificada** – PAdES com certificado ICP-Brasil |
| `CERTIFICADO_TESTE` | certificado fora da ICP-Brasil (ex.: `seed:certificado-demo`) | mesma técnica, **sem valor legal** (demonstração/homologação) |
| `ELETRONICA_AVANCADA` | nenhum certificado vigente | **assinatura eletrônica avançada**: usuário autenticado + código verificador + QR + SHA-256 do PDF + trilha de auditoria imutável |

## Base legal

- **MP nº 2.200-2/2001, art. 10**: documentos assinados com certificado ICP-Brasil presumem-se verdadeiros em relação aos
  signatários (§ 1º); outros meios de comprovação de autoria/integridade valem se admitidos pelas partes ou aceitos por quem
  recebe o documento (§ 2º).
- **Lei nº 14.063/2020** (assinaturas eletrônicas em interações com entes públicos), art. 4º:
  - **simples** (I) – identifica o signatário (ex.: login e senha);
  - **avançada** (II) – vinculada ao signatário de modo unívoco, sob seu controle exclusivo, e que permite detectar
    qualquer modificação posterior (é o mecanismo do sistema sem certificado: login pessoal, hash SHA-256 registrado,
    código verificador/QR e log de auditoria imutável);
  - **qualificada** (III) – com certificado ICP-Brasil (MP 2.200-2).
- O art. 5º permite ao ente público definir o nível mínimo por tipo de ato. A qualificada é **obrigatória** em alguns casos
  (ex.: atos de transferência e registro de imóveis – art. 5º, § 2º, IV; atos assinados pelo chefe do Poder – § 2º, I).
  Licenças e demais atos do licenciamento podem usar a **avançada**, mas a **qualificada (ICP-Brasil) é mais forte**:
  presunção legal de autoria e validação independente em qualquer verificador (Adobe, validar.iti.gov.br), sem depender do sistema.

## Como obter o certificado A1 da prefeitura (e-CNPJ)

1. Qualquer Autoridade Certificadora credenciada na ICP-Brasil (lista em gov.br/iti) emite o **e-CNPJ A1** (arquivo `.pfx`,
   validade de 1 ano; ~R$ 200–400/ano). O titular é o CNPJ da prefeitura ou do fundo/secretaria; o responsável legal
   (prefeito ou representante) faz a validação presencial ou por videoconferência.
2. Escolha **A1** (arquivo). Tokens/cartões **A3** não são suportados (ver roadmap).
3. Na instalação, exporte o certificado **com a chave privada** para `.pfx`/`.p12` e defina uma senha forte.
4. Servidores podem usar o próprio **e-CPF A1** – os documentos que emitirem saem assinados em nome deles.

## Cadastro no LicenciaGov

- **Administração → Certificados digitais** (`/admin/certificados`, só ADMIN, restrito à organização): envio do `.pfx`
  (máx. 50 KB) + senha + titular: **órgão (e-CNPJ)** de um município ou de toda a organização, ou **servidor (e-CPF)** de um
  usuário da organização. O arquivo é aberto com a senha antes de salvar (senha errada, arquivo inválido, sem chave privada,
  vencido ou ainda não válido → erro). Um ativo por titular: o anterior é desativado. Lista com titular, emissor, série,
  SHA-1, semáforo de validade ("vence em N dias"), selo ICP-Brasil, **Testar assinatura** (baixa um PDF de amostra assinado,
  para abrir no Adobe Reader ou no validar.iti.gov.br) e **Desativar**.
- **Meu certificado** (`/minha-conta/certificado`): o próprio servidor (perfis que emitem documentos) envia o seu e-CPF.
- Ordem de uso na emissão: **e-CPF do servidor que emite → e-CNPJ do órgão do documento → e-CNPJ da organização →
  assinatura eletrônica avançada**. Certificado vencido é ignorado (a emissão segue com o próximo da ordem) e aparece em
  vermelho no admin; o motor de alertas avisa admins (e o dono do e-CPF) a 30/15/7/1 dia(s) do vencimento
  (`CERTIFICADO_VENCENDO`).
- Se um certificado **vigente** não puder ser aberto (ex.: `DATA_KEY` trocada) ou a assinatura falhar, a emissão é
  **interrompida** com mensagem clara – nunca sai um documento "meio assinado".

## O que o PDF mostra

- Assinatura **PAdES-B-B** (`/SubFilter /ETSI.CAdES.detached`): CMS destacado com `contentType`, `messageDigest` (SHA-256)
  e `signingCertificateV2`, RSA-SHA256, cadeia do `.pfx` embutida; horário declarado no `/M`. Campo de assinatura invisível.
- Selo visual no bloco de assinatura ("Assinado digitalmente – ICP-Brasil", titular, e-CPF/e-CNPJ mascarado, emissor, data) e,
  no rodapé de todas as páginas: *"Documento assinado digitalmente por {titular} – {e-CNPJ} (ICP-Brasil) em {data e hora},
  conforme MP 2.200-2/2001 e Lei 14.063/2020. Verifique em {URL de validação} e em https://validar.iti.gov.br"*.
- Sem certificado: *"Assinado eletronicamente por {nome}, {cargo}, em {data e hora} – assinatura eletrônica avançada (Lei
  14.063/2020, art. 4º, II) …"*. Modelos HTML personalizados podem usar `{{assinatura_texto}}`.
- O `sha256_pdf` registrado é o do arquivo **já assinado**. O documento continua imutável.

## Validação

- `/validar/{código}` (e `GET /api/v1/public/validar/{código}`) mostra a seção **Assinatura**: "Assinatura digital: ICP-Brasil –
  {titular} ({documento mascarado}), emissor, válido até, assinado em" ou "Assinatura eletrônica avançada – {nome}", com link
  para o validador do ITI. A página também confere, no navegador, o SHA-256 de um PDF enviado pelo cidadão.
- **validar.iti.gov.br**: envie o PDF; o ITI verifica integridade, cadeia ICP-Brasil e revogação. Observação: a assinatura
  ainda não inclui o identificador de **política de assinatura ICP-Brasil (PA_PAdES_AD_RB, DOC-ICP-15.03)**; o validador
  confirma integridade e cadeia, mas pode indicar "sem política". Incluir a política é o próximo passo (roadmap).
- Adobe Acrobat Reader: painel **Assinaturas** (para "confiável", a cadeia ICP-Brasil precisa estar na lista de confiança).

## Segurança

- `.pfx` (base64) e senha cifrados em repouso com AES-256-GCM (`cifrar`, chave `DATA_KEY`); CPF/CNPJ do titular também cifrado.
- Decifrados só em memória no momento de assinar; nunca logados, auditados ou devolvidos por página/API (as consultas
  selecionam apenas campos públicos). Auditoria: `CADASTRAR_CERTIFICADO`, `DESATIVAR_CERTIFICADO`, `TESTAR_CERTIFICADO`
  (sem segredos) e `EMITIR_DOCUMENTO` com `assinatura_tipo`/`certificado_id`.
- Trocar a `DATA_KEY` torna os certificados ilegíveis → reenvie-os (a emissão avisa).
- Exportação/portabilidade: a tabela `certificado_digital` **não** deve ser exportada (contém chave privada cifrada).

## Demonstração

`npm run seed:certificado-demo` (deploy: `SEED_CERTIFICADO_DEMO=true`) cria um e-CNPJ **de teste** ("CERTIFICADO DE TESTE –
SEM VALOR LEGAL", AC de teste do LicenciaGov) para Lagoa do Orvalho e Riachão das Neves (se existir). Idempotente. Fora do
fluxo dos E2E. Nunca usar em produção.

## Roadmap (não implementado)

- **Assinatura gov.br** (API de assinatura eletrônica avançada do ITI): o órgão assina termo de adesão com o ITI; cada
  signatário autoriza via OAuth gov.br (conta prata/ouro) e o hash é assinado pelo serviço.
- **A3 (token/cartão)**: exige assinador desktop/extensão local (a chave não sai do dispositivo) – ex.: fluxo "hash → assinador
  local → CMS devolvido ao servidor".
- Política de assinatura ICP-Brasil (AD-RB), carimbo do tempo (AD-RT) e múltiplas assinaturas (e-CNPJ + e-CPF no mesmo PDF,
  com atualização incremental).
