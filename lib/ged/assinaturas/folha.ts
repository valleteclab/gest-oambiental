// Folha de assinaturas (HTML → PDF via htmlParaPdf) – o HTML é montado por função PURA (testável) com escape de tudo.
import { esc } from "@/lib/pdf";
import { fmtDataHoraBrasilia } from "./regras";

export type DadosFolha = {
  organizacao: { nome: string; logo_data_uri: string | null };
  numero: string;
  titulo: string;
  versao_n: number;
  paginas_documento: number | null;
  sha256_alvo: string;
  modo: "SEQUENCIAL" | "PARALELO";
  solicitado_por: string;
  solicitada_em: Date;
  selado_em: Date;
  codigo: string;
  url: string;
  qr_data_uri: string;
  assinantes: { ordem: number; nome: string; cargo: string | null; assinado_em: Date; metodo: string; hash_cadeia: string; rotulo: string }[];
  /** null = sem certificado do órgão (assinatura eletrônica avançada, com aviso visível). */
  certificado: { titular: string; emissor: string; serial: string; valido_ate: Date; teste: boolean } | null;
};

export const ROTULO_METODO: Record<string, string> = {
  ELETRONICA_AVANCADA: "Assinatura eletrônica avançada (Lei 14.063/2020)",
  ICP_BRASIL_A1: "Certificado ICP-Brasil A1",
};

export function htmlFolhaAssinaturas(d: DadosFolha): string {
  const linhas = d.assinantes
    .map(
      (a) => `<tr>
  <td class="n">${a.ordem}</td>
  <td><strong>${esc(a.nome)}</strong>${a.cargo ? `<br><span class="mut">${esc(a.cargo)}</span>` : ""}${a.rotulo && a.rotulo !== "Assinar" ? `<br><span class="mut">${esc(a.rotulo)}</span>` : ""}</td>
  <td>${esc(fmtDataHoraBrasilia(a.assinado_em))}<br><span class="mut">horário de Brasília</span></td>
  <td>${esc(ROTULO_METODO[a.metodo] ?? a.metodo)}</td>
  <td class="hash">${esc(a.hash_cadeia)}</td>
</tr>`,
    )
    .join("\n");
  const aviso = d.certificado
    ? `<p class="ok"><strong>Selo digital PAdES:</strong> arquivo assinado com o certificado A1 de <strong>${esc(d.certificado.titular)}</strong>
       (emissor: ${esc(d.certificado.emissor)}; série ${esc(d.certificado.serial)}; válido até ${esc(fmtDataHoraBrasilia(d.certificado.valido_ate).slice(0, 10))}).
       ${d.certificado.teste ? "<br><strong>Certificado de TESTE, sem valor legal (ambiente de demonstração).</strong>" : ""}</p>`
    : `<p class="aviso"><strong>Atenção:</strong> este documento foi selado com <strong>assinatura eletrônica avançada</strong> (Lei nº 14.063/2020), sem certificado digital ICP-Brasil do órgão.
       A integridade pode ser conferida pelo código verificador e pelo hash SHA-256 abaixo.</p>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:#111;margin:0}
  header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0f5132;padding-bottom:8px;margin-bottom:12px}
  header img{max-height:44px;max-width:150px;object-fit:contain} h1{font-size:15px;margin:0} h2{font-size:12px;margin:14px 0 6px}
  .mut{color:#555;font-size:9.5px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:5px 6px;vertical-align:top;text-align:left}
  th{background:#eef3f0;font-size:9.5px} td.n{width:22px;text-align:center} .hash{font-family:monospace;font-size:8px;word-break:break-all;width:150px}
  .meta{display:grid;grid-template-columns:130px 1fr;gap:3px 8px} .meta dt{color:#555} .meta dd{margin:0}
  .aviso{border:1px solid #b45309;background:#fffbeb;padding:8px;border-radius:4px} .ok{border:1px solid #0f5132;background:#f0fdf4;padding:8px;border-radius:4px}
  .verifica{display:flex;gap:14px;align-items:center;border:1px solid #bbb;padding:10px;border-radius:4px;margin-top:12px;page-break-inside:avoid}
  .verifica img{width:96px;height:96px} .cod{font-family:monospace;font-size:15px;font-weight:bold;letter-spacing:1px}
  tr{page-break-inside:avoid} .rodape{margin-top:12px;font-size:9px;color:#555}
</style></head><body>
<header>${d.organizacao.logo_data_uri ? `<img src="${esc(d.organizacao.logo_data_uri)}" alt="">` : ""}<div><h1>Folha de assinaturas</h1><div>${esc(d.organizacao.nome)}</div></div></header>
<dl class="meta">
  <dt>Documento</dt><dd><strong>${esc(d.numero)}</strong> – ${esc(d.titulo)}</dd>
  <dt>Versão assinada</dt><dd>v${d.versao_n}${d.paginas_documento ? ` · ${d.paginas_documento} página(s)` : ""}</dd>
  <dt>Modo</dt><dd>${d.modo === "SEQUENCIAL" ? "Sequencial (ordem definida)" : "Paralelo"}</dd>
  <dt>Solicitada por</dt><dd>${esc(d.solicitado_por)} em ${esc(fmtDataHoraBrasilia(d.solicitada_em))}</dd>
  <dt>Selada em</dt><dd>${esc(fmtDataHoraBrasilia(d.selado_em))} (horário de Brasília)</dd>
  <dt>SHA-256 do original</dt><dd class="hash" style="width:auto">${esc(d.sha256_alvo)}</dd>
</dl>
<h2>Signatários</h2>
<table><thead><tr><th>#</th><th>Signatário</th><th>Data e hora</th><th>Método</th><th>Hash da cadeia</th></tr></thead><tbody>
${linhas}
</tbody></table>
<p class="mut">Cada assinatura foi precedida de nova autenticação do signatário (senha) e registra IP, navegador, horário do servidor e o hash do arquivo no instante da assinatura.
O hash de cada elo = SHA-256(hash do elo anterior | id da assinatura | id do usuário | hash do documento | data/hora ISO | método); o primeiro elo parte do SHA-256 do original.</p>
<div style="margin-top:10px">${aviso}</div>
<div class="verifica"><img src="${esc(d.qr_data_uri)}" alt="QR Code de verificação">
  <div><div>Código verificador</div><div class="cod">${esc(d.codigo)}</div>
  <div style="margin-top:4px">Confira a autenticidade em <strong>${esc(d.url)}</strong></div>
  <div class="mut">Validador oficial do ITI: validar.iti.gov.br</div></div></div>
<p class="rodape">Esta folha integra o documento e foi gerada automaticamente em ${esc(fmtDataHoraBrasilia(d.selado_em))}. Qualquer alteração no arquivo invalida o hash e a assinatura digital.</p>
</body></html>`;
}
