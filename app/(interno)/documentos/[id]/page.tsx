import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { urlValidacao } from "@/lib/documentos";
import { ROTULO_STATUS_PUBLICO, ROTULO_TIPO_DOCUMENTO, statusPublico } from "@/lib/documentos/render";
import { can, isSomenteLeitura, podeVerMunicipio } from "@/lib/rbac";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormCancelar, FormSubstituir } from "./formularios";

export const metadata: Metadata = { title: "Documento emitido" };
const COR = { VALIDO: "verde", VENCIDO: "amarelo", CANCELADO: "vermelho", SUBSTITUIDO: "amarelo" } as const;

export default async function DocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await exigirUsuario({ interno: true });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await prisma.documentoOficial.findUnique({ where: { id }, include: { municipio: true, processo: { select: { id: true, numero: true } } } });
  if (!d) notFound();
  if (!podeVerMunicipio(u, d.municipio_id) || !can(u, "ver", "documento", d.municipio_id))
    return <Aviso tipo="erro"><span data-testid="acesso-negado">Acesso negado (403): este documento pertence a um município fora do seu escopo.</span></Aviso>;

  const [titular, substituto, substituidos, logs] = await Promise.all([
    d.titular_id ? prisma.pessoa.findUnique({ where: { id: d.titular_id }, select: { id: true, nome: true, cpf_cnpj_mascara: true } }) : null,
    d.substituto_id ? prisma.documentoOficial.findUnique({ where: { id: d.substituto_id }, select: { id: true, numero: true } }) : null,
    prisma.documentoOficial.findMany({ where: { substituto_id: d.id }, select: { id: true, numero: true } }),
    prisma.logAuditoria.findMany({ where: { entidade: "documento_oficial", entidade_id: d.id }, orderBy: { created_at: "asc" }, include: { usuario: { select: { nome: true } } } }),
  ]);
  const s = statusPublico(d);
  const ctx = ((d.dados as Record<string, unknown> | null)?._contexto ?? {}) as { titulo?: string; modelo?: string; empreendimento?: { nome?: string } };
  const podeCancelar = d.status === "VALIDO" && !isSomenteLeitura(u) && can(u, "cancelar_documento", "documento", d.municipio_id);
  const podeSubstituir = podeCancelar && can(u, "emitir_documento", "documento", d.municipio_id);
  const linhas: [string, React.ReactNode][] = [
    ["Tipo", `${ctx.titulo ?? ROTULO_TIPO_DOCUMENTO[d.tipo]} (${ROTULO_TIPO_DOCUMENTO[d.tipo]})`],
    ["Município", d.municipio.nome],
    ["Processo", d.processo ? <Link key="p" className="text-primaria-700 underline" href={`/processos/${d.processo.id}`}>{d.processo.numero}</Link> : "—"],
    ["Titular", titular ? `${titular.nome} (${titular.cpf_cnpj_mascara})` : "—"],
    ["Empreendimento", ctx.empreendimento?.nome ?? "—"],
    ["Emitido em", `${fmtDataHora(d.emitido_em)} por ${d.emitido_por_nome}${d.emitido_por_cargo ? ` – ${d.emitido_por_cargo}` : ""}`],
    ["Validade", fmtData(d.validade_ate)],
    ["Código verificador", <span key="c" className="font-mono">{d.codigo_verificador}</span>],
    ["SHA-256 do PDF", <span key="h" className="break-all font-mono text-xs">{d.sha256_pdf}</span>],
    ["Modelo", ctx.modelo === "embutido" || !ctx.modelo ? "Modelo padrão do sistema" : "Modelo configurado (admin)"],
  ];

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo={`${ROTULO_TIPO_DOCUMENTO[d.tipo]} ${d.numero}`}
        subtitulo={<Badge cor={COR[s]}>{ROTULO_STATUS_PUBLICO[s]}</Badge>}
        acoes={
          <>
            <a className="btn-primario" href={`/api/v1/documentos/${d.id}/pdf`} target="_blank" rel="noopener">Abrir PDF</a>
            <a className="btn-secundario" href={urlValidacao(d.codigo_verificador).replace(/^https?:\/\/[^/]+/, "")} target="_blank" rel="noopener">Página de validação</a>
            <Link className="btn-secundario" href="/documentos">Voltar</Link>
          </>
        }
      />
      {d.status !== "VALIDO" && (
        <Aviso tipo="alerta">
          {d.status === "CANCELADO" ? "Documento cancelado" : "Documento substituído"} em {fmtDataHora(d.cancelado_em)}. Motivo: {d.motivo_cancelamento}
          {substituto && <> · Substituto: <Link className="font-semibold underline" href={`/documentos/${substituto.id}`}>{substituto.numero}</Link></>}
        </Aviso>
      )}
      {substituidos.length > 0 && <Aviso>Este documento substitui: {substituidos.map((x) => <Link key={x.id} className="font-semibold underline" href={`/documentos/${x.id}`}>{x.numero} </Link>)}</Aviso>}

      <Card titulo="Dados do documento">
        <dl className="divide-y divide-slate-100">
          {linhas.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2 sm:grid-cols-4 sm:gap-4">
              <dt className="text-sm font-medium text-slate-600">{k}</dt>
              <dd className="text-sm sm:col-span-3">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {podeCancelar && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card titulo="Corrigir: emitir substituto">
            <p className="mb-3 text-sm text-slate-600">
              Documento emitido é imutável. Para corrigir um erro, primeiro ajuste o cadastro de origem (titular, empreendimento, condicionantes) e então emita o
              substituto: ele recebe novo número e novo código, e este documento passa a constar como <strong>SUBSTITUÍDO</strong> na validação pública.
            </p>
            {podeSubstituir ? <FormSubstituir id={d.id} temValidade={!!d.validade_ate} /> : <p className="text-sm text-slate-500">Seu perfil não pode emitir documentos.</p>}
          </Card>
          <Card titulo="Cancelar documento">
            <p className="mb-3 text-sm text-slate-600">O cancelamento não altera o PDF: a página pública de validação passa a mostrar <strong>CANCELADO</strong> com o motivo informado.</p>
            <FormCancelar id={d.id} />
          </Card>
        </div>
      )}

      <Card titulo="Histórico (auditoria)">
        {logs.length === 0 ? <p className="text-sm text-slate-500">Sem registros.</p> : (
          <ul className="space-y-1 text-sm">
            {logs.map((l) => (
              <li key={l.id}><span className="text-slate-500">{fmtDataHora(l.created_at)}</span> · {l.acao.replaceAll("_", " ").toLowerCase()} · {l.usuario?.nome ?? "sistema"}</li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
