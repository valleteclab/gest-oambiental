import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUsuario } from "@/lib/auth";
import { decifrar } from "@/lib/crypto";
import { urlValidacao } from "@/lib/documentos";
import { invalido, naoAutenticado, paginacao, proibido, rota } from "@/lib/http";
import { can, isInterno, podeVerMunicipio, whereProcessoEscopo } from "@/lib/rbac";
import { FORMATO_SEIA, paraSeia, TIPOS_DOCUMENTO_SEIA } from "@/lib/integracao/seia";

export const dynamic = "force-dynamic";

const STATUS = ["PROTOCOLADO", "EM_TRIAGEM", "AGUARDANDO_REQUERENTE", "EM_ANALISE", "AGUARDANDO_VISTORIA", "AGUARDANDO_DECISAO", "DEFERIDO", "INDEFERIDO", "CONCLUIDO", "ARQUIVADO"] as const;

const Filtros = z.object({
  desde: z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Data/hora ISO 8601 inválida (ex.: 2026-01-31 ou 2026-01-31T12:00:00Z).")
    .transform((v) => new Date(v))
    .optional(),
  municipio: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, "Sigla de município inválida.").optional(),
  status: z.enum(STATUS).optional(),
});

/**
 * GET /api/v1/integracao/seia/processos?desde=&municipio=&status=&page=&size= (SPEC §2 P2 / §12)
 * Feed somente leitura para o SEIA (SEMA/INEMA): processos protocolados do escopo do usuário, ordenados por
 * atualização (sincronização incremental com `desde`). Sem despachos/pareceres; requerente com documento mascarado.
 */
export const GET = rota(async (req: Request) => {
  const u = await getUsuario();
  if (!u) throw naoAutenticado();
  if (!isInterno(u) || !can(u, "ver", "processo")) throw proibido();
  const url = new URL(req.url);
  const pg = paginacao(url);
  const q = Object.fromEntries([...url.searchParams].filter(([k, v]) => ["desde", "municipio", "status"].includes(k) && v !== ""));
  const f = Filtros.safeParse(q);
  if (!f.success) throw invalido("Parâmetros inválidos.", f.error.issues);
  const { desde, municipio, status } = f.data;

  let municipioId: string | null = null;
  if (municipio) {
    const m = await prisma.municipio.findUnique({ where: { sigla: municipio }, select: { id: true } });
    if (!m) throw invalido("Município não encontrado.", { campo: "municipio" });
    if (!podeVerMunicipio(u, m.id)) throw proibido("Município fora do seu escopo.");
    municipioId = m.id;
  }

  const where: Prisma.ProcessoWhereInput = {
    AND: [
      whereProcessoEscopo(u, municipioId),
      { status: status ?? { not: "RASCUNHO" }, numero: { not: null } },
      desde ? { OR: [{ updated_at: { gte: desde } }, { documentos: { some: { updated_at: { gte: desde } } } }] } : {},
    ],
  };

  const [total, processos] = await Promise.all([
    prisma.processo.count({ where }),
    prisma.processo.findMany({
      where,
      orderBy: [{ updated_at: "asc" }, { id: "asc" }],
      skip: pg.skip,
      take: pg.take,
      select: {
        numero: true,
        status: true,
        data_protocolo: true,
        data_conclusao: true,
        created_at: true,
        updated_at: true,
        municipio: { select: { codigo_ibge: true, nome: true, sigla: true } },
        tipo_ato: { select: { sigla: true, nome: true } },
        empreendimento: {
          select: {
            nome: true, latitude: true, longitude: true, numero_car: true, porte: true, potencial_poluidor: true,
            tipologia: { select: { codigo: true, descricao: true } },
          },
        },
        requerente: { select: { nome: true, tipo: true, cpf_cnpj_cifrado: true, cpf_cnpj_mascara: true } },
        documentos: {
          where: { tipo: { in: [...TIPOS_DOCUMENTO_SEIA] } },
          orderBy: { emitido_em: "asc" },
          select: { tipo: true, numero: true, sigla_ato: true, emitido_em: true, validade_ate: true, status: true, codigo_verificador: true, sha256_pdf: true },
        },
      },
    }),
  ]);

  const items = processos.map((p) => {
    let documento: string | null = null;
    try {
      documento = decifrar(p.requerente.cpf_cnpj_cifrado);
    } catch {
      documento = null; // chave diferente/dado corrompido → usa a máscara salva
    }
    return paraSeia({ ...p, requerente: { nome: p.requerente.nome, tipo: p.requerente.tipo, documento, cpf_cnpj_mascara: p.requerente.cpf_cnpj_mascara } }, urlValidacao);
  });

  return NextResponse.json(
    { formato: FORMATO_SEIA, gerado_em: new Date().toISOString(), page: pg.page, size: pg.size, total, items },
    { headers: { "X-LicenciaGov-Formato": "LicenciaGov-SEIA v0", "Cache-Control": "no-store" } },
  );
});
