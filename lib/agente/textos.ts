// Textos determinísticos do agente (boas-vindas, LGPD, perguntas, resumo, protocolo). Formatação do WhatsApp.
import { MAX_FOTOS_CONVERSA, TIPOS_OCORRENCIA, rotuloTipo, type Campo, type DadosColetados } from "./tipos";
import type { Botao } from "../canais/tipos";

export type Resposta = { texto: string; botoes?: Botao[] };

export const B = {
  lgpdSim: { id: "lgpd_sim", rotulo: "Sim, concordo" },
  lgpdNao: { id: "lgpd_nao", rotulo: "Não" },
  confirmar: { id: "confirmar", rotulo: "Sim, registrar" },
  corrigir: { id: "corrigir", rotulo: "Corrigir" },
  anonima: { id: "anonima", rotulo: "Ficar anônimo" },
  identificar: { id: "identificar", rotulo: "Me identificar" },
  semFoto: { id: "sem_foto", rotulo: "Não tenho foto" },
  pronto: { id: "fotos_pronto", rotulo: "Pronto, continuar" },
  pular: { id: "pular", rotulo: "Pular" },
  nova: { id: "nova", rotulo: "Nova denúncia" },
  sair: { id: "sair", rotulo: "Encerrar" },
} satisfies Record<string, Botao>;

export const persona = (municipio: string | null) => `Assistente Ambiental da Secretaria de Meio Ambiente${municipio ? ` de ${municipio}` : ""}`;

export function boasVindas(municipio: string | null, urlPrivacidade: string): Resposta[] {
  return [
    {
      texto:
        `Olá! 👋 Eu sou o *${persona(municipio)}*. 🌿\n\n` +
        `Por aqui você pode *registrar uma denúncia ambiental* (queimada, desmatamento, lixo, esgoto, barulho…) e *acompanhar* denúncias já feitas.\n\n` +
        `🔒 *Privacidade (LGPD):* para registrar a denúncia vou tratar as informações que você enviar (texto, fotos, localização e, se quiser, seu nome) ` +
        `somente para a fiscalização ambiental. Você pode ficar *anônimo*. Política: ${urlPrivacidade}\n\n` +
        `Você concorda em continuar?`,
      botoes: [B.lgpdSim, B.lgpdNao],
    },
  ];
}

export const lgpdRecusada = (): Resposta => ({
  texto: "Tudo bem! 🙂 Sem o seu consentimento não posso registrar a denúncia por aqui. Você pode procurar a Secretaria de Meio Ambiente pessoalmente ou por telefone. Se mudar de ideia, é só mandar uma nova mensagem.",
});

export const lgpdInsistir = (): Resposta => ({ texto: "Para continuar, preciso que você responda se *concorda* com o tratamento dos dados para registrar a denúncia. 🙏", botoes: [B.lgpdSim, B.lgpdNao] });

export function menuMunicipios(nomes: string[]): Resposta {
  return { texto: `Em qual *município* está acontecendo? Responda com o número:\n\n${nomes.map((n, i) => `${i + 1}. ${n}`).join("\n")}` };
}

export function menuTipos(): string {
  return TIPOS_OCORRENCIA.map((t, i) => `${i + 1}. ${t.emoji} ${t.rotulo}`).join("\n");
}

