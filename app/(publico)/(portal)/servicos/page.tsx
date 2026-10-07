import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone, Music, Trees, Truck } from "lucide-react";
import { getOrgaoAtivo, getUsuario, listarOrgaos, resolverOrgao } from "@/lib/auth";
import { servicosDoOrgao } from "@/lib/demandas/consultas";
import { PRAZO_DIAS_UTEIS, type SiglaDemanda } from "@/lib/demandas/catalogo";
import { ContextoOrgao } from "@/components/contexto-orgao";

// Serviços urbanos do órgão (demandas do dia a dia): poda/corte de árvore, som em eventos, carro de som.
// Requisitos, prazos e documentos vêm do banco (catálogo da organização do órgão em contexto: ?orgao=SIGLA).
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Serviços – autorizações urbanas" };

const TEXTO: Record<SiglaDemanda, { icone: typeof Trees; quando: string; quem: string; como: string }> = {
  APC: {
    icone: Trees,
    quando: "Para podar ou cortar árvore em calçada, quintal, terreno ou praça – por risco à rede elétrica ou à casa, árvore doente ou morta, ou obra.",
    quem: "O proprietário do imóvel ou quem tiver autorização dele.",
    como: "Um técnico faz a vistoria no local. Se o corte for autorizado, pode ser exigido o plantio de mudas (compensação).",
  },
  ASE: {
    icone: Music,
    quando: "Para usar som em festa, show, evento religioso ou esportivo, em local aberto ou fechado, com público.",
    quem: "O organizador do evento (pessoa ou empresa).",
    como: "A autorização vale só nas datas e horários do evento e traz os limites de volume (decibéis) e o horário de encerramento.",
  },
  ACS: {
    icone: Truck,
    quando: "Para circular com carro, moto ou bicicleta de som fazendo propaganda ou anúncios.",
    quem: "O dono do veículo ou a empresa de publicidade.",
    como: "A autorização vale por 30 ou 90 dias e indica os horários permitidos e os locais onde o som é proibido (hospitais, escolas).",
  },
};

function prazoTexto(sigla: SiglaDemanda, dias: number) {
  return `até ${dias} dia${dias > 1 ? "s" : ""}${PRAZO_DIAS_UTEIS[sigla] ? " úteis" : ""} após a triagem`;
}

function validadeTexto(sigla: SiglaDemanda, meses: number | null) {
  if (sigla === "ASE") return "durante o evento (datas informadas no pedido)";
  if (sigla === "ACS") return "30 ou 90 dias, conforme o pedido";
  return meses ? `${meses} meses para executar o serviço` : "indicada no documento";
}

