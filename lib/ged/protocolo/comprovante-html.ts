// HTML do comprovante de protocolo (→ PDF via htmlParaPdf). Função PURA (testável): escapa tudo e nunca mostra CPF/CNPJ
// completo (sempre mascarado). Data/hora em horário de Brasília.
import type { GedLivroProtocolo } from "@prisma/client";
import { esc } from "@/lib/pdf";
import { dataHoraBrasilia } from "../templates";
import { ROTULO_LIVRO } from "./regras";

export type DadosComprovante = {
  organizacao: { nome: string; logo_data_uri: string | null };
  numero: string;
  livro: GedLivroProtocolo;
  registrado_em: Date;
  assunto: string;
  /** Interessado externo (ENTRADA/SAIDA); null no livro INTERNO. */
  interessado: { nome: string; doc_mascarado: string | null } | null;
  origem_rotulo: string | null;
  destino_rotulo: string | null;
  anexos: { nome: string; sha256: string; tamanho: number }[];
  /** Código para acompanhar o andamento (só ENTRADA com portal ativo). */
  codigo_consulta: string | null;
  url_consulta: string | null;
  codigo_verificacao: string;
  url_verificacao: string;
  qr_data_uri: string;
  /** true = será assinado com o certificado A1 do órgão (PAdES); false = assinatura eletrônica simples. */
  com_certificado: boolean;
  emitido_em: Date;
};

const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function htmlComprovante(d: DadosComprovante): string {
  const anexos = d.anexos.length
    ? `<table><thead><tr><th>#</th><th>Arquivo</th><th>Tamanho</th><th>SHA-256</th></tr></thead><tbody>${d.anexos
        .map((a, i) => `<tr><td class="n">${i + 1}</td><td>${esc(a.nome)}</td><td>${esc(tamanho(a.tamanho))}</td><td class="hash">${esc(a.sha256)}</td></tr>`)
        .join("")}</tbody></table>`
    : `<p class="mut">Nenhum arquivo anexado.</p>`;
  const linhas: [string, string][] = [
    ["Livro", ROTULO_LIVRO[d.livro]],
    ["Data e hora do registro", `${dataHoraBrasilia(d.registrado_em)} (horário de Brasília)`],
    ["Assunto", d.assunto],
  ];
  if (d.interessado) linhas.push([d.livro === "SAIDA" ? "Destinatário" : "Interessado", `${d.interessado.nome}${d.interessado.doc_mascarado ? ` – CPF/CNPJ ${d.interessado.doc_mascarado}` : ""}`]);
  if (d.origem_rotulo) linhas.push(["Origem", d.origem_rotulo]);
  if (d.destino_rotulo) linhas.push(["Destino", d.destino_rotulo]);
  const assinatura = d.com_certificado
    ? `Comprovante assinado digitalmente com o certificado A1 do órgão (PAdES).`
    : `Comprovante emitido eletronicamente pelo sistema (assinatura eletrônica simples). Sua autenticidade é conferida pelo código e pelo QR de verificação.`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0}
  header{display:flex;align-items:center;gap:12px;border-bottom:2px solid #0f5132;padding-bottom:8px;margin-bottom:14px}
  header img{max-height:48px;max-width:160px;object-fit:contain} h1{font-size:17px;margin:0} h2{font-size:12px;margin:16px 0 6px}
  .mut{color:#555;font-size:10px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #bbb;padding:5px 6px;vertical-align:top;text-align:left}
  th{background:#eef3f0;font-size:10px} td.n{width:22px;text-align:center} .hash{font-family:monospace;font-size:8px;word-break:break-all;width:230px}
  .num{font-size:22px;font-weight:bold;letter-spacing:.5px;color:#0f5132;margin:2px 0 10px}
  .meta{display:grid;grid-template-columns:150px 1fr;gap:4px 10px} .meta dt{color:#555} .meta dd{margin:0;word-break:break-word}
  .caixa{border:1px solid #bbb;padding:10px;border-radius:4px;margin-top:14px;page-break-inside:avoid}
  .verifica{display:flex;gap:14px;align-items:center} .verifica img{width:100px;height:100px}
  .cod{font-family:monospace;font-size:15px;font-weight:bold;letter-spacing:1px} .rodape{margin-top:14px;font-size:9px;color:#555}
</style></head><body>
<header>${d.organizacao.logo_data_uri ? `<img src="${esc(d.organizacao.logo_data_uri)}" alt="">` : ""}<div><h1>Comprovante de protocolo</h1><div>${esc(d.organizacao.nome)}</div></div></header>
<div class="mut">Número do protocolo</div>
<div class="num" data-testid="numero-protocolo">${esc(d.numero)}</div>
<dl class="meta">${linhas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<h2>Arquivos recebidos</h2>
${anexos}
${d.codigo_consulta ? `<div class="caixa"><strong>Acompanhe o andamento</strong><br>Informe o número do protocolo e o código de consulta abaixo na página do órgão${d.url_consulta ? `:<br><span class="mut">${esc(d.url_consulta)}</span>` : "."}<br>Código de consulta: <span class="cod">${esc(d.codigo_consulta)}</span><br><span class="mut">Guarde este código: ele é a sua chave de acesso ao andamento.</span></div>` : ""}
<div class="caixa verifica"><img src="${esc(d.qr_data_uri)}" alt="QR Code de verificação"><div><strong>Verificação de autenticidade</strong><br>Leia o QR Code ou acesse:<br><span class="mut">${esc(d.url_verificacao)}</span><br>Código de verificação: <span class="cod">${esc(d.codigo_verificacao)}</span></div></div>
<p class="rodape">${esc(assinatura)}<br>Emitido em ${esc(dataHoraBrasilia(d.emitido_em))} (horário de Brasília). Este comprovante atesta o recebimento do protocolo e dos arquivos listados, identificados pelo hash SHA-256; não implica deferimento do pedido.</p>
</body></html>`;
}