/** Pergunta determinística de cada campo (também usada como "instrução" para a IA redigir). */
export function perguntaCampo(campo: Campo, d: DadosColetados, opts: { webchat?: boolean } = {}): Resposta {
  switch (campo) {
    case "tipo_ocorrencia":
      return { texto: `Qual é o *tipo de problema*? Responda com o número ou descreva com suas palavras:\n\n${menuTipos()}` };
    case "descricao":
      return { texto: `Entendi: *${rotuloTipo(d.tipo_ocorrencia)}*. ✍️ Agora me conte *o que está acontecendo*: desde quando, com que frequência, quem pode estar envolvido…` };
    case "localizacao":
      return {
        texto: opts.webchat
          ? "📍 *Onde* está acontecendo? Use o botão *Enviar minha localização*, marque no mapa ou digite o *endereço* (rua, bairro, povoado, estrada)."
          : "📍 *Onde* está acontecendo? Se estiver no local, envie a *localização* pelo WhatsApp (📎 › Localização). Se não, digite o *endereço* (rua, bairro, povoado, estrada).",
      };
    case "referencia":
      return { texto: "Tem algum *ponto de referência* perto (escola, igreja, comércio, ponte)? Se não tiver, toque em *Pular*.", botoes: [B.pular] };
    case "fotos":
      return { texto: `📷 Se puder, envie *fotos* do problema (até ${MAX_FOTOS_CONVERSA}). Elas ajudam muito a fiscalização. Não tem? Toque em *Não tenho foto*.`, botoes: [B.semFoto] };
    case "identificacao":
      return { texto: "Deseja *se identificar*? A denúncia pode ser *anônima* – seus dados nunca são divulgados. 🔒", botoes: [B.anonima, B.identificar] };
    case "nome":
      return { texto: "Qual é o seu *nome*?" };
    case "contato":
      return { texto: "Para acompanhar a denúncia depois, informe um *telefone ou e-mail* (opcional – fica protegido). Se preferir não informar, toque em *Pular*.", botoes: [B.pular] };
    case "municipio":
      return { texto: "Em qual *município* está acontecendo?" };
  }
}

export function resumo(d: DadosColetados, municipio: string | null): Resposta {
  const local = d.latitude != null && d.longitude != null
    ? `📍 Localização GPS (${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)})${d.endereco ? ` – ${d.endereco}` : ""}`
    : `📍 ${d.endereco ?? "—"}`;
  const linhas = [
    "📋 *Resumo da denúncia*",
    "",
    municipio ? `🏙️ *Município:* ${municipio}` : null,
    `🏷️ *Tipo:* ${rotuloTipo(d.tipo_ocorrencia)}`,
    `📝 *Descrição:* ${d.descricao ?? "—"}`,
    `*Local:* ${local}`,
    d.referencia ? `🧭 *Referência:* ${d.referencia}` : null,
    `📷 *Fotos:* ${d.fotos?.length ? d.fotos.length : "nenhuma"}`,
    `👤 *Identificação:* ${d.anonima === false ? d.nome ?? "—" : "anônima"}`,
    "",
    "Está tudo correto? *Posso registrar?*",
  ].filter((l) => l !== null);
  return { texto: linhas.join("\n"), botoes: [B.confirmar, B.corrigir] };
}

export const perguntaCorrecao = (): Resposta => ({
  texto: "Sem problema! O que você quer *corrigir*? Responda com o número:\n\n1. Tipo do problema\n2. Descrição\n3. Local\n4. Fotos\n5. Identificação",
});

export function registrada(protocolo: string, urlAcompanhar: string): Resposta {
  return {
    texto:
      `✅ *Denúncia registrada!*\n\nProtocolo: *${protocolo}*\n\n` +
      `A equipe de fiscalização ambiental vai analisar. Você será avisado por aqui quando houver novidade. ` +
      `Para consultar, envie o número do protocolo aqui ou acesse ${urlAcompanhar}\n\nObrigado por cuidar do meio ambiente! 💚`,
  };
}

export const jaRegistrada = (protocolo: string): Resposta => ({
  texto: `Sua denúncia *${protocolo}* já está registrada ✅. Para saber a situação, envie o número do protocolo. Quer registrar *outra* denúncia?`,
  botoes: [B.nova, B.sair],
});

export const encerrada = (): Resposta => ({ texto: "Atendimento encerrado. 👋 Quando precisar, é só mandar uma nova mensagem. Obrigado! 🌿" });
export const encerradaInatividade = (): Resposta => ({ texto: "Encerramos este atendimento por falta de resposta. 🕐 Se quiser continuar a denúncia, é só mandar uma nova mensagem. 🌿" });
export const deNada = (): Resposta => ({ texto: "De nada! 💚 Conte sempre com a gente." });

