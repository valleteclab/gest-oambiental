import { getUsuario } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { invalido, naoAutenticado, naoEncontrado, proibido, rota } from "@/lib/http";
import { can } from "@/lib/rbac";
import { lerFiltros, municipioPermitido } from "@/lib/indicadores/filtros";
import { montarRelatorio } from "@/lib/relatorios/dados";
import { ehTipoRelatorio } from "@/lib/relatorios/modelo";
import { relatorioPdf, relatorioXlsx } from "@/lib/relatorios/render";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/relatorios/{tipo}?formato=pdf|xlsx&municipio=&de=&ate=&tipo_ato=&tecnico= (SPEC 11/12). */
export const GET = rota(async (req: Request, ctx: { params: Promise<{ tipo: string }> }) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!can(u, "ver", "relatorio")) throw proibido();
  const { tipo } = await ctx.params;
  if (!ehTipoRelatorio(tipo)) throw naoEncontrado("Relatório inexistente.");
  const url = new URL(req.url);
  const formato = (url.searchParams.get("formato") ?? "pdf").toLowerCase();
  if (formato !== "pdf" && formato !== "xlsx") throw invalido("Formato deve ser pdf ou xlsx.");
  const filtros = lerFiltros(url.searchParams);
  if (!municipioPermitido(u, filtros)) throw proibido("Município fora do seu escopo.");

  const rel = await montarRelatorio(tipo, u, filtros);
  const org = await prisma.organizacao.findFirst({ select: { nome: true, sigla: true, logo_url: true } });
  const municipio = rel.filtros.find(([k]) => k === "Município")?.[1] ?? "Todos os municípios";
  const cab = {
    organizacao: org?.nome ?? "LicenciaGov",
    organizacao_sigla: org?.sigla ?? "LicenciaGov",
    municipio: municipio === "Todos os municípios" ? "Todos os municípios" : `Município de ${municipio}`,
    emitido_em: new Date(),
    usuario: u.nome,
  };
  const buf = formato === "pdf" ? await relatorioPdf(rel, cab, org?.logo_url) : await relatorioXlsx(rel, cab, org?.logo_url);

  await auditar({
    usuario_id: u.id,
    acao: "RELATORIO_EXPORTADO",
    entidade: "relatorio",
    entidade_id: tipo,
    depois: { tipo, formato, filtros, linhas: rel.secoes.reduce((s, x) => s + x.linhas.length, 0) },
  });

  const data = cab.emitido_em.toISOString().slice(0, 10);
  const nome = `relatorio-${tipo}-${data}.${formato}`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
});
