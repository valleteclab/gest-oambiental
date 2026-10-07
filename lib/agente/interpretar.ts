// Interpretação DETERMINÍSTICA (sem IA) de uma mensagem, conforme o campo perguntado por último.
// É o modo "questionário passo a passo" quando não há OPENROUTER_API_KEY e também o caminho rápido
// (botões, números, "pular") no modo IA. Regras ancoradas na mensagem inteira – nada de "contém a palavra sim".
import { normalizarContato } from "../canais/contato";
import { IDS_TIPOS, RE_PROTOCOLO, TIPOS_OCORRENCIA, detectarTipo, type Campo, type DadosColetados, type Extracao } from "./tipos";

const limpar = (t: string) => t.trim().replace(/[.!?…\s]+$/g, "").trim();

export const RE_SIM = /^(1|sim|s|ss|concordo|aceito|ok|okay|pode|pode sim|claro|quero|confirmo|confirmar|correto|certo|isso|isso mesmo|t[aá] certo|est[aá] certo|pode registrar|registra|registrar|positivo|beleza|blz|👍)$/i;
export const RE_NAO = /^(2|n|n[aã]o|nao quero|n[aã]o concordo|negativo|errado|corrigir|alterar|mudar|n[aã]o est[aá] certo)$/i;
export const RE_PULAR = /^(pular|pula|n[aã]o|n[aã]o tem|nao tem|n[aã]o sei|sem refer[eê]ncia|nenhum|nenhuma|sem foto|sem fotos|n[aã]o tenho( foto)?|pronto|continuar|seguir|s[oó] isso|ok|pode seguir)$/i;
export const RE_SAIR = /^\/?(sair|cancelar|encerrar|parar|stop)$/i;
export const RE_SAUDACAO = /^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|hey|hello|oi,? tudo bem|ol[aá],? tudo bem)$/i;
export const RE_OBRIGADO = /^(obrigad[oa]|muito obrigad[oa]|valeu|vlw|grat[oa]|agrade[cç]o|obg)$/i;
export const RE_EMERGENCIA = /(pegando fogo agora|fogo (se )?espalhando|inc[eê]ndio (agora|se espalhando|perto de casa|chegando)|pessoa(s)? (ferida|presa|machucada)|risco de vida|explos[aã]o|desabamento|vazamento de g[aá]s|afogando|socorro)/i;

export const ehSaudacao = (t: string) => RE_SAUDACAO.test(limpar(t));
export const ehAgradecimento = (t: string) => RE_OBRIGADO.test(limpar(t));
export const ehSair = (t: string) => RE_SAIR.test(limpar(t));
export const ehEmergencia = (t: string) => RE_EMERGENCIA.test(t);
export const protocoloNoTexto = (t: string) => RE_PROTOCOLO.exec(t)?.[0]?.toUpperCase() ?? null;

/** Número isolado ("3", "3.", "opção 3") → inteiro. */
function numero(t: string): number | null {
  const m = /^(?:op[cç][aã]o\s*)?(\d{1,2})[.)]?$/i.exec(limpar(t));
  return m ? Number(m[1]) : null;
}

/** "1" com botões [a,b] → "a". Também aceita o rótulo exato do botão. */
export function resolverBotao(texto: string | null, dados: DadosColetados, rotulos: Record<string, string> = {}): string | null {
  if (!texto || !dados.botoes?.length) return null;
  const n = numero(texto);
  if (n && n >= 1 && n <= dados.botoes.length) return dados.botoes[n - 1];
  const t = limpar(texto).toLowerCase();
  return dados.botoes.find((id) => rotulos[id]?.toLowerCase() === t) ?? null;
}

