"use client";
import { useState } from "react";
import { MessageCircle, FileText } from "lucide-react";
import clsx from "clsx";
import { ChatDenuncia } from "@/components/chat-denuncia";
import { FormDenuncia } from "./form";

type Mun = { id: string; sigla: string; nome: string; lat: number | null; lng: number | null; chat: boolean };

/** Denúncia pelo chat (Assistente Ambiental) ou pelo formulário tradicional. */
export function EscolhaDenuncia({ municipios, municipioInicial }: { municipios: Mun[]; municipioInicial: string }) {
  const [munId, setMunId] = useState(municipioInicial);
  const mun = municipios.find((m) => m.id === munId);
  const [modo, setModo] = useState<"chat" | "form">(mun && !mun.chat ? "form" : "chat");
  const chatOk = !!mun?.chat;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1 sm:flex-none">
          <label htmlFor="municipio-chat" className="label">Município</label>
          <select id="municipio-chat" className="input" value={munId} onChange={(e) => setMunId(e.target.value)}>
            <option value="">Selecione…</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div role="tablist" aria-label="Forma de envio" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
          <button type="button" role="tab" aria-selected={modo === "chat"} disabled={!!mun && !chatOk} onClick={() => setModo("chat")} className={clsx("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", modo === "chat" ? "bg-primaria-700 text-white" : "text-slate-700 hover:bg-slate-100")} data-testid="modo-chat">
            <MessageCircle className="h-4 w-4" aria-hidden /> Conversar com o assistente
          </button>
          <button type="button" role="tab" aria-selected={modo === "form"} onClick={() => setModo("form")} className={clsx("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", modo === "form" ? "bg-primaria-700 text-white" : "text-slate-700 hover:bg-slate-100")} data-testid="modo-formulario">
            <FileText className="h-4 w-4" aria-hidden /> Prefiro preencher um formulário
          </button>
        </div>
      </div>

      {modo === "chat" ? (
        mun && chatOk ? (
          <ChatDenuncia key={mun.sigla} municipio={{ sigla: mun.sigla, nome: mun.nome, lat: mun.lat, lng: mun.lng }} aoPreferirFormulario={() => setModo("form")} />
        ) : (
          <div className="card p-6 text-center text-sm text-slate-600">{mun ? "O chat não está disponível para este município. Use o formulário." : "Selecione o município para começar a conversa."}</div>
        )
      ) : (
        <FormDenuncia key={munId} municipioInicial={munId} municipios={municipios.map((m) => ({ id: m.id, nome: m.nome, lat: m.lat, lng: m.lng }))} />
      )}
    </div>
  );
}
