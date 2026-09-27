// Dicionário de dados gerado a partir do DMMF do Prisma (SPEC 9.2 – exportação completa).
import { Prisma } from "@prisma/client";

/** Colunas que NUNCA saem na exportação (segredos). */
export const COLUNAS_EXCLUIDAS: Record<string, string[]> = {
  Usuario: ["senha_hash"],
};

/** Colunas exportadas CIFRADAS (AES-256-GCM, formato v1:iv:tag:dados). Decifrar exige a DATA_KEY do órgão. */
export const COLUNAS_CIFRADAS: Record<string, string[]> = {
  Usuario: ["cpf_cifrado"],
  Pessoa: ["cpf_cnpj_cifrado", "email (quando PF)", "telefone (quando PF)"],
  Denuncia: ["contato"],
};

export const DESCRICAO_TABELA: Record<string, string> = {
  Organizacao: "Consórcio/organização titular do sistema.",
  Municipio: "Municípios consorciados (tenant); todo registro de negócio pertence a um município.",
  Usuario: "Usuários do sistema (internos e requerentes). senha_hash NÃO é exportado.",
  UsuarioPapel: "Papéis (perfis) do usuário, opcionalmente restritos a um município.",
  Tipologia: "Tipologias de atividades licenciáveis (CEPRAM 4.327/2013), faixas de porte e potencial poluidor.",
  TipoAto: "Tipos de ato administrativo (LP, LI, LO, AA, certidões…), validade e prazos de análise.",
  DocumentoExigido: "Documentos exigidos por tipo de ato/tipologia.",
  ChecklistModelo: "Modelos de checklist de análise.",
  PrazoConfig: "Prazos por etapa (dias, dias de alerta, dias úteis); município sobrepõe organização.",
  Feriado: "Feriados (nacionais quando municipio_id nulo) usados no cálculo de dias úteis.",
  ModeloDocumento: "Modelos HTML dos documentos oficiais.",
  Sequencia: "Sequenciais de numeração por município/tipo/ano.",
  Pessoa: "Pessoas físicas e jurídicas (requerentes, autuados, RTs). Dados pessoais de PF cifrados.",
  ResponsavelTecnico: "Responsáveis técnicos e registro no conselho profissional.",
  Empreendimento: "Empreendimentos/atividades, localização, tipologia, porte e potencial poluidor.",
  EmpreendimentoRt: "Vínculo histórico entre empreendimento e responsável técnico.",
  Processo: "Processos de licenciamento, status, etapa, prazos e responsáveis.",
  Tramitacao: "Linha do tempo imutável do processo (transições de status e despachos).",
  Anexo: "Arquivos enviados (processo, pendência, fiscalização). Conteúdo em anexos/{storage_key}.",
  Pendencia: "Pendências/exigências ao requerente e respostas.",
  ChecklistPreenchido: "Checklists de análise preenchidos.",
  Parecer: "Pareceres técnicos.",
  Condicionante: "Condicionantes das licenças e situação de cumprimento.",
  DocumentoOficial: "Documentos oficiais emitidos (licenças, autos, notificações…), com hash do PDF e código verificador. PDF em anexos/{storage_key}.",
  Denuncia: "Denúncias ambientais recebidas.",
  Fiscalizacao: "Fiscalizações/vistorias com geolocalização.",
  AutoInfracao: "Autos de infração.",
  Notificacao: "Notificações ambientais e prazos.",
  Conselho: "Conselhos municipais de meio ambiente.",
  ReuniaoConselho: "Reuniões dos conselhos e deliberações.",
  Alerta: "Alertas de prazo gerados pelo motor de prazos.",
  EmailEnviado: "Trilha de e-mails transacionais enviados.",
  LogAuditoria: "Log de auditoria imutável de todas as ações.",
  Exportacao: "Solicitações de exportação completa (portabilidade).",
  BackupRegistro: "Registros de backups e testes de restauração.",
  ChamadoSuporte: "Chamados de suporte (SLA).",
};

const DESCRICAO_COLUNA: Record<string, string> = {
  id: "Identificador único (UUID).",
  created_at: "Data/hora de criação (UTC).",
  updated_at: "Data/hora da última alteração (UTC).",
  created_by: "Usuário que criou o registro.",
  organizacao_id: "Organização (consórcio).",
  municipio_id: "Município ao qual o registro pertence.",
  processo_id: "Processo relacionado.",
  usuario_id: "Usuário relacionado.",
  pessoa_id: "Pessoa relacionada.",
  status: "Situação do registro.",
  numero: "Número oficial.",
  latitude: "Latitude (WGS84, graus decimais).",
  longitude: "Longitude (WGS84, graus decimais).",
  storage_key: "Chave do arquivo no storage; conteúdo em anexos/{storage_key} no ZIP.",
  sha256: "Hash SHA-256 do arquivo.",
  sha256_pdf: "Hash SHA-256 do PDF emitido.",
  prazo_ate: "Data-limite.",
  prazo_etapa_ate: "Data-limite da etapa atual do processo.",
  validade_ate: "Fim da validade do documento.",
  cpf_cnpj_hash: "HMAC-SHA256 do CPF/CNPJ (busca/unicidade sem expor o valor).",
  cpf_hash: "HMAC-SHA256 do CPF (busca/unicidade).",
  cpf_cnpj_mascara: "CPF/CNPJ mascarado para exibição pública.",
  codigo_verificador: "Código de autenticidade exibido no documento e em /validar.",
};

