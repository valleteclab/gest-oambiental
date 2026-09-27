// Renderização do HTML final: modelo_documento ativo (placeholders) ou modelo embutido (templates/).
import { fmtData, fmtDataHora } from "../format";
import { listaCondicionantes, MODELOS, pagina, type ContextoDocumento } from "@/templates";
import { aplicarPlaceholders, sanitizarHtml } from "./render";

/** Variáveis disponíveis em `modelo_documento.html` ({{x}} escapado; {{{x_html}}} HTML sanitizado). */
export const VARIAVEIS_MODELO: [string, string][] = [
  ["numero", "Número do documento"],
  ["titulo", "Título do documento"],
  ["codigo", "Código verificador"],
  ["url_validacao", "URL de validação"],
  ["data_emissao / data_hora_emissao", "Data (e hora) de emissão"],
  ["validade", "Data de validade (dd/mm/aaaa)"],
  ["municipio.nome / municipio.orgao / municipio.endereco", "Dados do município"],
  ["titular.nome / titular.documento / titular.endereco", "Titular (CPF de PF mascarado em documentos públicos)"],
  ["processo.numero / processo.tipo_ato_nome / processo.tipo_ato_sigla / processo.data_protocolo", "Processo"],
  ["empreendimento.nome / empreendimento.endereco / empreendimento.tipologia / empreendimento.porte", "Empreendimento"],
  ["rt.nome / rt.registro", "Responsável técnico"],
  ["signatario.nome / signatario.cargo", "Quem assina"],
  ["{{{condicionantes_html}}}", "Lista numerada de condicionantes"],
  ["{{{parecer_html}}}", "Texto do parecer técnico"],
  ["auto.* / notificacao.* / dados.*", "Dados específicos (auto de infração, notificação, dados livres)"],
];

export function variaveisModelo(ctx: ContextoDocumento): Record<string, unknown> {
  return {
    ...ctx,
    data_emissao: fmtData(ctx.emitido_em),
    data_hora_emissao: fmtDataHora(ctx.emitido_em),
    validade: ctx.validade_ate ? fmtData(ctx.validade_ate) : "",
    processo: ctx.processo ? { ...ctx.processo, data_protocolo: ctx.processo.data_protocolo ? fmtData(ctx.processo.data_protocolo) : "" } : null,
    condicionantes_html: listaCondicionantes(ctx),
    parecer_html: ctx.parecer ? sanitizarHtml(ctx.parecer.texto_html) : "",
  };
}

/** HTML completo do documento. `modeloHtml` = html do modelo_documento ativo (opcional). */
export function renderizarDocumento(ctx: ContextoDocumento, modeloHtml?: string | null): string {
  if (modeloHtml && modeloHtml.trim()) {
    const corpo = aplicarPlaceholders(modeloHtml, variaveisModelo(ctx));
    // Modelo completo (<html>) é usado como está; fragmento recebe cabeçalho institucional + assinatura.
    return /<html[\s>]/i.test(corpo) ? corpo : pagina(ctx, corpo);
  }
  return MODELOS[ctx.tipo](ctx);
}
