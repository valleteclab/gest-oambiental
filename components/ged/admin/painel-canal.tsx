"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Aviso } from "@/components/ui";

async function chamar(corpo: unknown) {
  const r = await fetch("/api/v1/ged/admin/canal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message ?? "Não foi possível concluir a operação.");
  return j as { estado?: string; detalhe?: string; qrcode?: string | null; mensagem?: string; simulado?: boolean };
}

/** Pareamento (QR), status e teste do canal de envio. O QR é mostrado só na tela; nada é gravado. */
export function PainelCanalGed({ canalId, tipo }: { canalId: string; tipo: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ t: "erro" | "sucesso" | "info"; m: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(fn: () => Promise<string>) {
    setMsg(null);
    setOcupado(true);
    try {
      setMsg({ t: "sucesso", m: await fn() });
      router.refresh();
    } catch (e) {
      setMsg({ t: "erro", m: (e as Error).message });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => executar(async () => { const r = await chamar({ acao: "conectar", canal_id: canalId }); setQr(r.qrcode ?? null); return r.mensagem ?? (r.qrcode ? "Leia o QR Code no WhatsApp do número de envio (Aparelhos conectados › Conectar aparelho)." : `Estado: ${r.estado}`); })}>
          {tipo === "WHATSAPP_EVOLUTION" ? "Criar instância / QR Code" : "Mostrar QR Code"}
        </button>
        <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => executar(async () => { const r = await chamar({ acao: "status", canal_id: canalId }); return `Estado: ${r.estado}${r.detalhe ? ` (${r.detalhe})` : ""}`; })}>Ver status</button>
        <button type="button" className="btn-secundario btn-sm" disabled={ocupado} onClick={() => executar(async () => { const r = await chamar({ acao: "testar", canal_id: canalId }); return r.simulado ? "Envio simulado registrado (modo de teste do servidor)." : "Mensagem de teste enviada ao seu WhatsApp confirmado."; })}>Enviar teste ao meu WhatsApp</button>
      </div>
      {qr && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-slate-200 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code para conectar o WhatsApp" className="h-56 w-56 max-w-full" />
          <button type="button" className="btn-secundario btn-sm" onClick={() => setQr(null)}>Fechar QR Code</button>
        </div>
      )}
      {msg && <Aviso tipo={msg.t}>{msg.m}</Aviso>}
    </div>
  );
}