export type ColunaDicionario = {
  coluna: string;
  campo_prisma: string;
  tipo: string;
  obrigatorio: boolean;
  lista: boolean;
  chave_primaria: boolean;
  unico: boolean;
  padrao: string | null;
  referencia: string | null;
  cifrada: boolean;
  descricao: string;
};
export type TabelaDicionario = { tabela: string; modelo: string; descricao: string; colunas: ColunaDicionario[] };

export function modelos() {
  return Prisma.dmmf.datamodel.models;
}

export const nomeTabela = (m: { name: string; dbName: string | null }) => m.dbName ?? m.name;

/** Campos escalares/enum exportados de um modelo (sem os excluídos). */
export function camposExportados(m: (typeof Prisma.dmmf.datamodel.models)[number]) {
  const excl = COLUNAS_EXCLUIDAS[m.name] ?? [];
  return m.fields.filter((f) => (f.kind === "scalar" || f.kind === "enum") && !excl.includes(f.name));
}

export function gerarDicionario(): { tabelas: TabelaDicionario[]; enums: { nome: string; valores: string[] }[] } {
  const ms = modelos();
  const tabelas = ms.map((m) => {
    const fks = new Map<string, string>();
    for (const f of m.fields) {
      if (f.kind === "object" && f.relationFromFields?.length) {
        const alvo = ms.find((x) => x.name === f.type);
        f.relationFromFields.forEach((col, i) => fks.set(col, `${alvo ? nomeTabela(alvo) : f.type}.${f.relationToFields?.[i] ?? "id"}`));
      }
    }
    const cifradas = (COLUNAS_CIFRADAS[m.name] ?? []).map((c) => c.split(" ")[0]);
    const colunas: ColunaDicionario[] = camposExportados(m).map((f) => {
      const cifrada = cifradas.includes(f.name);
      const padrao = f.hasDefaultValue ? (typeof f.default === "object" && f.default && "name" in f.default ? `${(f.default as { name: string }).name}()` : JSON.stringify(f.default)) : null;
      const desc = DESCRICAO_COLUNA[f.name] ?? (f.name.endsWith("_id") ? `Referência a ${fks.get(f.name) ?? f.name.replace(/_id$/, "")}.` : "");
      return {
        coluna: f.dbName ?? f.name,
        campo_prisma: f.name,
        tipo: f.kind === "enum" ? `enum ${f.type}` : f.type,
        obrigatorio: f.isRequired,
        lista: f.isList,
        chave_primaria: f.isId,
        unico: f.isUnique,
        padrao,
        referencia: fks.get(f.name) ?? null,
        cifrada,
        descricao: [desc, cifrada ? "CIFRADO (AES-256-GCM) – exportado como está no banco." : ""].filter(Boolean).join(" "),
      };
    });
    return { tabela: nomeTabela(m), modelo: m.name, descricao: DESCRICAO_TABELA[m.name] ?? "", colunas };
  });
  const enums = Prisma.dmmf.datamodel.enums.map((e) => ({ nome: e.name, valores: e.values.map((v) => v.name) }));
  return { tabelas, enums };
}

export function dicionarioMarkdown(d: ReturnType<typeof gerarDicionario>, geradoEm: Date): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const l: string[] = [
    "# Dicionário de dados – LicenciaGov",
    "",
    `Gerado em ${geradoEm.toISOString()} a partir do esquema Prisma. Um arquivo CSV (UTF-8 com BOM, separador \`;\`) e um JSON por tabela em \`tabelas/\`.`,
    "",
    "- Datas/horas em ISO 8601 UTC; decimais com ponto; JSON serializado como texto no CSV.",
    "- `usuario.senha_hash` **não** é exportado (segredo).",
    "- Colunas marcadas como **cifradas** saem como estão no banco (AES-256-GCM, `v1:iv:tag:dados`); decifrar exige a `DATA_KEY` do órgão, entregue por canal separado.",
    "- Arquivos (anexos e PDFs de documentos oficiais) em `anexos/{storage_key}`; hashes em `manifest.json`.",
    "",
    "## Tabelas",
    "",
    ...d.tabelas.map((t) => `- [${t.tabela}](#${t.tabela}) – ${t.descricao}`),
    "",
  ];
  for (const t of d.tabelas) {
    l.push(`## ${t.tabela}`, "", t.descricao, "", "| Coluna | Tipo | Obrig. | PK | Único | Referência | Descrição |", "|---|---|---|---|---|---|---|");
    for (const c of t.colunas) {
      l.push(`| ${c.coluna} | ${esc(c.tipo)}${c.lista ? "[]" : ""} | ${c.obrigatorio ? "sim" : "não"} | ${c.chave_primaria ? "sim" : ""} | ${c.unico ? "sim" : ""} | ${c.referencia ?? ""} | ${esc(c.descricao)} |`);
    }
    l.push("");
  }
  l.push("## Enumerações", "");
  for (const e of d.enums) l.push(`- **${e.nome}**: ${e.valores.join(", ")}`);
  l.push("");
  return l.join("\n");
}
