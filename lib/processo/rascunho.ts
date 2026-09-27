import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { auditar } from "../audit";
import { invalido, naoEncontrado, proibido } from "../http";
import { can, isInterno, isSomenteLeitura, podeVerMunicipio, temPapel, type UsuarioSessao } from "../rbac";
import { EnderecoSchema } from "../cadastros/validacao";
import { calcularPorte } from "./porte";
import { obterProcessoAutorizado, UUID_RE } from "./consultas";

// Requerimento em RASCUNHO (wizard do requerente, SPEC 10): empreendimento → tipologia/porte → tipo de ato.
// Documentos (passo 4) são anexados ao rascunho; protocolo (passo 5) via transicionar("protocolar").

const uuid = (msg: string) => z.string().regex(UUID_RE, msg);
const num = (min: number, max: number, msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: msg });
      return z.NEVER;
    }
    return n;
  });
const numOpc = (min: number, max: number, msg: string) => z.union([num(min, max, msg), z.literal(""), z.null(), z.undefined()]).transform((v) => (v === "" || v === undefined ? null : v));

export const RascunhoSchema = z
  .object({
    processo_id: uuid("Rascunho inválido.").optional().nullable(),
    requerente_id: uuid("Requerente inválido.").optional().nullable(), // somente perfis internos
    empreendimento_id: uuid("Empreendimento inválido.").optional().nullable(),
    empreendimento: z
      .object({
        nome: z.string().trim().min(3, "Informe o nome do empreendimento (mín. 3 caracteres).").max(200),
        municipio_id: uuid("Selecione o município."),
        endereco: EnderecoSchema.optional().nullable(),
        latitude: num(-90, 90, "Marque o ponto do empreendimento no mapa."),
        longitude: num(-180, 180, "Marque o ponto do empreendimento no mapa."),
        area_m2: numOpc(0, 1e12, "Área inválida."),
        numero_car: z.string().trim().max(100).optional().nullable(),
      })
      .optional()
      .nullable(),
    tipologia_id: uuid("Selecione a tipologia."),
    grandeza: num(0, 1e12, "Informe a grandeza (número ≥ 0)."),
    tipo_ato_id: uuid("Selecione o tipo de ato."),
    descricao_atividade: z.string().trim().max(5000).optional().nullable(),
  })
  .refine((v) => !!v.empreendimento_id || !!v.empreendimento, { message: "Escolha um empreendimento existente ou cadastre um novo.", path: ["empreendimento"] });

export type RascunhoEntrada = z.input<typeof RascunhoSchema>;

/** Pessoa requerente do rascunho conforme o perfil. */
function requerenteDe(u: UsuarioSessao, informado: string | null | undefined): string {
  if (isInterno(u)) {
    if (!informado) throw invalido("Informe o requerente.", { campo: "requerente_id" });
    return informado;
  }
  if (!u.pessoa_id) throw invalido("Seu usuário não está vinculado a um cadastro de pessoa (CPF/CNPJ). Procure o órgão ambiental.");
  return u.pessoa_id;
}

