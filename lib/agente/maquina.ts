// Máquina de estados do agente – EM CÓDIGO e pura (testada em tests/unit/agente-maquina.test.ts).
// INICIO → AGUARDANDO_LGPD → COLETANDO ⇄ CONFIRMANDO → REGISTRADA → (ENCERRADA); HUMANO pausa a IA.
// A IA (quando houver) só ajuda a ENTENDER o texto (Extracao) e a REDIGIR a pergunta; quem decide se os dados
// estão completos, mostra o resumo e registra (somente após confirmação explícita no estado CONFIRMANDO) é este código.
import type { EstadoConversa } from "@prisma/client";
import { MAX_FOTOS_CONVERSA, type Campo, type DadosColetados, type Extracao, type FotoColetada } from "./tipos";
import * as T from "./textos";
import { ehAgradecimento, ehSair, ehSaudacao, extrairDoRelato, extracaoDoBotao, RE_NAO, RE_SIM } from "./interpretar";
import type { Resposta } from "./textos";

export type EntradaMaquina = {
  kind: "text" | "image" | "audio" | "document" | "location" | "button" | "unknown";
  texto: string | null;
  /** Id do botão (resolvido: nativo, "1"/"2" ou rótulo). */
  botao: string | null;
  location?: { lat: number; lng: number; endereco?: string | null } | null;
  /** Foto já gravada no storage. */
  foto?: FotoColetada | null;
};

export type ContextoMaquina = {
  estado: EstadoConversa;
  dados: DadosColetados;
  entrada: EntradaMaquina;
  /** Interpretação do texto (IA ou determinística). */
  extracao: Extracao;
  municipioNome: string | null;
  /** Municípios para escolher (canal da organização sem município definido). */
  municipios: { id: string; nome: string }[];
  webchat: boolean;
  /** Consentimento LGPD já dado por este contato (conversa anterior). */
  consentimentoPrevio: boolean;
  urls: { privacidade: string; acompanhar: string };
  /** Extração da IA sobre o relato inicial (opcional). */
  extracaoRelato?: Extracao;
  /** Protocolo da denúncia já registrada nesta conversa. */
  protocolo?: string | null;
};

export type Acao = "CONSENTIR" | "REGISTRAR" | "ENCERRAR" | "NOVA_CONVERSA";

export type Decisao = {
  estado: EstadoConversa;
  dados: DadosColetados;
  respostas: (Resposta & { redigir?: Campo | null })[];
  acoes: Acao[];
  /** Protocolo pedido (a consulta com a regra de privacidade é feita pelo orquestrador). */
  consultarProtocolo?: string | null;
};

/** Próximo campo que falta (null = dados completos → resumo/confirmação). */
export function proximoCampo(d: DadosColetados, ctx: { precisaMunicipio: boolean; webchat: boolean }): Campo | null {
  if (ctx.precisaMunicipio && !d.municipio_id) return "municipio";
  if (!d.tipo_ocorrencia) return "tipo_ocorrencia";
  if (!d.descricao || d.descricao.trim().length < 10) return "descricao";
  const temGps = d.latitude != null && d.longitude != null;
  if (!temGps && !d.endereco) return "localizacao";
  if (!temGps && d.endereco && !d.referencia && !d.referencia_pulada) return "referencia";
  if (!d.fotos_encerradas && (d.fotos?.length ?? 0) < MAX_FOTOS_CONVERSA) return "fotos";
  if (d.anonima === null || d.anonima === undefined) return "identificacao";
  if (d.anonima === false && !d.nome) return "nome";
  if (ctx.webchat && !d.contato_informado && !d.contato_pulado) return "contato";
  return null;
}

/** Aplica a extração aos dados (sem sobrescrever com vazio). */
export function aplicarExtracao(d: DadosColetados, e: Extracao, municipios: { id: string; nome: string }[]): DadosColetados {
  const n: DadosColetados = { ...d, fotos: [...(d.fotos ?? [])] };
  if (e.corrigir_campo) {
    switch (e.corrigir_campo) {
      case "tipo_ocorrencia": n.tipo_ocorrencia = null; break;
      case "descricao": n.descricao = null; break;
      case "localizacao": case "referencia":
        n.latitude = null; n.longitude = null; n.endereco = null; n.referencia = null; n.referencia_pulada = false; break;
      case "fotos": n.fotos = []; n.fotos_encerradas = false; break;
      case "identificacao": case "nome": n.anonima = null; n.nome = null; break;
      case "contato": n.contato_informado = null; n.contato_pulado = false; break;
      case "municipio": n.municipio_id = null; break;
    }
    n.corrigindo = true;
  }
  if (e.municipio_indice != null && municipios[e.municipio_indice]) n.municipio_id = municipios[e.municipio_indice].id;
  if (e.tipo_ocorrencia) n.tipo_ocorrencia = e.tipo_ocorrencia;
  if (e.descricao && e.descricao.trim().length >= 10) n.descricao = e.descricao.trim().slice(0, 4000);
  if (e.endereco && e.endereco.trim().length >= 3) n.endereco = e.endereco.trim().slice(0, 300);
  if (e.referencia) n.referencia = e.referencia.trim().slice(0, 200);
  if (typeof e.anonima === "boolean") n.anonima = e.anonima;
  if (e.nome && e.anonima !== true) n.nome = e.nome.trim().slice(0, 150);
  if (e.contato) n.contato_informado = e.contato;
  if (e.pular) {
    if (d.perguntou === "referencia") n.referencia_pulada = true;
    else if (d.perguntou === "fotos") n.fotos_encerradas = true;
    else if (d.perguntou === "contato") n.contato_pulado = true;
  }
  return n;
}

