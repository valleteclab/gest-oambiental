import "server-only";
import { Prisma, type Empreendimento, type Porte } from "@prisma/client";
import { prisma } from "@/lib/db";
import { auditar } from "@/lib/audit";
import { invalido, naoEncontrado, proibido } from "@/lib/http";
import { can, isInterno, podeVerMunicipio, temPapel, type UsuarioSessao } from "@/lib/rbac";
import { whereEmpreendimentoEscopo } from "./escopo";
import { podeVerPessoa } from "./pessoas";
import { calcularPorte } from "./porte";
import { EmpreendimentoSchema } from "./validacao";
import { hojeDataPura } from "./datas";

// Empreendimentos (SPEC 5.2): porte calculado pela tipologia + grandeza; ajuste manual só por técnico com justificativa.

/** Quem pode sobrepor o porte calculado. */
export function podeAjustarPorte(u: UsuarioSessao, municipioId?: string) {
  return temPapel(u, "ADMIN", "TEC_CONSORCIO", "TEC_MUNICIPAL") && can(u, "editar", "empreendimento", municipioId);
}

export type FiltroEmpreendimentos = { q?: string | null; municipio_id?: string | null; tipologia_id?: string | null; status?: "ATIVO" | "INATIVO" | null; requerente_id?: string | null; skip?: number; take?: number };

export async function listarEmpreendimentos(u: UsuarioSessao, f: FiltroEmpreendimentos) {
  const q = (f.q ?? "").trim();
  const where: Prisma.EmpreendimentoWhereInput = {
    AND: [
      whereEmpreendimentoEscopo(u, f.municipio_id || null),
      f.tipologia_id ? { tipologia_id: f.tipologia_id } : {},
      f.status ? { status: f.status } : {},
      f.requerente_id ? { requerente_id: f.requerente_id } : {},
      q ? { OR: [{ nome: { contains: q, mode: "insensitive" } }, { requerente: { nome: { contains: q, mode: "insensitive" } } }, { numero_car: { contains: q, mode: "insensitive" } }] } : {},
    ],
  };
  const [total, itens] = await Promise.all([
    prisma.empreendimento.count({ where }),
    prisma.empreendimento.findMany({
      where,
      include: {
        municipio: { select: { nome: true, sigla: true } },
        requerente: { select: { id: true, nome: true } },
        tipologia: { select: { codigo: true, descricao: true } },
        _count: { select: { processos: true } },
      },
      orderBy: { nome: "asc" },
      skip: f.skip ?? 0,
      take: f.take ?? 20,
    }),
  ]);
  return { total, itens };
}

/** Empreendimento com checagem de escopo: null (não existe) | "PROIBIDO" | registro. */
export async function obterEmpreendimentoBasico(u: UsuarioSessao, id: string): Promise<Empreendimento | null | "PROIBIDO"> {
  const e = await prisma.empreendimento.findUnique({ where: { id } }).catch(() => null);
  if (!e) return null;
  if (isInterno(u)) return podeVerMunicipio(u, e.municipio_id) ? e : "PROIBIDO";
  const ok = await prisma.empreendimento.count({ where: { AND: [{ id }, whereEmpreendimentoEscopo(u)] } });
  return ok ? e : "PROIBIDO";
}

function paraLog(e: Empreendimento | null, rt_id?: string | null) {
  if (!e) return null;
  const resto: Partial<Empreendimento> = { ...e };
  delete resto.created_at;
  delete resto.updated_at;
  return rt_id === undefined ? resto : { ...resto, rt_id };
}

type Resolvido = { porte: Porte; potencial: Empreendimento["potencial_poluidor"]; justificativa: string | null; calculado: Porte | null };

