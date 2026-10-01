import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { acompanharDenuncia } from "@/lib/agente/acompanhar";
import { excedeuLimite } from "@/lib/fiscalizacao/antiabuso";
import { fmtData, fmtDataHora } from "@/lib/format";
import { Aviso, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Acompanhar denúncia" };

const COR = { NOVA: "azul", EM_APURACAO: "amarelo", CONCLUIDA: "verde", ARQUIVADA: "cinza" } as const;

export default async function AcompanharDenuncia({ searchParams }: { searchParams: Promise<{ protocolo?: string; contato?: string }> }) {
  const { protocolo = "", contato = "" } = await searchParams;
  const buscou = !!protocolo.trim() && !!contato.trim();
  let limitado = false;
  let r: Awaited<ReturnType<typeof acompanharDenuncia>> = null;
  if (buscou) {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    limitado = excedeuLimite(`acomp:${ip}`, 15, 10 * 60 * 1000);
    if (!limitado) r = await acompanharDenuncia(protocolo, contato);
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="titulo-pagina">Acompanhar denúncia</h1>
        <p className="mt-1 text-sm text-slate-600">
          Informe o protocolo (ex.: DEN-LOR-001/2026) e o <strong>mesmo telefone ou e-mail</strong> usado no registro da denúncia (WhatsApp, chat ou formulário).
          Por segurança, a situação só é mostrada a quem registrou.
        </p>
      </div>
      <form method="get" action="/denuncia/acompanhar" className="card grid gap-4 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block" htmlFor="protocolo">
          <span className="label">Protocolo</span>
          <input id="protocolo" name="protocolo" required defaultValue={protocolo} className="input font-mono uppercase" placeholder="DEN-LOR-001/2026" autoComplete="off" maxLength={30} />
        </label>
        <label className="block" htmlFor="contato">
          <span className="label">Telefone (com DDD) ou e-mail</span>
          <input id="contato" name="contato" required defaultValue={contato} className="input" placeholder="(75) 99999-8888" autoComplete="off" maxLength={150} />
        </label>
        <button type="submit" className="btn-primario">Consultar</button>
      </form>

      {limitado && <Aviso tipo="alerta">Muitas consultas seguidas. Aguarde alguns minutos e tente novamente.</Aviso>}
      {buscou && !limitado && !r && (
        <Aviso tipo="erro">Não encontramos denúncia com esse protocolo vinculada a esse telefone/e-mail. Confira os dados. Denúncias anônimas sem contato podem ser consultadas somente pela situação, na Secretaria.</Aviso>
      )}
      {r && (
        <section className="card space-y-4 p-5" data-testid="resultado-denuncia">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500">Protocolo</p>
              <p className="font-mono text-xl font-semibold">{r.protocolo}</p>
              <p className="text-sm text-slate-600">{r.orgao} – {r.municipio}</p>
            </div>
            <Badge cor={COR[r.status]}>{r.situacao}</Badge>
          </div>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Registrada em</dt><dd className="font-medium">{fmtData(r.registrada_em)}</dd></div>
            <div><dt className="text-slate-500">Local</dt><dd className="font-medium">{r.endereco ?? "—"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-500">Descrição</dt><dd className="whitespace-pre-line">{r.descricao}</dd></div>
            {r.fotos > 0 && <div><dt className="text-slate-500">Fotos enviadas</dt><dd className="font-medium">{r.fotos}</dd></div>}
          </dl>
          <div>
            <h2 className="text-sm font-semibold">Linha do tempo</h2>
            <ol className="mt-2 space-y-1 text-sm">
              {r.linha_do_tempo.map((t, i) => <li key={i}><span className="text-slate-500">{fmtDataHora(t.em)}</span> – {t.situacao}</li>)}
            </ol>
          </div>
        </section>
      )}
      <p className="text-sm text-slate-600"><Link href="/denuncia" className="underline">Fazer uma nova denúncia</Link></p>
    </div>
  );
}
