"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { Mapa } from "@/components/mapa";
import { calcularPorte, ROTULO_PORTE } from "@/lib/cadastros/porte";
import { removerAnexoAcao, salvarRascunhoAcao } from "@/lib/processo/actions";
import { formatarTamanho } from "@/lib/processo/upload-cliente";
import { FormAcao } from "@/app/(interno)/processos/_componentes/acoes-processo";
import { UploadAnexo } from "@/app/(interno)/processos/_componentes/formularios";

// Wizard de requerimento compartilhado (SPEC 10):
// - modo "requerente": /novo-requerimento – o próprio requerente (passos 1–5);
// - modo "balcao": /processos/novo – servidor interno protocola em nome do requerente (passo 0 "Requerente" + 1–5).
// Mesmos serviços nos dois modos: salvarRascunhoAcao → anexos → transicionar("protocolar").

export type ModoWizard = "requerente" | "balcao";

/** Dados do passo 0 no modo balcão (requerente já escolhido na tela de busca/cadastro). */
export type DadosBalcao = {
  requerente: { id: string; nome: string; tipo: "PF" | "PJ"; documento: string; tem_login: boolean };
  municipio: { id: string; nome: string };
  rts: { id: string; nome: string; registro: string }[];
  rt_id: string | null;
  /** Link para trocar o requerente/município (null quando o rascunho já existe). */
  trocarHref: string | null;
};

export type DadosWizard = {
  modo?: ModoWizard;
  balcao?: DadosBalcao;
  /** Município padrão de um novo empreendimento (órgão ativo da sessão). */
  municipioPadrao?: string | null;
  municipios: { id: string; nome: string; lat: number | null; lng: number | null }[];
  tipologias: { id: string; codigo: string; divisao: string; descricao: string; unidade_porte: string; faixas_porte: unknown; potencial_poluidor: string }[];
  tiposAto: { id: string; sigla: string; nome: string; categoria: string; validade_meses_padrao: number | null; prazo_analise_dias: number }[];
  empreendimentos: { id: string; nome: string; municipio: string; tipologia_id: string; grandeza: string; lat: number | null; lng: number | null }[];
  rascunho: {
    id: string;
    empreendimento_id: string;
    tipologia_id: string;
    grandeza: string;
    tipo_ato_id: string;
    descricao_atividade: string;
    exigidos: { id: string; nome: string; obrigatorio: boolean; formatos: string }[];
    anexos: { id: string; nome: string; tamanho: number; documento_exigido_id: string | null }[];
  } | null;
};

/** Nomes dos passos (índice = nº do passo). O passo 0 só existe no balcão. */
export const PASSOS = ["Requerente", "Empreendimento", "Tipologia e porte", "Tipo de ato", "Documentos", "Revisão e protocolo"];

/** URL do rascunho / da conclusão conforme o modo. */
export function urlRascunho(modo: ModoWizard, id: string, passo?: number) {
  const base = modo === "balcao" ? `/processos/novo?rascunho=${id}` : `/novo-requerimento?id=${id}`;
  return passo ? `${base}&passo=${passo}` : base;
}

/**
 * Barra de etapas. `liberado` = maior passo acessível. Sem `onIr` (ex.: tela de busca do requerente,
 * renderizada no servidor) os itens não são clicáveis.
 */