async function resolverPorte(u: UsuarioSessao, municipioId: string, tipologiaId: string, grandeza: number | null, porteInformado: Porte | null | undefined, justificativa: string | null, porteAtual?: Porte): Promise<Resolvido> {
  const [tip, mun] = await Promise.all([prisma.tipologia.findUnique({ where: { id: tipologiaId } }), prisma.municipio.findUnique({ where: { id: municipioId }, select: { organizacao_id: true } })]);
  if (!tip || !tip.ativo) throw invalido("Tipologia inválida ou inativa.", { campo: "tipologia_id" });
  // Isolamento por organização: a tipologia precisa ser do catálogo da organização do município.
  if (!mun || tip.organizacao_id !== mun.organizacao_id) throw invalido("Tipologia não disponível para este município.", { campo: "tipologia_id" });
  const calculado = calcularPorte(tip.faixas_porte, grandeza);
  // Mantém o porte ajustado anteriormente se o formulário não mandou outro valor.
  const final = porteInformado ?? (porteAtual && justificativa ? porteAtual : calculado);
  if (!final) throw invalido(`Informe a grandeza (${tip.unidade_porte}) para calcular o porte.`, { campo: "grandeza_porte" });
  if (final !== calculado) {
    if (!podeAjustarPorte(u, municipioId)) throw proibido("Somente o técnico pode ajustar o porte calculado.");
    if (!justificativa || justificativa.length < 10) throw invalido("Justifique o ajuste do porte (mín. 10 caracteres).", { campo: "porte_justificativa" });
    return { porte: final, potencial: tip.potencial_poluidor, justificativa, calculado };
  }
  return { porte: final, potencial: tip.potencial_poluidor, justificativa: null, calculado };
}

async function checarRequerente(u: UsuarioSessao, requerenteId: string) {
  if (!isInterno(u)) {
    if (u.pessoa_id !== requerenteId) throw proibido("O requerente só pode cadastrar empreendimentos em seu próprio nome.");
    return;
  }
  const existe = await prisma.pessoa.count({ where: { id: requerenteId } });
  if (!existe) throw invalido("Requerente não encontrado.", { campo: "requerente_id" });
  if (!(await podeVerPessoa(u, requerenteId)) && !can(u, "criar", "pessoa")) throw proibido("Requerente fora do seu escopo.");
}

async function trocarRt(tx: Prisma.TransactionClient, empreendimentoId: string, rtId: string | null) {
  const ativo = await tx.empreendimentoRt.findFirst({ where: { empreendimento_id: empreendimentoId, ate: null } });
  if ((ativo?.rt_id ?? null) === rtId) return false;
  const hoje = hojeDataPura();
  if (ativo) await tx.empreendimentoRt.update({ where: { id: ativo.id }, data: { ate: hoje } });
  if (rtId) await tx.empreendimentoRt.create({ data: { empreendimento_id: empreendimentoId, rt_id: rtId, desde: hoje } });
  return true;
}

export async function criarEmpreendimento(u: UsuarioSessao, entrada: unknown) {
  const e = EmpreendimentoSchema.parse(entrada);
  if (!can(u, "criar", "empreendimento", e.municipio_id)) throw proibido("Sem permissão para cadastrar empreendimentos neste município.");
  const mun = await prisma.municipio.findUnique({ where: { id: e.municipio_id } });
  if (!mun || !mun.ativo) throw invalido("Município inválido ou inativo.", { campo: "municipio_id" });
  await checarRequerente(u, e.requerente_id);
  if (e.rt_id && !(await prisma.responsavelTecnico.count({ where: { id: e.rt_id } }))) throw invalido("Responsável técnico não encontrado.", { campo: "rt_id" });
  const r = await resolverPorte(u, e.municipio_id, e.tipologia_id, e.grandeza_porte, e.porte, e.porte_justificativa);
  return prisma.$transaction(async (tx) => {
    const emp = await tx.empreendimento.create({
      data: {
        organizacao_id: mun.organizacao_id, municipio_id: e.municipio_id, requerente_id: e.requerente_id, nome: e.nome,
        endereco: (e.endereco ?? undefined) as Prisma.InputJsonValue | undefined,
        latitude: e.latitude, longitude: e.longitude,
        poligono_geojson: (e.poligono_geojson ?? undefined) as Prisma.InputJsonValue | undefined,
        tipologia_id: e.tipologia_id, grandeza_porte: e.grandeza_porte, porte: r.porte, porte_justificativa: r.justificativa,
        potencial_poluidor: r.potencial, area_m2: e.area_m2, numero_car: e.numero_car, status: e.status ?? "ATIVO", created_by: u.id,
      },
    });
    if (e.rt_id) await trocarRt(tx, emp.id, e.rt_id);
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "empreendimento", entidade_id: emp.id, depois: paraLog(emp, e.rt_id ?? null) }, tx);
    return emp;
  });
}