export const emergencia = (): Resposta => ({
  texto: "🚨 *Se houver risco imediato à vida ou a casas*, ligue agora: *193* (Bombeiros), *190* (Polícia Militar) ou *199* (Defesa Civil). Depois, se puder, continuamos o registro por aqui.",
});

export function foraDoTema(municipio: string | null): Resposta {
  return {
    texto: `Sou o ${persona(municipio)} e posso ajudar com:\n\n• 📝 *Registrar denúncia ambiental* (queimada, desmatamento, lixo, esgoto, barulho, maus-tratos a animais…)\n• 🔎 *Consultar* uma denúncia pelo protocolo (ex.: DEN-XXX-001/2026)\n\nPara outros assuntos, procure a prefeitura. 🙂`,
  };
}

export const naoEntendi = (): Resposta => ({ texto: "Desculpe, não entendi. 🤔" });

export const limiteMensagens = (): Resposta => ({ texto: "Recebi muitas mensagens em pouco tempo. ⏳ Aguarde alguns minutos e continue, por favor." });

export const audioSemTranscricao = (): Resposta => ({ texto: "🎙️ Recebi seu áudio, mas não consigo ouvi-lo por aqui. Pode *escrever* a mensagem, por favor?" });

export const documentoNaoSuportado = (): Resposta => ({ texto: "📎 Recebi o arquivo, mas por aqui só consigo usar *fotos* (JPG/PNG), *texto* e *localização*." });

export const limiteFotos = (): Resposta => ({ texto: `📷 Já recebi ${MAX_FOTOS_CONVERSA} fotos – é o máximo por denúncia. Vamos continuar!` });

export const fotoRecebida = (n: number): Resposta => ({
  texto: `📷 Foto ${n} recebida! ${n < MAX_FOTOS_CONVERSA ? "Pode enviar mais ou toque em *Pronto, continuar*." : ""}`.trim(),
  botoes: n < MAX_FOTOS_CONVERSA ? [B.pronto] : undefined,
});

export const statusProtocolo = (protocolo: string, situacao: string, registradaEm: string): Resposta => ({
  texto: `🔎 Denúncia *${protocolo}*\nSituação: *${situacao}*\nRegistrada em ${registradaEm}.`,
});

export const protocoloNaoEncontrado = (urlAcompanhar: string): Resposta => ({
  texto: `Não encontrei uma denúncia com esse protocolo *vinculada a este contato*. 🔒 Por segurança, só informo a situação de denúncias feitas pelo mesmo telefone/e-mail. Você também pode consultar em ${urlAcompanhar}`,
});

export const avaliacaoObrigado = (n: number): Resposta => ({ texto: `Obrigado pela avaliação ${"⭐".repeat(n)}! Sua opinião ajuda a melhorar o atendimento. 💚` });

export const aguardandoAtendente = (): Resposta => ({ texto: "Um atendente da Secretaria está cuidando da sua conversa. 🙋 Aguarde a resposta, por favor." });

export const ROTULO_STATUS_CIDADAO: Record<string, string> = {
  NOVA: "Recebida – aguardando análise",
  EM_APURACAO: "Em apuração pela fiscalização",
  CONCLUIDA: "Concluída",
  ARQUIVADA: "Arquivada",
};

export function notificacaoStatus(protocolo: string, status: string): Resposta {
  const base = `📣 Atualização da sua denúncia *${protocolo}*: *${ROTULO_STATUS_CIDADAO[status] ?? status}*.`;
  if (status === "EM_APURACAO") return { texto: `${base}\n\nA equipe de fiscalização está apurando o caso. 🔍` };
  if (status === "CONCLUIDA") return { texto: `${base}\n\nObrigado por ajudar a proteger o meio ambiente! 💚\n\nComo você avalia o atendimento? Responda de *1* a *5* ⭐` };
  return { texto: `${base}\n\nEm caso de dúvida, procure a Secretaria de Meio Ambiente.` };
}