const comBotoes = (r: Resposta, d: DadosColetados): DadosColetados => ({ ...d, botoes: r.botoes?.map((b) => b.id) ?? [] });

/** Pergunta o próximo campo ou mostra o resumo (CONFIRMANDO). */
function avancar(d: DadosColetados, ctx: ContextoMaquina, prefixo: Decisao["respostas"], acoes: Acao[]): Decisao {
  const precisaMunicipio = ctx.municipios.length > 1;
  const campo = proximoCampo(d, { precisaMunicipio, webchat: ctx.webchat });
  if (!campo) {
    const r = T.resumo(d, ctx.municipioNome ?? ctx.municipios.find((m) => m.id === d.municipio_id)?.nome ?? null);
    return { estado: "CONFIRMANDO", dados: comBotoes(r, { ...d, perguntou: "confirmacao", corrigindo: false }), respostas: [...prefixo, r], acoes };
  }
  const r = campo === "municipio" ? T.menuMunicipios(ctx.municipios.map((m) => m.nome)) : T.perguntaCampo(campo, d, { webchat: ctx.webchat });
  // Após uma foto, a confirmação "Foto N recebida" já pergunta se há mais.
  const ultima = prefixo[prefixo.length - 1];
  if (campo === "fotos" && ctx.entrada.foto && ultima?.botoes?.some((b) => b.id === T.B.pronto.id)) {
    return { estado: "COLETANDO", dados: comBotoes(ultima, { ...d, perguntou: "fotos" }), respostas: prefixo, acoes };
  }
  const redigivel = campo !== "municipio" && campo !== "tipo_ocorrencia";
  return { estado: "COLETANDO", dados: comBotoes(r, { ...d, perguntou: campo }), respostas: [...prefixo, { ...r, redigir: redigivel ? campo : null }], acoes };
}

