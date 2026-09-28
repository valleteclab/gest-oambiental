"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { registrarVistoriaDemanda } from "@/lib/demandas/actions";
import type { CondicionantePadrao } from "@/lib/demandas/catalogo";
import type { ItemChecklist } from "@/lib/processo/maquina";
import { FormAcao } from "../processos/_componentes/acoes-processo";
import { CamposChecklist } from "../processos/_componentes/formularios";

/** Vistoria de campo (APC) no celular: checklist + relato → registra a vistoria (agendar/concluir) de uma vez. */
export function VistoriaDemanda({ processoId, itens, respostas }: { processoId: string; itens: ItemChecklist[]; respostas: Record<string, unknown> }) {
  const [estado, enviar, pendente] = useActionState(registrarVistoriaDemanda.bind(null, processoId), undefined);
  const router = useRouter();
  useEffect(() => {
    if (estado?.ok) router.refresh();
  }, [estado, router]);
  return (
    <form action={enviar} className="space-y-4" data-testid="form-vistoria-demanda">
      <CamposChecklist itens={itens} respostas={respostas} editavel />
      <div>
        <label htmlFor="vistoria-relato" className="label">Relato complementar (opcional)</label>
        <textarea id="vistoria-relato" name="relato" className="input" rows={2} placeholder="Ex.: galhos sobre a rede de baixa tensão; raízes levantando a calçada." />
      </div>
      {estado?.erro && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{estado.erro}</p>}
      {estado?.ok && <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{estado.mensagem}</p>}
      <button className="btn-primario w-full sm:w-auto" disabled={pendente}>{pendente ? "Registrando…" : "Concluir vistoria"}</button>
    </form>
  );
}

/** Decisão simplificada: condicionantes-padrão editáveis (dB, horários, compensação…) + deferir; ou indeferir com motivo. */
export function DecisaoDemanda({ processoId, sugeridas, podeDeferir, podeIndeferir }: { processoId: string; sugeridas: CondicionantePadrao[]; podeDeferir: boolean; podeIndeferir: boolean }) {
  const [conds, setConds] = useState(sugeridas.map((c) => ({ descricao: c.descricao, periodicidade: c.periodicidade ?? "", prazo_dias: c.prazo_dias ? String(c.prazo_dias) : "" })));
  const [despacho, setDespacho] = useState("");
  const [motivo, setMotivo] = useState("");
  const [modo, setModo] = useState<"deferir" | "indeferir">("deferir");
  const payload = {
    despacho,
    condicionantes: conds.filter((c) => c.descricao.trim()).map((c) => ({ descricao: c.descricao.trim(), periodicidade: c.periodicidade || null, prazo_dias: c.prazo_dias ? Number(c.prazo_dias) : null })),
  };
  const upd = (n: number, campo: "descricao" | "prazo_dias", v: string) => setConds(conds.map((c, i) => (i === n ? { ...c, [campo]: v } : c)));
  return (
    <div className="space-y-4" data-testid="decisao-demanda">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decisão">
        {podeDeferir && <button type="button" role="radio" aria-checked={modo === "deferir"} className={modo === "deferir" ? "btn-primario btn-sm" : "btn-secundario btn-sm"} onClick={() => setModo("deferir")}>Deferir</button>}
        {podeIndeferir && <button type="button" role="radio" aria-checked={modo === "indeferir"} className={modo === "indeferir" ? "btn-perigo btn-sm" : "btn-secundario btn-sm text-red-800"} onClick={() => setModo("indeferir")}>Indeferir</button>}
      </div>
      {modo === "deferir" && podeDeferir ? (
        <FormAcao processoId={processoId} acao="deferir" payload={payload} rotuloBotao="Deferir e emitir autorização">
          <fieldset className="space-y-3">
            <legend className="label">Condicionantes (texto editável – constarão da autorização)</legend>
            {conds.map((c, n) => (
              <div key={n} className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_8rem_auto]">
                <div>
                  <label htmlFor={`dc-${n}`} className="text-xs font-medium text-slate-700">Condicionante {n + 1}</label>
                  <textarea id={`dc-${n}`} className="input" rows={3} value={c.descricao} onChange={(e) => upd(n, "descricao", e.target.value)} />
                </div>
                <div>
                  <label htmlFor={`dz-${n}`} className="text-xs font-medium text-slate-700">Prazo (dias)</label>
                  <input id={`dz-${n}`} type="number" min={1} className="input" value={c.prazo_dias} onChange={(e) => upd(n, "prazo_dias", e.target.value)} />
                </div>
                <div className="self-end">
                  <button type="button" className="btn-secundario btn-sm" onClick={() => setConds(conds.filter((_, i) => i !== n))} aria-label={`Remover condicionante ${n + 1}`}>Remover</button>
                </div>
              </div>
            ))}
            <button type="button" className="btn-secundario btn-sm" onClick={() => setConds([...conds, { descricao: "", periodicidade: "", prazo_dias: "" }])}>+ Adicionar condicionante</button>
          </fieldset>
          <div>
            <label htmlFor="dec-despacho" className="label">Despacho (opcional)</label>
            <textarea id="dec-despacho" className="input" rows={2} value={despacho} onChange={(e) => setDespacho(e.target.value)} />
          </div>
          <p className="text-xs text-slate-600">Ao confirmar, a autorização é emitida (PDF com QR Code) e o processo é concluído.</p>
        </FormAcao>
      ) : (
        podeIndeferir && (
          <FormAcao processoId={processoId} acao="indeferir" payload={{ motivo }} perigo rotuloBotao="Indeferir e emitir ofício">
            <div>
              <label htmlFor="dec-motivo" className="label">Motivação do indeferimento *</label>
              <textarea id="dec-motivo" className="input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
            </div>
          </FormAcao>
        )
      )}
    </div>
  );
}
