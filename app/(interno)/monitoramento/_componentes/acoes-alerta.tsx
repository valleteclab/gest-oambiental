"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StatusAlertaDesmatamento } from "@prisma/client";
import { TRANSICOES_ALERTA } from "@/lib/monitoramento/regras";
import { acaoAbrirFiscalizacao, acaoAlterarStatus } from "../actions";

type Doc = { id: string; numero: string; sigla_ato: string | null; validade: string | null; empreendimento: string | null; relacionado: boolean };

function Mensagem({ estado }: { estado: { erro?: string; ok?: string } | undefined }) {
  if (estado?.erro) return <p role="alert" className="text-sm text-red-700">{estado.erro}</p>;
  if (estado?.ok) return <p role="status" className="text-sm text-emerald-700">{estado.ok}</p>;
  return null;
}

export function AcoesAlerta({ id, status, temFiscalizacao, documentos, documentoSugerido }: { id: string; status: StatusAlertaDesmatamento; temFiscalizacao: boolean; documentos: Doc[]; documentoSugerido: string | null }) {
  const router = useRouter();
  const [fisc, abrir, abrindo] = useActionState(acaoAbrirFiscalizacao, undefined);
  const [st, alterar, alterando] = useActionState(acaoAlterarStatus, undefined);
  const [modo, setModo] = useState<"" | "AUTORIZADO" | "IRREGULAR" | "DESCARTADO">("");
  const permitidas = TRANSICOES_ALERTA[status];

  useEffect(() => {
    if (fisc?.fiscalizacao_id) router.push(`/fiscalizacao/${fisc.fiscalizacao_id}`);
  }, [fisc, router]);
  useEffect(() => {
    if (st?.ok) setModo("");
  }, [st]);

  return (
    <div className="space-y-4" data-testid="acoes-alerta">
      <div className="flex flex-wrap gap-2">
        {!temFiscalizacao && (
          <form action={abrir}>
            <input type="hidden" name="id" value={id} />
            <button className="btn-primario" disabled={abrindo} data-testid="abrir-fiscalizacao">{abrindo ? "Abrindo…" : "Abrir fiscalização"}</button>
          </form>
        )}
        {permitidas.includes("AUTORIZADO") && <button type="button" className="btn-secundario" onClick={() => setModo("AUTORIZADO")} data-testid="modo-autorizado">Marcar autorizado</button>}
        {permitidas.includes("IRREGULAR") && <button type="button" className="btn-secundario" onClick={() => setModo("IRREGULAR")} data-testid="modo-irregular">Marcar irregular</button>}
        {permitidas.includes("DESCARTADO") && <button type="button" className="btn-secundario" onClick={() => setModo("DESCARTADO")} data-testid="modo-descartar">Descartar</button>}
        {permitidas.includes("EM_ANALISE") && (
          <form action={alterar}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value="EM_ANALISE" />
            <button className="btn-secundario" disabled={alterando} data-testid="status-em-analise">{status === "NOVO" ? "Colocar em análise" : "Reabrir análise"}</button>
          </form>
        )}
      </div>
      <Mensagem estado={fisc} />

      {modo && (
        <form action={alterar} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3" data-testid={`form-${modo.toLowerCase()}`}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value={modo} />
          {modo === "AUTORIZADO" && (
            <div>
              <label htmlFor="documento_id" className="label">Licença/ASV que autoriza a supressão *</label>
              <select id="documento_id" name="documento_id" className="input" defaultValue={documentoSugerido ?? ""} required>
                <option value="">Selecione…</option>
                {documentos.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.sigla_ato ?? "Doc."} {d.numero}{d.empreendimento ? ` – ${d.empreendimento}` : ""}{d.validade ? ` (até ${d.validade})` : ""}{d.relacionado ? " ★" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600">★ = empreendimento relacionado ao alerta (CAR ou localização). Só licenças/autorizações válidas do município.</p>
            </div>
          )}
          <div>
            <label htmlFor="observacao" className="label">{modo === "DESCARTADO" ? "Motivo do descarte *" : modo === "IRREGULAR" ? "Constatação *" : "Observação"}</label>
            <textarea id="observacao" name="observacao" className="input min-h-20" maxLength={3000} required={modo !== "AUTORIZADO"} minLength={modo !== "AUTORIZADO" ? 5 : undefined} />
          </div>
          <div className="flex gap-2">
            <button className={modo === "DESCARTADO" ? "btn-perigo" : "btn-primario"} disabled={alterando} data-testid="confirmar-status">
              {alterando ? "Salvando…" : modo === "AUTORIZADO" ? "Confirmar autorização" : modo === "IRREGULAR" ? "Confirmar irregularidade" : "Confirmar descarte"}
            </button>
            <button type="button" className="btn-secundario" onClick={() => setModo("")}>Cancelar</button>
          </div>
        </form>
      )}
      <Mensagem estado={st} />
    </div>
  );
}