export function decidir(ctx: ContextoMaquina): Decisao {
  const { estado, entrada, extracao } = ctx;
  const d: DadosColetados = { ...ctx.dados, fotos: [...(ctx.dados.fotos ?? [])] };
  const texto = (entrada.texto ?? "").trim();
  const prefixo: Decisao["respostas"] = [];
  if (extracao.emergencia) prefixo.push(T.emergencia());

  // ── Regras globais determinísticas ──
  if (entrada.botao === "sair" || (texto && ehSair(texto))) {
    return { estado: "ENCERRADA", dados: { ...d, botoes: [] }, respostas: [T.encerrada()], acoes: ["ENCERRAR"] };
  }
  if (extracao.quer_consultar_protocolo && estado !== "CONFIRMANDO") {
    return { estado, dados: d, respostas: prefixo, acoes: [], consultarProtocolo: extracao.quer_consultar_protocolo };
  }

  switch (estado) {
    case "INICIO": {
      if (texto && !ehSaudacao(texto)) d.relato_inicial = [d.relato_inicial, texto].filter(Boolean).join("\n").slice(0, 2000);
      if (entrada.location) { d.latitude = entrada.location.lat; d.longitude = entrada.location.lng; d.endereco ??= entrada.location.endereco ?? null; }
      if (entrada.foto) d.fotos = [...(d.fotos ?? []), entrada.foto].slice(0, MAX_FOTOS_CONVERSA);
      if (ctx.consentimentoPrevio) return iniciarColeta(d, ctx, [...prefixo, { texto: `Olá de novo! 👋 Sou o *${T.persona(ctx.municipioNome)}*. 🌿` }], ["CONSENTIR"]);
      const r = T.boasVindas(ctx.municipioNome, ctx.urls.privacidade);
      return { estado: "AGUARDANDO_LGPD", dados: comBotoes(r[r.length - 1], { ...d, perguntou: "lgpd" }), respostas: [...prefixo, ...r], acoes: [] };
    }
    case "AGUARDANDO_LGPD": {
      const t = texto.replace(/[.!\s]+$/, "");
      if (entrada.botao === "lgpd_sim" || (!entrada.botao && RE_SIM.test(t))) return iniciarColeta(d, ctx, prefixo, ["CONSENTIR"]);
      if (entrada.botao === "lgpd_nao" || (!entrada.botao && RE_NAO.test(t))) return { estado: "ENCERRADA", dados: { ...d, botoes: [] }, respostas: [...prefixo, T.lgpdRecusada()], acoes: ["ENCERRAR"] };
      if (entrada.foto) d.fotos = [...(d.fotos ?? []), entrada.foto].slice(0, MAX_FOTOS_CONVERSA);
      if (entrada.location) { d.latitude = entrada.location.lat; d.longitude = entrada.location.lng; }
      const r = T.lgpdInsistir();
      return { estado, dados: comBotoes(r, d), respostas: [...prefixo, r], acoes: [] };
    }
    case "COLETANDO":
    case "CONFIRMANDO": {
      let e: Extracao = { ...extracao, ...(entrada.botao ? extracaoDoBotao(entrada.botao) : {}) };
      // Confirmação só vale no estado CONFIRMANDO (a IA não consegue "pular" a etapa)
      if (estado === "CONFIRMANDO" && e.confirma === true && !e.corrigir_campo) {
        return { estado: "CONFIRMANDO", dados: { ...d, botoes: [] }, respostas: prefixo, acoes: ["REGISTRAR"] };
      }
      if (estado !== "CONFIRMANDO") e = { ...e, confirma: null };
      const acks: Resposta[] = [];
      let n = aplicarExtracao(d, e, ctx.municipios);
      if (entrada.location) {
        n.latitude = entrada.location.lat;
        n.longitude = entrada.location.lng;
        if (!n.endereco && entrada.location.endereco) n.endereco = entrada.location.endereco;
        acks.push({ texto: "📍 Localização recebida!" });
      }
      if (entrada.foto) {
        if ((n.fotos?.length ?? 0) >= MAX_FOTOS_CONVERSA) acks.push(T.limiteFotos());
        else {
          n.fotos = [...(n.fotos ?? []), entrada.foto];
          acks.push(T.fotoRecebida(n.fotos.length));
        }
      }
      if (estado === "CONFIRMANDO" && e.confirma === false && !e.corrigir_campo) {
        const r = T.perguntaCorrecao();
        return { estado: "COLETANDO", dados: { ...n, perguntou: "correcao", botoes: [] }, respostas: [...prefixo, ...acks, r], acoes: [] };
      }
      const mudou = JSON.stringify({ ...n, perguntou: null, botoes: null, corrigindo: null }) !== JSON.stringify({ ...d, perguntou: null, botoes: null, corrigindo: null });
      if (!mudou && !entrada.location && !entrada.foto) {
        // Nada aproveitável: saudação, agradecimento, fora do tema ou não entendido → responde e repete a pergunta
        if (texto && ehSaudacao(texto)) prefixo.push({ texto: "Olá! 😊 Vamos continuar:" });
        else if (texto && ehAgradecimento(texto)) prefixo.push(T.deNada());
        else if (extracao.fora_do_tema) prefixo.push(T.foraDoTema(ctx.municipioNome));
        else if (entrada.kind === "document") prefixo.push(T.documentoNaoSuportado());
        else if (!extracao.emergencia) prefixo.push(n.perguntou === "descricao" && texto.length > 0 ? { texto: "Pode detalhar um pouco mais? ✍️" } : T.naoEntendi());
        if (estado === "CONFIRMANDO") {
          const r = T.resumo(n, ctx.municipioNome ?? ctx.municipios.find((m) => m.id === n.municipio_id)?.nome ?? null);
          return { estado, dados: comBotoes(r, n), respostas: [...prefixo, r], acoes: [] };
        }
        if (n.perguntou === "correcao") return { estado, dados: n, respostas: [...prefixo, T.perguntaCorrecao()], acoes: [] };
      }
      if (e.corrigir_campo) n = { ...n, perguntou: null };
      return avancar(n, ctx, [...prefixo, ...acks], []);
    }
    case "REGISTRADA": {
      const e = { ...extracao, ...(entrada.botao ? extracaoDoBotao(entrada.botao) : {}) };
      if (e.nova_denuncia || (texto && /^(nova|nova den[uú]ncia|outra( den[uú]ncia)?)$/i.test(texto))) return { estado, dados: d, respostas: prefixo, acoes: ["NOVA_CONVERSA"] };
      if (texto && ehAgradecimento(texto)) return { estado, dados: d, respostas: [...prefixo, T.deNada()], acoes: [] };
      const r = T.jaRegistrada(ctx.protocolo ?? "");
      return { estado, dados: comBotoes(r, { ...d, perguntou: "nova" }), respostas: [...prefixo, r], acoes: [] };
    }
    default:
      return { estado, dados: d, respostas: prefixo, acoes: [] };
  }
}

/** Após o consentimento: aproveita o relato inicial e pergunta o que falta. */
function iniciarColeta(d: DadosColetados, ctx: ContextoMaquina, prefixo: Decisao["respostas"], acoes: Acao[]): Decisao {
  let n: DadosColetados = { ...d };
  if (ctx.municipios.length === 1) n.municipio_id = ctx.municipios[0].id;
  if (d.relato_inicial) {
    n = aplicarExtracao(n, { ...extrairDoRelato(d.relato_inicial), ...ctx.extracaoRelato }, ctx.municipios);
  }
  const inicio: Resposta = { texto: "Obrigado! 🙌 Vamos registrar sua denúncia. Você pode digitar *sair* a qualquer momento para encerrar." };
  return avancar(n, ctx, [...prefixo, inicio], acoes);
}
