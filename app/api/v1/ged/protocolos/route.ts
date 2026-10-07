import { NextResponse } from "next/server";
import { invalido, rota } from "@/lib/http";
import { ctxGedApi } from "@/lib/ged/escopo";
import { filtrosParaQueryProtocolo, lerFiltrosProtocolo, listarProtocolos, registrarProtocolo, type AnexoEntrada } from "@/lib/ged/protocolo/servico";

export const dynamic = "force-dynamic";

// GET /api/v1/ged/protocolos?livro=&ano=&situacao=&setor=&q=&meus=1&page=  → { data, page, size, total }
// Visibilidade: Admin/Gestor/Auditor veem o livro inteiro; Usuário e Leitor, os protocolos do seu setor/envolvimento.
export const GET = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const f = lerFiltrosProtocolo(new URL(req.url).searchParams);
  const r = await listarProtocolos(ctx, f);
  return NextResponse.json({ data: r.linhas, page: r.page, size: r.size, total: r.total, consulta: filtrosParaQueryProtocolo(f) });
});

// POST /api/v1/ged/protocolos  – registra ENTRADA (balcão), SAIDA ou INTERNO.
//   application/json ......... { livro, assunto, descricao?, interessado:{nome,cpf_cnpj?,email?,telefone?}, origem_setor_id?, destino_setor_id?|destino_usuario_id?, prioridade?, prazo_resposta?, tipo_documento_id? }
//   multipart/form-data ...... campo "dados" (o JSON acima) + "arquivos" (PDFs, repetido)
export const POST = rota(async (req: Request) => {
  const ctx = await ctxGedApi();
  const tipo = req.headers.get("content-type") ?? "";
  let dados: unknown;
  const anexos: AnexoEntrada[] = [];
  if (tipo.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) throw invalido("Corpo inválido.");
    try {
      dados = JSON.parse(String(form.get("dados") ?? ""));
    } catch {
      throw invalido('Envie o campo "dados" com o JSON do protocolo.');
    }
    for (const f of form.getAll("arquivos")) if (f instanceof File && f.size > 0) anexos.push({ arquivo: Buffer.from(await f.arrayBuffer()), nome_arquivo: f.name, mime: f.type });
  } else {
    dados = await req.json().catch(() => {
      throw invalido("Corpo JSON inválido.");
    });
  }
  const r = await registrarProtocolo(ctx, dados, anexos);
  return NextResponse.json(r, { status: 201 });
});