/** Interpreta texto livre para o campo perguntado. */
export function interpretarTexto(texto: string, dados: DadosColetados, ctx: { municipios?: { id: string; nome: string }[] } = {}): Extracao {
  const t = texto.trim();
  const e: Extracao = {};
  const prot = protocoloNoTexto(t);
  if (prot) e.quer_consultar_protocolo = prot;
  if (ehEmergencia(t)) e.emergencia = true;
  const campo = dados.perguntou;
  const n = numero(t);
  switch (campo) {
    case "confirmacao":
      if (RE_SIM.test(limpar(t))) e.confirma = true;
      else if (RE_NAO.test(limpar(t))) e.confirma = false;
      break;
    case "correcao": {
      const mapa: Record<number, Campo> = { 1: "tipo_ocorrencia", 2: "descricao", 3: "localizacao", 4: "fotos", 5: "identificacao" };
      if (n && mapa[n]) e.corrigir_campo = mapa[n];
      else if (/tipo/i.test(t)) e.corrigir_campo = "tipo_ocorrencia";
      else if (/descri/i.test(t)) e.corrigir_campo = "descricao";
      else if (/local|endere/i.test(t)) e.corrigir_campo = "localizacao";
      else if (/foto/i.test(t)) e.corrigir_campo = "fotos";
      else if (/identifica|nome|an[oô]nim/i.test(t)) e.corrigir_campo = "identificacao";
      break;
    }
    case "municipio": {
      const lista = ctx.municipios ?? [];
      if (n && n >= 1 && n <= lista.length) e.municipio_indice = n - 1;
      else {
        const i = lista.findIndex((m) => m.nome.toLowerCase() === limpar(t).toLowerCase());
        if (i >= 0) e.municipio_indice = i;
      }
      break;
    }
    case "tipo_ocorrencia":
      if (n && n >= 1 && n <= TIPOS_OCORRENCIA.length) e.tipo_ocorrencia = IDS_TIPOS[n - 1];
      else if (!prot) {
        const tipo = detectarTipo(t);
        if (tipo) e.tipo_ocorrencia = tipo;
        if (t.length >= 25) {
          e.tipo_ocorrencia ??= "outros";
          e.descricao = t;
        }
      }
      break;
    case "descricao":
      if (!prot && t.length >= 10) {
        e.descricao = t;
        if (!dados.tipo_ocorrencia) e.tipo_ocorrencia = detectarTipo(t) ?? undefined;
      }
      break;
    case "localizacao":
      if (!prot && t.length >= 5) e.endereco = t.slice(0, 300);
      break;
    case "referencia":
      if (RE_PULAR.test(limpar(t))) e.pular = true;
      else if (!prot && t.length >= 3) e.referencia = t.slice(0, 200);
      break;
    case "fotos":
      if (RE_PULAR.test(limpar(t))) e.pular = true;
      break;
    case "identificacao":
      if (n === 1 || /^(an[oô]nim[oa]?|ficar an[oô]nimo|n[aã]o|n[aã]o quero)$/i.test(limpar(t))) e.anonima = true;
      else if (n === 2 || /^(sim|quero|me identificar|identificar|pode)$/i.test(limpar(t))) e.anonima = false;
      break;
    case "nome":
      if (!prot && t.length >= 2 && t.length <= 150 && !/\d{4,}/.test(t)) e.nome = t;
      break;
    case "contato":
      if (RE_PULAR.test(limpar(t))) e.pular = true;
      else {
        const c = normalizarContato(t);
        if (c) e.contato = c.valor;
      }
      break;
    case "nova":
      if (/^(1|nova|nova den[uú]ncia|outra|sim)$/i.test(limpar(t))) e.nova_denuncia = true;
      break;
    default:
      break;
  }
  return e;
}

/** Aproveita o relato enviado antes do consentimento (ex.: "tem uma queimada no Povoado X desde ontem"). */
export function extrairDoRelato(relato: string): Extracao {
  const e: Extracao = {};
  const tipo = detectarTipo(relato);
  if (tipo) e.tipo_ocorrencia = tipo;
  if (relato.trim().length >= 25 && !ehSaudacao(relato)) e.descricao = relato.trim();
  return e;
}

/** Botões → extração. */
export function extracaoDoBotao(id: string): Extracao {
  switch (id) {
    case "confirmar": return { confirma: true };
    case "corrigir": return { confirma: false };
    case "anonima": return { anonima: true };
    case "identificar": return { anonima: false };
    case "sem_foto":
    case "fotos_pronto":
    case "pular": return { pular: true };
    case "nova": return { nova_denuncia: true };
    default: return {};
  }
}
