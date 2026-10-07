import Link from "next/link";
import { forbidden } from "next/navigation";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { lerConfiguracoes } from "@/lib/ged/admin/configuracoes";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed } from "@/lib/ged/papeis";
import { salvarConfiguracoesAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações – Gestão de Documentos" };

export default async function PaginaConfiguracoes() {
  const ctx = await exigirGed();
  if (!podeAdministrarGed(ctx)) forbidden();
  const c = await lerConfiguracoes(ctx);

  return (
    <>
      <CabecalhoPagina titulo="Configurações" subtitulo={<><Link href="/ged/admin" prefetch={false} className="underline">Administração</Link> · padrões do seu cliente no módulo</>} />
      <Card className="max-w-2xl">
        <FormGed action={salvarConfiguracoesAction} botao="Salvar configurações" rotuloAcessivel="Configurações do cliente">
          <div>
            <label className="label" htmlFor="cfg-prazo">Prazo padrão de assinatura (dias)</label>
            <input id="cfg-prazo" name="assinatura_prazo_dias" type="number" min={1} max={365} step={1} className="input" defaultValue={c.assinatura_prazo_dias} required />
            <span className="mt-1 block text-xs text-slate-500">Sugerido ao abrir uma solicitação de assinatura; vencido o prazo, a solicitação expira.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-lembretes">Lembretes de assinatura (dias antes do prazo)</label>
            <input id="cfg-lembretes" name="lembrete_dias" className="input" defaultValue={c.lembrete_dias.join(", ")} maxLength={60} required />
            <span className="mt-1 block text-xs text-slate-500">Números separados por vírgula; 0 = no dia do vencimento. Ex.: 3, 1, 0.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-retencao">Retenção do log de acessos (dias)</label>
            <input id="cfg-retencao" name="retencao_acesso_log_dias" type="number" min={90} max={3650} step={1} className="input" defaultValue={c.retencao_acesso_log_dias} required />
            <span className="mt-1 block text-xs text-slate-500">Acessos mais antigos são apagados automaticamente (mínimo de 90 dias). Alterações e comunicações não são apagadas.</span>
          </div>
          <div>
            <label className="label" htmlFor="cfg-cota">Cota de armazenamento informativa (GB)</label>
            <input id="cfg-cota" name="cota_gb" inputMode="decimal" className="input" defaultValue={c.cota_gb ?? ""} placeholder="Sem cota definida" />
            <span className="mt-1 block text-xs text-slate-500">Apenas informativa nesta fase: não bloqueia envios.</span>
          </div>
        </FormGed>
      </Card>
    </>
  );
}
