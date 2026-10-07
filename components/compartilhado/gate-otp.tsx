"use client";
// Etapa de acesso do destinatário: pede o código ao WhatsApp cadastrado por quem compartilhou (o destinatário NÃO informa número)
// e confere o código de 6 dígitos. Tudo via /api/v1/publico/compartilhado/{token}/…; ao validar, recarrega a página (cookie de sessão).
import { useEffect, useState } from "react";
import { Aviso } from "@/components/ui";

type Resp = { message?: string; mensagem?: string; terminacao?: string; reenvio_em_s?: number; details?: { retry_after?: number; tentativas_restantes?: number } | null };

export function GateOtp({ token }: { token: string }) {
  const base = `/api/v1/publico/compartilhado/${token}`;
  const [etapa, setEtapa] = useState<"inicio" | "codigo">("inicio");
  const [ocupado, setOcupado] = useState(false);
  const [info, setInfo] = useState("");
  const [erro, setErro] = useState("");
  const [codigo, setCodigo] = useState("");
  const [espera, setEspera] = useState(0);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((e) => e - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function pedirCodigo() {
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      const r = await fetch(`${base}/otp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = (await r.json().catch(() => ({}))) as Resp;
      if (r.ok) {
        setInfo(j.mensagem ?? "Enviamos o código para o WhatsApp cadastrado.");
        setEtapa("codigo");
        setEspera(j.reenvio_em_s ?? 60);
      } else if (r.status === 404) {
        setErro("Este link é inválido ou não está mais disponível.");
      } else {
        if (r.status === 429 && j.details?.retry_after) setEspera(Math.min(j.details.retry_after, 3600));
        setErro(j.message ?? "Não foi possível enviar o código agora. Tente novamente em instantes.");
      }
    } catch {
      setErro("Falha de conexão. Verifique a internet e tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      const r = await fetch(`${base}/validar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }) });
      const j = (await r.json().catch(() => ({}))) as Resp;
      if (r.ok) {
        window.location.reload();
        return;
      }
      if (r.status === 404) setErro("Este link é inválido ou não está mais disponível.");
      else setErro(j.message ?? "Código incorreto ou expirado.");
      setCodigo("");
    } catch {
      setErro("Falha de conexão. Verifique a internet e tente novamente.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="gate-otp">
      {etapa === "inicio" ? (
        <>
          <p className="text-sm text-slate-700">Para ver os documentos, confirme o seu acesso: enviaremos um código de 6 dígitos para o <strong>WhatsApp cadastrado por quem compartilhou</strong> com você.</p>
          <button type="button" className="btn-primario" onClick={pedirCodigo} disabled={ocupado || espera > 0} data-testid="pedir-codigo">
            {ocupado ? "Enviando…" : espera > 0 ? `Aguarde ${espera} s` : "Receber código no WhatsApp"}
          </button>
        </>
      ) : (
        <form onSubmit={confirmar} className="space-y-3" aria-label="Confirmar código">
          <p className="text-sm text-slate-700" data-testid="otp-mensagem" role="status">{info}</p>
          <div>
            <label className="label" htmlFor="otp-codigo">Código recebido no WhatsApp</label>
            <input
              id="otp-codigo" name="codigo" className="input max-w-[12rem] text-center text-xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn-primario" disabled={ocupado || codigo.length !== 6} data-testid="confirmar-codigo">{ocupado ? "Conferindo…" : "Acessar documentos"}</button>
            <button type="button" className="btn-secundario" onClick={pedirCodigo} disabled={ocupado || espera > 0}>{espera > 0 ? `Reenviar código (${espera} s)` : "Reenviar código"}</button>
          </div>
        </form>
      )}
      {erro && <div role="alert" data-testid="gate-erro"><Aviso tipo="erro">{erro}</Aviso></div>}
    </div>
  );
}