export async function salvarRascunho(entrada: unknown, u: UsuarioSessao) {
  if (isSomenteLeitura(u)) throw proibido();
  if (!temPapel(u, "REQUERENTE") && !can(u, "criar", "processo")) throw proibido("Sem permissão para criar requerimentos.");
  const e = RascunhoSchema.parse(entrada);
  const requerenteId = requerenteDe(u, e.requerente_id);
  const pessoa = await prisma.pessoa.findUnique({ where: { id: requerenteId }, select: { id: true } });
  if (!pessoa) throw invalido("Requerente não encontrado.");

  const existente = e.processo_id ? await obterProcessoAutorizado(e.processo_id, u) : null;
  if (existente && existente.status !== "RASCUNHO") throw invalido("Somente rascunhos podem ser alterados.");

  const [tipologia, tipoAto] = await Promise.all([prisma.tipologia.findUnique({ where: { id: e.tipologia_id } }), prisma.tipoAto.findUnique({ where: { id: e.tipo_ato_id } })]);
  if (!tipologia?.ativo) throw invalido("Tipologia inválida.");
  if (!tipoAto?.ativo) throw invalido("Tipo de ato inválido.");
  const porte = calcularPorte(tipologia.faixas_porte, e.grandeza);
  if (!porte) throw invalido("Não foi possível calcular o porte para a grandeza informada.");

  return prisma.$transaction(async (tx) => {
    // ── Empreendimento ──
    let emp;
    if (e.empreendimento_id) {
      emp = await tx.empreendimento.findUnique({ where: { id: e.empreendimento_id }, include: { rts: { where: { ate: null }, orderBy: { desde: "desc" }, take: 1 } } });
      if (!emp) throw naoEncontrado("Empreendimento não encontrado.");
      if (isInterno(u) ? !podeVerMunicipio(u, emp.municipio_id) || !can(u, "criar", "processo", emp.municipio_id) : emp.requerente_id !== requerenteId) throw proibido("Empreendimento fora do seu acesso.");
      if (emp.requerente_id !== requerenteId) throw invalido("O empreendimento pertence a outro requerente.");
      const mudou = emp.tipologia_id !== tipologia.id || Number(emp.grandeza_porte ?? -1) !== e.grandeza;
      if (mudou) {
        const antes = { tipologia_id: emp.tipologia_id, grandeza_porte: emp.grandeza_porte, porte: emp.porte };
        const novo = await tx.empreendimento.update({ where: { id: emp.id }, data: { tipologia_id: tipologia.id, grandeza_porte: e.grandeza, porte, potencial_poluidor: tipologia.potencial_poluidor } });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "empreendimento", entidade_id: emp.id, antes, depois: { tipologia_id: novo.tipologia_id, grandeza_porte: novo.grandeza_porte, porte: novo.porte } }, tx);
      }
    } else {
      const d = e.empreendimento!;
      const mun = await tx.municipio.findUnique({ where: { id: d.municipio_id } });
      if (!mun?.ativo) throw invalido("Município inválido.");
      if (isInterno(u) && !can(u, "criar", "processo", mun.id)) throw proibido("Sem permissão neste município.");
      const alvo = existente?.empreendimento_id ? await tx.empreendimento.findUnique({ where: { id: existente.empreendimento_id } }) : null;
      // Rascunho com empreendimento criado por ele mesmo e ainda sem outros processos: atualiza em vez de duplicar
      const reaproveitar = alvo && alvo.requerente_id === requerenteId && (await tx.processo.count({ where: { empreendimento_id: alvo.id, NOT: { id: existente!.id } } })) === 0;
      const dados = {
        organizacao_id: mun.organizacao_id,
        municipio_id: mun.id,
        requerente_id: requerenteId,
        nome: d.nome,
        endereco: (d.endereco ?? undefined) as Prisma.InputJsonValue | undefined,
        latitude: d.latitude,
        longitude: d.longitude,
        tipologia_id: tipologia.id,
        grandeza_porte: e.grandeza,
        porte,
        potencial_poluidor: tipologia.potencial_poluidor,
        area_m2: d.area_m2,
        numero_car: d.numero_car || null,
      };
      if (reaproveitar) {
        emp = await tx.empreendimento.update({ where: { id: alvo.id }, data: dados, include: { rts: { where: { ate: null }, take: 1 } } });
        await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "empreendimento", entidade_id: emp.id, antes: alvo, depois: emp }, tx);
      } else {
        emp = await tx.empreendimento.create({ data: { ...dados, created_by: u.id }, include: { rts: { where: { ate: null }, take: 1 } } });
        await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "empreendimento", entidade_id: emp.id, depois: emp }, tx);
      }
    }
    if (tipoAto.organizacao_id !== emp.organizacao_id) throw invalido("Tipo de ato não disponível para este município.");

    // ── Processo (RASCUNHO) ──
    const dadosProc = {
      organizacao_id: emp.organizacao_id,
      municipio_id: emp.municipio_id,
      empreendimento_id: emp.id,
      requerente_id: requerenteId,
      rt_id: emp.rts[0]?.rt_id ?? null,
      tipo_ato_id: tipoAto.id,
      descricao_atividade: e.descricao_atividade || null,
    };
    if (existente) {
      const p = await tx.processo.update({ where: { id: existente.id }, data: dadosProc });
      await auditar({ usuario_id: u.id, acao: "EDITAR", entidade: "processo", entidade_id: p.id, antes: { empreendimento_id: existente.empreendimento_id, tipo_ato_id: existente.tipo_ato_id }, depois: dadosProc }, tx);
      return p;
    }
    const p = await tx.processo.create({ data: { ...dadosProc, status: "RASCUNHO", created_by: u.id } });
    await tx.tramitacao.create({ data: { processo_id: p.id, acao: "criar", de_status: null, para_status: "RASCUNHO", de_usuario_id: u.id, despacho: "Rascunho de requerimento criado.", publico: false } });
    await auditar({ usuario_id: u.id, acao: "CRIAR", entidade: "processo", entidade_id: p.id, depois: p }, tx);
    return p;
  });
}