export function NavEtapas({ modo, atual, liberado, onIr }: { modo: ModoWizard; atual: number; liberado: number; onIr?: (n: number) => void }) {
  const primeiro = modo === "balcao" ? 0 : 1;
  const passos = PASSOS.slice(primeiro);
  return (
    <nav aria-label="Etapas do requerimento">
      <ol className={clsx("grid gap-1 text-center text-xs sm:text-sm", passos.length === 6 ? "grid-cols-6" : "grid-cols-5")}>
        {passos.map((nome, i) => {
          const n = i + primeiro;
          const acessivel = !!onIr && n <= liberado;
          return (
            <li key={nome}>
              <button
                type="button"
                disabled={!acessivel}
                onClick={() => acessivel && onIr?.(n)}
                aria-current={atual === n ? "step" : undefined}
                className={clsx("w-full rounded-md border px-1 py-2", atual === n ? "border-primaria-700 bg-primaria-700 text-white" : n < atual ? "border-primaria-100 bg-primaria-50 text-primaria-800" : "border-slate-200 bg-white text-slate-600", !acessivel && atual !== n && "opacity-50")}
              >
                <span className="block font-bold">{i + 1}</span>
                <span className="hidden sm:block">{nome}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function WizardRequerimento({ dados, passoInicial }: { dados: DadosWizard; passoInicial: number }) {
  const router = useRouter();
  const modoWizard: ModoWizard = dados.modo ?? "requerente";
  const balcao = modoWizard === "balcao" ? dados.balcao : undefined;
  const r = dados.rascunho;
  const [passo, setPasso] = useState(passoInicial);
  const [rtId, setRtId] = useState(balcao?.rt_id ?? "");
  const [modo, setModo] = useState<"existente" | "novo">(r || dados.empreendimentos.length ? "existente" : "novo");
  const [empId, setEmpId] = useState(r?.empreendimento_id ?? dados.empreendimentos[0]?.id ?? "");
  const [novo, setNovo] = useState({ nome: "", municipio_id: dados.municipioPadrao ?? "", logradouro: "", numero: "", bairro: "", cep: "", area_m2: "", numero_car: "" });
  const [ponto, setPonto] = useState<[number, number] | null>(null);
  const empSel = dados.empreendimentos.find((e) => e.id === empId);
  const [tipologiaId, setTipologiaId] = useState(r?.tipologia_id ?? "");
  const [grandeza, setGrandeza] = useState(r?.grandeza ?? "");
  const [tipoAtoId, setTipoAtoId] = useState(r?.tipo_ato_id ?? "");
  const [descricao, setDescricao] = useState(r?.descricao_atividade ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();

  const tipologia = dados.tipologias.find((t) => t.id === tipologiaId);
  const porte = useMemo(() => (tipologia && grandeza !== "" ? calcularPorte(tipologia.faixas_porte, grandeza.replace(",", ".")) : null), [tipologia, grandeza]);
  const tipoAto = dados.tiposAto.find((t) => t.id === tipoAtoId);
  const mun = dados.municipios.find((m) => m.id === novo.municipio_id);
  const divisoes = [...new Set(dados.tipologias.map((t) => t.divisao))];

  function escolherEmpreendimento(id: string) {
    setEmpId(id);
    const e = dados.empreendimentos.find((x) => x.id === id);
    if (e && !r) {
      setTipologiaId(e.tipologia_id);
      setGrandeza(e.grandeza);
    }
  }

  function validar(ate: number): string | null {
    if (ate >= 1) {
      if (modo === "existente" && !empId) return "Selecione o empreendimento.";
      if (modo === "novo") {
        if (novo.nome.trim().length < 3) return "Informe o nome do empreendimento.";
        if (!novo.municipio_id) return "Selecione o município do empreendimento.";
        if (!ponto) return "Marque a localização do empreendimento no mapa (ou informe latitude e longitude).";
      }
    }
    if (ate >= 2) {
      if (!tipologiaId) return "Selecione a tipologia da atividade.";
      if (grandeza === "" || !porte) return "Informe a grandeza para cálculo do porte.";
    }
    if (ate >= 3 && !tipoAtoId) return "Selecione o tipo de ato (licença/autorização/certidão).";
    return null;
  }

  function avancar() {
    const e = validar(passo);
    setErro(e);
    if (!e) setPasso(passo + 1);
  }

  function salvar() {
    const e = validar(3);
    setErro(e);
    if (e) return;
    iniciar(async () => {
      const res = await salvarRascunhoAcao({
        processo_id: r?.id ?? null,
        ...(balcao ? { requerente_id: balcao.requerente.id, rt_id: rtId || null } : {}),
        empreendimento_id: modo === "existente" ? empId : null,
        empreendimento:
          modo === "novo"
            ? { nome: novo.nome, municipio_id: novo.municipio_id, endereco: { logradouro: novo.logradouro, numero: novo.numero, bairro: novo.bairro, cep: novo.cep, cidade: mun?.nome, uf: "BA" }, latitude: ponto![0], longitude: ponto![1], area_m2: novo.area_m2, numero_car: novo.numero_car }
            : null,
        tipologia_id: tipologiaId,
        grandeza: grandeza.replace(",", "."),
        tipo_ato_id: tipoAtoId,
        descricao_atividade: descricao,
      });
      if (!res?.ok || !res.id) {
        setErro(res?.erro ?? "Não foi possível salvar o rascunho.");
        return;
      }
      router.replace(urlRascunho(modoWizard, res.id, 4));
      router.refresh();
      setPasso(4);
    });
  }

  const faltando = r ? r.exigidos.filter((d) => d.obrigatorio && !r.anexos.some((a) => a.documento_exigido_id === d.id)) : [];

  return (
    <div className="space-y-5">
      <NavEtapas modo={modoWizard} atual={passo} liberado={r ? 5 : 3} onIr={(n) => { setErro(null); setPasso(n); }} />

      <section className="card p-4 sm:p-6" aria-labelledby="titulo-passo">
        <h2 id="titulo-passo" className="mb-4 text-lg font-semibold">{balcao ? passo + 1 : passo}. {PASSOS[passo]}</h2>

        {passo === 0 && balcao && (
          <div className="space-y-4" data-testid="passo-requerente">
            <dl className="grid gap-2 rounded-md bg-slate-50 p-3 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-slate-500">Requerente</dt>
              <dd data-testid="requerente-escolhido"><strong>{balcao.requerente.nome}</strong> · {balcao.requerente.tipo === "PF" ? "CPF" : "CNPJ"} {balcao.requerente.documento}</dd>
              <dt className="text-slate-500">Acesso online</dt>
              <dd>{balcao.requerente.tem_login ? "Possui login – acompanhará o processo em “Meus processos”." : "Sem login – entregue o recibo impresso ao requerente."}</dd>
              <dt className="text-slate-500">Município do processo</dt>
              <dd>{balcao.municipio.nome}</dd>
            </dl>
            {balcao.trocarHref && <Link href={balcao.trocarHref} className="btn-secundario btn-sm">Trocar requerente ou município</Link>}
            <div>
              <label htmlFor="w-rt" className="label">Responsável técnico (opcional)</label>
              <select id="w-rt" className="input" value={rtId} onChange={(e) => setRtId(e.target.value)}>
                <option value="">RT vigente do empreendimento (se houver)</option>
                {balcao.rts.map((t) => <option key={t.id} value={t.id}>{t.nome} – {t.registro}</option>)}
              </select>
              <p className="mt-1 text-xs text-slate-500">Aplicado ao salvar o rascunho (etapa “Tipo de ato”).</p>
            </div>
          </div>
        )}

        {passo === 1 && (
          <div className="space-y-4">
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="sr-only">Empreendimento novo ou existente</legend>
              <label className="inline-flex items-center gap-2"><input type="radio" name="modo" checked={modo === "existente"} onChange={() => setModo("existente")} disabled={!dados.empreendimentos.length} /> Empreendimento já cadastrado</label>
              <label className="inline-flex items-center gap-2"><input type="radio" name="modo" checked={modo === "novo"} onChange={() => setModo("novo")} /> Novo empreendimento</label>
            </fieldset>
            {modo === "existente" ? (
              <div>
                <label htmlFor="w-emp" className="label">Empreendimento</label>
                <select id="w-emp" className="input" value={empId} onChange={(e) => escolherEmpreendimento(e.target.value)}>
                  <option value="">Selecione…</option>
                  {dados.empreendimentos.map((e) => <option key={e.id} value={e.id}>{e.nome} – {e.municipio}</option>)}
                </select>
                {empSel?.lat && empSel.lng && <div className="mt-3"><Mapa centro={[empSel.lat, empSel.lng]} zoom={14} altura="260px" pontos={[{ id: empSel.id, lat: empSel.lat, lng: empSel.lng, titulo: empSel.nome }]} /></div>}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="w-nome" className="label">Nome do empreendimento *</label>
                  <input id="w-nome" className="input" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Ex.: Laticínio Boa Vista – unidade Lagoa do Orvalho" />
                </div>
                <div>
                  <label htmlFor="w-mun" className="label">Município *</label>
                  <select id="w-mun" className="input" value={novo.municipio_id} onChange={(e) => setNovo({ ...novo, municipio_id: e.target.value })}>
                    <option value="">Selecione…</option>
                    {dados.municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="w-cep" className="label">CEP</label>
                  <input id="w-cep" className="input" inputMode="numeric" value={novo.cep} onChange={(e) => setNovo({ ...novo, cep: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="w-log" className="label">Logradouro</label>
                  <input id="w-log" className="input" value={novo.logradouro} onChange={(e) => setNovo({ ...novo, logradouro: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="w-num" className="label">Número</label>
                    <input id="w-num" className="input" value={novo.numero} onChange={(e) => setNovo({ ...novo, numero: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="w-bai" className="label">Bairro/localidade</label>
                    <input id="w-bai" className="input" value={novo.bairro} onChange={(e) => setNovo({ ...novo, bairro: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label htmlFor="w-area" className="label">Área (m²)</label>
                  <input id="w-area" className="input" inputMode="decimal" value={novo.area_m2} onChange={(e) => setNovo({ ...novo, area_m2: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="w-car" className="label">Nº do CAR (se rural)</label>
                  <input id="w-car" className="input" value={novo.numero_car} onChange={(e) => setNovo({ ...novo, numero_car: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <p className="label">Localização * <span className="font-normal text-slate-500">(clique no mapa para marcar o ponto)</span></p>
                  <Mapa key={novo.municipio_id} selecionavel selecionado={ponto} onSelecionar={(lat, lng) => setPonto([lat, lng])} centro={mun?.lat && mun.lng ? [mun.lat, mun.lng] : undefined} zoom={mun ? 13 : 8} altura="320px" />
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="w-lat" className="label">Latitude</label>
                      <input id="w-lat" className="input" inputMode="decimal" value={ponto?.[0] ?? ""} onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v)) setPonto([v, ponto?.[1] ?? 0]); }} />
                    </div>
                    <div>
                      <label htmlFor="w-lng" className="label">Longitude</label>
                      <input id="w-lng" className="input" inputMode="decimal" value={ponto?.[1] ?? ""} onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (Number.isFinite(v)) setPonto([ponto?.[0] ?? 0, v]); }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {passo === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="w-tip" className="label">Tipologia da atividade *</label>
              <select id="w-tip" className="input" value={tipologiaId} onChange={(e) => setTipologiaId(e.target.value)}>
                <option value="">Selecione…</option>
                {divisoes.map((d) => (
                  <optgroup key={d} label={d}>
                    {dados.tipologias.filter((t) => t.divisao === d).map((t) => <option key={t.id} value={t.id}>{t.codigo} – {t.descricao}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="w-gr" className="label">Grandeza {tipologia ? `(${tipologia.unidade_porte})` : ""} *</label>
              <input id="w-gr" className="input" inputMode="decimal" value={grandeza} onChange={(e) => setGrandeza(e.target.value)} disabled={!tipologia} />
            </div>
            <div className="rounded-md bg-slate-50 p-3 text-sm" aria-live="polite">
              <p>Porte calculado: <strong data-testid="porte-calculado">{porte ? ROTULO_PORTE[porte] : "—"}</strong></p>
              <p>Potencial poluidor: <strong>{tipologia?.potencial_poluidor ?? "—"}</strong></p>
              <p className="mt-1 text-xs text-slate-500">O porte pode ser revisto pelo técnico durante a análise.</p>
            </div>
          </div>
        )}

        {passo === 3 && (
          <div className="space-y-4">
            <fieldset>
              <legend className="label">Tipo de ato requerido *</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {dados.tiposAto.map((t) => (
                  <label key={t.id} className={clsx("flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm", tipoAtoId === t.id ? "border-primaria-600 bg-primaria-50" : "border-slate-200")}>
                    <input type="radio" name="tipo_ato" value={t.id} checked={tipoAtoId === t.id} onChange={() => setTipoAtoId(t.id)} className="mt-1" />
                    <span>
                      <strong>{t.sigla}</strong> – {t.nome}
                      <span className="block text-xs text-slate-500">Análise em até {t.prazo_analise_dias} dias{t.validade_meses_padrao ? ` · validade ${t.validade_meses_padrao} meses` : ""}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label htmlFor="w-desc" className="label">Descrição da atividade</label>
              <textarea id="w-desc" className="input" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descreva o processo produtivo, capacidade, horário de funcionamento etc." />
            </div>
          </div>
        )}

        {passo === 4 && r && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Anexe os documentos exigidos para <strong>{tipoAto?.sigla ?? ""}</strong>. Formatos aceitos por item; limite de 25 MB por arquivo.</p>
            <ul className="space-y-3" data-testid="documentos-exigidos">
              {r.exigidos.map((d) => {
                const enviados = r.anexos.filter((a) => a.documento_exigido_id === d.id);
                const accept = d.formatos.split(",").map((f) => `.${f.trim()}`).join(",") + (d.formatos.includes("jpg") ? ",.jpeg" : "");
                return (
                  <li key={d.id} className={clsx("rounded-md border p-3", enviados.length ? "border-emerald-300 bg-emerald-50" : d.obrigatorio ? "border-amber-300" : "border-slate-200")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{d.nome} {d.obrigatorio ? <span className="text-red-700">*</span> : <span className="text-xs text-slate-500">(opcional)</span>}</p>
                        <p className="text-xs text-slate-500">Formatos: {d.formatos}</p>
                      </div>
                      <UploadAnexo processoId={r.id} meta={{ tipo: "DOCUMENTO_EXIGIDO", documento_exigido_id: d.id }} rotulo={enviados.length ? "Enviar outro" : "Enviar arquivo"} accept={accept} />
                    </div>
                    {enviados.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {enviados.map((a) => <ArquivoEnviado key={a.id} id={a.id} nome={a.nome} tamanho={a.tamanho} />)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="rounded-md border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Outros documentos (opcional)</p>
                <UploadAnexo processoId={r.id} meta={{ tipo: "OUTRO" }} rotulo="Enviar arquivo" multiplo />
              </div>
              <ul className="mt-2 space-y-1">{r.anexos.filter((a) => !a.documento_exigido_id).map((a) => <ArquivoEnviado key={a.id} id={a.id} nome={a.nome} tamanho={a.tamanho} />)}</ul>
            </div>
          </div>
        )}

        {passo === 5 && r && (
          <div className="space-y-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-[12rem_1fr]">
              {balcao && <><dt className="text-slate-500">Requerente</dt><dd>{balcao.requerente.nome}</dd></>}
              <dt className="text-slate-500">Empreendimento</dt><dd>{dados.empreendimentos.find((e) => e.id === r.empreendimento_id)?.nome ?? "—"} ({dados.empreendimentos.find((e) => e.id === r.empreendimento_id)?.municipio})</dd>
              <dt className="text-slate-500">Tipologia</dt><dd>{tipologia ? `${tipologia.codigo} – ${tipologia.descricao}` : "—"}</dd>
              <dt className="text-slate-500">Grandeza / porte</dt><dd>{grandeza} {tipologia?.unidade_porte} · {porte ? ROTULO_PORTE[porte] : "—"}</dd>
              <dt className="text-slate-500">Tipo de ato</dt><dd>{tipoAto ? `${tipoAto.sigla} – ${tipoAto.nome}` : "—"}</dd>
              <dt className="text-slate-500">Documentos</dt><dd>{r.anexos.length} arquivo(s) anexado(s)</dd>
            </dl>
            {faltando.length > 0 ? (
              <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Faltam documentos obrigatórios: {faltando.map((d) => d.nome).join("; ")}. <button type="button" className="underline" onClick={() => setPasso(4)}>Anexar agora</button>
              </p>
            ) : (
              <p className="text-sm text-slate-700">{balcao ? `Protocolo no balcão em nome de ${balcao.requerente.nome}: confira os dados com o requerente. Será gerado o número do processo e o recibo de protocolo em PDF.` : "Ao protocolar, você declara que as informações são verdadeiras. Será gerado o número do processo e o recibo de protocolo em PDF."}</p>
            )}
            <FormAcao processoId={r.id} acao="protocolar" payload={{}} rotuloBotao="Protocolar requerimento" desabilitado={faltando.length > 0} onConcluido={() => router.push(balcao ? urlRascunho(modoWizard, r.id) : `/meus-processos/${r.id}?protocolado=1`)} />
          </div>
        )}

        {erro && <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{erro}</p>}

        <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="btn-secundario" onClick={() => { setErro(null); setPasso(Math.max(balcao ? 0 : 1, passo - 1)); }} disabled={passo === (balcao ? 0 : 1)}>Voltar</button>
          {passo < 3 && <button type="button" className="btn-primario" onClick={avancar}>Continuar</button>}
          {passo === 3 && <button type="button" className="btn-primario" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar rascunho e continuar"}</button>}
          {passo === 4 && <button type="button" className="btn-primario" onClick={() => setPasso(5)}>Revisar</button>}
        </div>
      </section>
    </div>
  );
}

function ArquivoEnviado({ id, nome, tamanho }: { id: string; nome: string; tamanho: number }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <a href={`/api/v1/anexos/${id}`} className="text-primaria-700 underline">{nome}</a>
      <span className="text-xs text-slate-500">{formatarTamanho(tamanho)}</span>
      <button type="button" className="text-xs text-red-700 underline" disabled={pendente} onClick={() => iniciar(async () => { await removerAnexoAcao(id); router.refresh(); })} aria-label={`Remover ${nome}`}>
        {pendente ? "Removendo…" : "Remover"}
      </button>
    </li>
  );
}
