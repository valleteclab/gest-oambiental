import { prisma } from "@/lib/db";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { listarCanais, usoIaPorMes, TIPOS_CANAL } from "@/lib/agente/canais-admin";
import { CAMPOS_CANAL, ROTULO_TIPO_CANAL, envioSimulado } from "@/lib/canais";
import { iaHabilitada, MODELO_PADRAO, MODELO_RAPIDO_PADRAO } from "@/lib/agente/llm";
import { fmtNumero } from "@/lib/format";
import { PainelCanais } from "./painel";

export const metadata = { title: "Canais de atendimento – LicenciaGov" };
export const dynamic = "force-dynamic";

export default async function PaginaCanais() {
  const { u, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado mensagem="A configuração dos canais é restrita ao administrador." />;
  const [canais, municipios, uso] = await Promise.all([
    listarCanais(u),
    prisma.municipio.findMany({ where: whereMunicipiosAdmin(u), orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    usoIaPorMes(u),
  ]);
  const totalMes = uso.reduce<Record<string, number>>((a, l) => ({ ...a, [l.mes]: (a[l.mes] ?? 0) + l.custo }), {});
  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo="Canais de atendimento"
        subtitulo="WhatsApp (Evolution API, Z-API, Chatwoot oficial), chat do site e e-mail do Assistente Ambiental de denúncias"
      />
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="card p-4"><p className="text-slate-500">Inteligência artificial</p><p className="font-semibold">{iaHabilitada() ? `Ativa (${process.env.OPENROUTER_MODEL || MODELO_PADRAO})` : "Desligada – questionário passo a passo"}</p><p className="text-xs text-slate-500">Auxiliar: {process.env.OPENROUTER_MODEL_RAPIDO || MODELO_RAPIDO_PADRAO}</p></div>
        <div className="card p-4"><p className="text-slate-500">Transcrição de áudio</p><p className="font-semibold">{process.env.GROQ_API_KEY ? "Ativa (Groq Whisper)" : "Desligada – pede para escrever"}</p></div>
        <div className="card p-4"><p className="text-slate-500">Envio</p><p className="font-semibold">{envioSimulado() ? "SIMULADO (CANAIS_ENVIO_SIMULADO=true)" : "Real"}</p><p className="text-xs text-slate-500">Evolution: {process.env.EVOLUTION_BASE_URL ? "configurada" : "EVOLUTION_BASE_URL ausente"}</p></div>
      </div>
      <PainelCanais
        canais={JSON.parse(JSON.stringify(canais))}
        municipios={municipios}
        tipos={TIPOS_CANAL.map((t) => ({ id: t, rotulo: ROTULO_TIPO_CANAL[t], campos: CAMPOS_CANAL[t] }))}
      />
      <Card titulo="Consumo de IA (custo estimado em US$)">
        {uso.length === 0 ? <Vazio>Nenhum uso de IA registrado nos últimos 6 meses.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="uso-ia">
              <thead><tr><th>Mês</th><th>Modelo</th><th className="text-right">Chamadas</th><th className="text-right">Tokens entrada</th><th className="text-right">Tokens saída</th><th className="text-right">Custo (US$)</th></tr></thead>
              <tbody>
                {uso.map((l) => (
                  <tr key={`${l.mes}-${l.modelo}`}><td>{l.mes}</td><td className="font-mono text-xs">{l.modelo}</td><td className="text-right">{fmtNumero(l.chamadas)}</td><td className="text-right">{fmtNumero(l.tokens_in)}</td><td className="text-right">{fmtNumero(l.tokens_out)}</td><td className="text-right">{fmtNumero(l.custo, 4)}</td></tr>
                ))}
              </tbody>
              <tfoot>{Object.entries(totalMes).map(([m, v]) => <tr key={m}><td colSpan={5} className="text-right font-medium">Total {m}</td><td className="text-right font-semibold">{fmtNumero(v, 2)}</td></tr>)}</tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