export async function atualizarEmpreendimento(u: UsuarioSessao, id: string, entrada: unknown) {
  const atual = await prisma.empreendimento.findUnique({ where: { id }, include: { rts: { where: { ate: null } } } }).catch(() => null);
  if (!atual) throw naoEncontrado("Empreendimento não encontrado.");
  if (!isInterno(u) || !podeVerMunicipio(u, atual.municipio_id)) throw proibido();
  if (!can(u, "editar", "empreendimento", atual.municipio_id)) throw proibido("Sem permissão para editar este empreendimento.");
  const rtAtual = atual.rts[0]?.rt_id ?? null;
  const parcial = (entrada ?? {}) as Record<string, unknown>;
  const e = EmpreendimentoSchema.parse({
    municipio_id: atual.municipio_id, requerente_id: atual.requerente_id, nome: atual.nome, endereco: atual.endereco,
    latitude: atual.latitude?.toString() ?? null, longitude: atual.longitude?.toString() ?? null, poligono_geojson: atual.poligono_geojson,
    tipologia_id: atual.tipologia_id, grandeza_porte: atual.grandeza_porte?.toString() ?? null, porte_justificativa: atual.porte_justificativa,
    area_m2: atual.area_m2?.toString() ?? null, numero_car: atual.numero_car, status: atual.status, rt_id: rtAtual,
    ...parcial,
  });
  if (e.municipio_id !== atual.municipio_id && !can(u, "editar", "empreendimento", e.municipio_id)) throw proibido("Sem permissão no município de destino.");
  if (e.requerente_id !== atual.requerente_id) await checarRequerente(u, e.requerente_id);
  if (e.rt_id && e.rt_id !== rtAtual && !(await prisma.responsavelTecnico.count({ where: { id: e.rt_id } }))) throw invalido("Responsável técnico não encontrado.", { campo: "rt_id" });
  const r = await resolverPorte(u, e.municipio_id, e.tipologia_id, e.grandeza_porte, e.porte, e.porte_justificativa, "porte" in parcial ? undefined : atual.porte);
  return prisma.$transaction(async (tx) => {
    const emp = await tx.empreendimento.update({
      where: { id },
      data: {
        municipio_id: e.municipio_id, requerente_id: e.requerente_id, nome: e.nome,
        endereco: e.endereco ? (e.endereco as Prisma.InputJsonValue) : Prisma.DbNull,
        latitude: e.latitude, longitude: e.longitude,
        poligono_geojson: e.poligono_geojson ? (e.poligono_geojson as Prisma.InputJsonValue) : Prisma.DbNull,
        tipologia_id: e.tipologia_id, grandeza_porte: e.grandeza_porte, porte: r.porte, porte_justificativa: r.justificativa,
        potencial_poluidor: r.potencial, area_m2: e.area_m2, numero_car: e.numero_car, status: e.status,
      },
    });
    await trocarRt(tx, id, e.rt_id ?? null);
    await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "empreendimento", entidade_id: id, antes: paraLog(atual as Empreendimento, rtAtual), depois: paraLog(emp, e.rt_id ?? null) }, tx);
    return emp;
  });
}

/** Ficha completa (T2): requerente, RT vigente + histórico, processos, licenças vinculadas, fiscalizações. */
export async function fichaEmpreendimento(id: string) {
  const emp = await prisma.empreendimento.findUnique({
    where: { id },
    include: {
      municipio: { select: { id: true, nome: true, sigla: true, latitude: true, longitude: true } },
      requerente: true,
      tipologia: true,
      rts: { include: { rt: { include: { pessoa: { select: { id: true, nome: true } } } } }, orderBy: [{ desde: "desc" }] },
      processos: {
        include: { tipo_ato: { select: { sigla: true, nome: true } }, rt: { include: { pessoa: { select: { nome: true } } } } },
        orderBy: [{ data_protocolo: "desc" }, { created_at: "desc" }],
      },
      fiscalizacoes: { orderBy: { data_hora: "desc" }, include: { _count: { select: { autos: true, notificacoes: true } } } },
    },
  });
  if (!emp) return null;
  const documentos = await prisma.documentoOficial.findMany({
    where: { processo: { empreendimento_id: id }, tipo: { in: ["LICENCA", "AUTORIZACAO", "CERTIDAO"] } },
    include: { processo: { select: { id: true, numero: true } } },
    orderBy: { emitido_em: "desc" },
  });
  return { ...emp, documentos };
}