export default async function Servicos({ searchParams }: { searchParams: Promise<{ orgao?: string; municipio?: string }> }) {
  const sp = await searchParams;
  const pedido = (sp.orgao ?? sp.municipio ?? "").trim();
  const [u, ativo, orgaos] = await Promise.all([getUsuario(), getOrgaoAtivo(), listarOrgaos()]);
  const orgao = (pedido ? await resolverOrgao(pedido) : null) ?? ativo;
  const servicos = orgao ? await servicosDoOrgao(orgao.id) : [];

  const solicitar = (sigla: string) => {
    const destino = `/novo-requerimento?tipo=${sigla}`;
    if (!u) return `/login?orgao=${orgao!.sigla}&next=${encodeURIComponent(destino)}`;
    if (ativo?.id === orgao!.id) return destino;
    return `/trocar-orgao?next=${encodeURIComponent(destino)}`;
  };

  return (
    <div className="space-y-6" data-testid="pagina-servicos">
      {orgao && <ContextoOrgao sigla={orgao.sigla} />}
      <div>
        <h1 className="titulo-pagina">Serviços – autorizações urbanas</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Peça pela internet as autorizações ambientais do dia a dia da cidade. Você acompanha o pedido em “Meus processos” e recebe o documento com QR Code para
          conferência. Para fazer o pedido é preciso entrar com seu usuário (ou <Link className="underline" href="/cadastro">criar um cadastro</Link>).
        </p>
      </div>

      <form method="get" action="/servicos" className="card flex flex-wrap items-end gap-3 p-4">
        <label className="block min-w-[16rem] flex-1">
          <span className="label">Município / órgão ambiental</span>
          <select name="orgao" defaultValue={orgao?.sigla ?? ""} className="input">
            <option value="">Selecione…</option>
            {orgaos.map((o) => <option key={o.sigla} value={o.sigla}>{o.nome} – {o.orgao_ambiental_nome}</option>)}
          </select>
        </label>
        <button className="btn-primario" type="submit">Ver serviços</button>
      </form>

      {!orgao ? (
        <p className="card p-4 text-sm text-slate-700">Escolha o município para ver os serviços disponíveis, os prazos e os documentos necessários.</p>
      ) : (
        <>
          {servicos.length === 0 && <p className="card p-4 text-sm text-slate-700">Este órgão ainda não oferece autorizações urbanas pela internet. Procure o atendimento presencial.</p>}
          <ul className="grid gap-4 lg:grid-cols-3">
            {servicos.map((s) => {
              const sigla = s.sigla as SiglaDemanda;
              const t = TEXTO[sigla];
              return (
                <li key={s.id} className="card flex flex-col p-4" data-testid={`servico-${sigla}`}>
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primaria-50 text-primaria-700"><t.icone className="h-5 w-5" aria-hidden /></span>
                    <div>
                      <h2 className="font-semibold text-slate-900">{s.nome}</h2>
                      <p className="text-xs text-slate-500">{sigla}</p>
                    </div>
                  </div>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div><dt className="font-medium text-slate-800">Quando pedir</dt><dd className="text-slate-600">{t.quando}</dd></div>
                    <div><dt className="font-medium text-slate-800">Quem pode pedir</dt><dd className="text-slate-600">{t.quem}</dd></div>
                    <div><dt className="font-medium text-slate-800">Como funciona</dt><dd className="text-slate-600">{t.como}</dd></div>
                    <div><dt className="font-medium text-slate-800">Prazo de resposta</dt><dd className="text-slate-600" data-testid="prazo-servico">{prazoTexto(sigla, s.prazo_analise_dias)}{s.exige_vistoria ? " (inclui vistoria)" : ""}</dd></div>
                    <div><dt className="font-medium text-slate-800">Validade</dt><dd className="text-slate-600">{validadeTexto(sigla, s.validade_meses_padrao)}</dd></div>
                  </dl>
                  <h3 className="mt-3 text-sm font-medium text-slate-800">Documentos (foto ou PDF)</h3>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-600" data-testid="documentos-servico">
                    {s.documentos_exigidos.map((d) => <li key={d.nome}>{d.nome}{d.obrigatorio ? "" : " – se for o caso"}</li>)}
                  </ul>
                  <div className="mt-auto pt-4">
                    <Link href={solicitar(sigla)} className="btn-primario w-full justify-center" aria-label={`Solicitar ${s.nome}`}>Solicitar</Link>
                  </div>
                </li>
              );
            })}
            <li className="card flex flex-col border-amber-200 bg-amber-50/40 p-4" data-testid="servico-denuncia">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800"><Megaphone className="h-5 w-5" aria-hidden /></span>
                <h2 className="font-semibold text-slate-900">Denunciar poluição sonora ou corte irregular de árvore</h2>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Som alto fora de hora, carro de som em área proibida, árvore cortada ou podada sem autorização? Converse com o Assistente Ambiental ou preencha o formulário. A
                denúncia pode ser anônima e você recebe um protocolo para acompanhar.
              </p>
              <div className="mt-auto pt-4">
                <Link href={`/denuncia?municipio=${orgao.sigla}`} className="btn-secundario w-full justify-center">Fazer denúncia</Link>
              </div>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
