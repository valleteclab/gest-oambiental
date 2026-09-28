import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardList,
  DatabaseBackup,
  FileCheck2,
  LogIn,
  Mail,
  Megaphone,
  Network,
  QrCode,
  Search,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { Brasao, demoAtivo } from "@/components/orgao";
import { MAILTO_DEMONSTRACAO } from "@/lib/site";

// Landing do produto. Consulta o banco (órgãos ativos) → renderização dinâmica (o build da imagem não tem banco).
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "LicenciaGov – licenciamento e fiscalização ambiental para municípios" },
  description: "Plataforma SaaS de licenciamento e fiscalização ambiental 100% online para prefeituras, secretarias de meio ambiente e consórcios públicos.",
};

const FUNCIONALIDADES = [
  { icone: ClipboardList, titulo: "Licenciamento 100% online", texto: "Requerimento em etapas com cálculo de porte, documentos exigidos por atividade, protocolo automático e acompanhamento pelo requerente." },
  { icone: Smartphone, titulo: "Fiscalização mobile com GPS", texto: "Vistorias pelo celular com localização capturada, fotos, autos de infração e notificações numerados em PDF." },
  { icone: QrCode, titulo: "Documentos com QR Code", texto: "Licenças, certidões e autos com código verificador, QR Code e hash SHA-256. Validação pública em segundos." },
  { icone: BarChart3, titulo: "Painel de indicadores", texto: "Processos, prazos, licenças e fiscalização em tempo real, com filtros por município, período, tipo de ato e técnico." },
  { icone: BellRing, titulo: "Prazos e alertas", texto: "Contagem de prazos por etapa (dias úteis ou corridos), semáforo e alertas automáticos por e-mail antes do vencimento." },
  { icone: Network, titulo: "Multi-município", texto: "Cada órgão com seus dados, numeração, brasão e equipe; o consórcio enxerga o conjunto com o escopo correto." },
  { icone: ShieldCheck, titulo: "LGPD e segurança", texto: "Dados pessoais cifrados, trilha de auditoria imutável, perfis de acesso e portal público sem exposição de dados sensíveis." },
  { icone: DatabaseBackup, titulo: "Backup e dados abertos", texto: "Backups verificados e exportação completa em formatos abertos (CSV/JSON com dicionário de dados) – sem aprisionamento." },
] as const;

const PASSOS = [
  { titulo: "Requerimento online", texto: "O empreendedor se cadastra, informa a atividade e envia os documentos pelo portal, sem ir ao balcão." },
  { titulo: "Análise técnica", texto: "Triagem, checklist, pendências, vistoria e parecer em um fluxo com prazos controlados e tramitação registrada." },
  { titulo: "Licença com QR Code", texto: "Após a decisão, o documento oficial é emitido em PDF com código verificador e QR Code." },
  { titulo: "Transparência", texto: "Qualquer cidadão consulta processos, licenças emitidas e valida documentos no portal público." },
] as const;

const BENEFICIOS_ORGAO = [
  "Fim do papel e das planilhas paralelas: tudo em um só lugar, com histórico completo",
  "Prazos sob controle, com alertas antes do vencimento",
  "Indicadores prontos para gestão, prestação de contas e conselhos",
  "Documentos padronizados e à prova de falsificação",
  "Implantação em nuvem, sem servidores para o município manter",
];
const BENEFICIOS_CIDADAO = [
  "Requerimento e acompanhamento pela internet, de qualquer lugar",
  "Pendências comunicadas pelo sistema e por e-mail",
  "Consulta pública do andamento pelo número do processo",
  "Validação de licenças pelo QR Code ou código verificador",
  "Canal de denúncia ambiental, inclusive anônima",
];

// QR decorativo (padrão fixo e determinístico) para a ilustração do hero.
const QR: boolean[] = (() => {
  const n = 21;
  const finder = (x: number, y: number) => {
    for (const [cx, cy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      const dx = x - cx, dy = y - cy;
      if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    }
    return null;
  };
  let semente = 20260927;
  return Array.from({ length: n * n }, (_, i) => {
    const f = finder(i % n, Math.floor(i / n));
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return f ?? semente % 7 < 3;
  });
})();

function IlustracaoLicenca() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-sm">
      <div className="absolute -inset-4 rounded-3xl bg-white/10 blur-2xl" />
      <div className="relative rotate-1 rounded-2xl bg-white p-5 text-slate-800 shadow-2xl ring-1 ring-black/5">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-primaria-100 text-primaria-700"><Building2 className="h-5 w-5" /></div>
          <div className="min-w-0">
            <div className="h-2.5 w-40 max-w-full rounded bg-slate-200" />
            <div className="mt-1.5 h-2 w-28 rounded bg-slate-100" />
          </div>
        </div>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-primaria-700">Licença de Operação</p>
        <p className="font-mono text-sm font-semibold">LO-XXX-012/2026</p>
        <div className="mt-3 space-y-1.5">
          <div className="h-2 w-full rounded bg-slate-100" />
          <div className="h-2 w-11/12 rounded bg-slate-100" />
          <div className="h-2 w-4/5 rounded bg-slate-100" />
          <div className="h-2 w-2/3 rounded bg-slate-100" />
        </div>
        <div className="mt-4 flex items-end justify-between gap-3">
          <div className="grid shrink-0 grid-cols-[repeat(21,minmax(0,1fr))] gap-0 rounded bg-white p-1 ring-1 ring-slate-200" style={{ width: 88, height: 88 }}>
            {QR.map((c, i) => <span key={i} className={c ? "bg-slate-900" : "bg-white"} />)}
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
            <BadgeCheck className="h-4 w-4" /> Documento válido
          </span>
        </div>
      </div>
      <div className="relative mt-4 ml-auto mr-2 w-52 -rotate-2 rounded-xl bg-white p-3 text-slate-800 shadow-xl ring-1 ring-black/5">
        <div className="flex items-center gap-2 text-xs font-semibold"><Smartphone className="h-4 w-4 text-primaria-700" /> Vistoria em campo</div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> GPS capturado · 2 fotos</div>
      </div>
    </div>
  );
}

export default async function Inicio() {
  const orgaos = await prisma.municipio.findMany({
    where: { ativo: true },
    orderBy: { nome: "asc" },
    select: { sigla: true, nome: true, orgao_ambiental_nome: true, brasao_url: true },
  });
  const demo = demoAtivo();

  return (
    <div className="bg-white">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primaria-800 via-primaria-800 to-primaria-700 text-white" aria-labelledby="titulo-hero">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:22px_22px]" />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 gap-12 px-4 py-14 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-emerald-50 ring-1 ring-white/20">
              Plataforma SaaS para a gestão ambiental municipal
            </p>
            <h1 id="titulo-hero" className="mt-5 text-3xl font-bold leading-tight tracking-tight text-balance sm:text-5xl">
              Licenciamento e fiscalização ambiental 100% online para o seu município
            </h1>
            <p className="mt-5 max-w-xl text-base text-emerald-50 sm:text-lg">
              O LicenciaGov reúne requerimento, análise técnica, fiscalização em campo, documentos com QR Code e transparência em uma única plataforma –
              pronta para prefeituras, secretarias de meio ambiente e consórcios públicos.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={MAILTO_DEMONSTRACAO} className="inline-flex items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-sm font-semibold text-primaria-800 shadow-sm hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <Mail className="h-4 w-4" aria-hidden /> Solicitar demonstração
              </a>
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/40 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                <LogIn className="h-4 w-4" aria-hidden /> Entrar
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-emerald-50">
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden /> Em conformidade com a LGPD</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden /> Funciona no celular</li>
              <li className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden /> Dados exportáveis em formato aberto</li>
            </ul>
          </div>
          <IlustracaoLicenca />
        </div>
      </section>

      {/* ── Serviços ao cidadão ── */}
      <section aria-labelledby="titulo-cidadao" className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h2 id="titulo-cidadao" className="text-sm font-semibold uppercase tracking-wide text-slate-600">Serviços ao cidadão</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: "/consulta", icone: Search, t: "Consultar processo", d: "Andamento pelo número do processo" },
              { href: "/validar", icone: BadgeCheck, t: "Validar documento", d: "Código verificador ou QR Code" },
              { href: "/denuncia", icone: Megaphone, t: "Fazer denúncia", d: "Irregularidade ambiental, até anônima" },
              { href: "/login", icone: LogIn, t: "Área do requerente", d: "Solicite e acompanhe licenças" },
            ].map((a) => (
              <Link key={a.href} href={a.href} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-primaria-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primaria-600">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primaria-50 text-primaria-700"><a.icone className="h-5 w-5" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block font-semibold text-slate-900">{a.t}</span>
                  <span className="block text-sm text-slate-600">{a.d}</span>
                </span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-primaria-700" aria-hidden />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Funcionalidades ── */}
      <section aria-labelledby="titulo-func" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-primaria-700">Funcionalidades</p>
          <h2 id="titulo-func" className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Tudo o que o órgão ambiental precisa, do protocolo à fiscalização</h2>
        </div>
        <ul className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FUNCIONALIDADES.map((f) => (
            <li key={f.titulo} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className="grid h-11 w-11 place-items-center rounded-lg bg-primaria-700 text-white"><f.icone className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-4 font-semibold text-slate-900">{f.titulo}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{f.texto}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Mapas, satélite e CAR ── */}
      <section aria-labelledby="titulo-mapas" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-primaria-700">Geoprocessamento integrado</p>
          <h2 id="titulo-mapas" className="mt-2 max-w-3xl text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Imagem de satélite e bases oficiais do governo em cada processo</h2>
          <p className="mt-3 max-w-3xl text-slate-600">
            Imóveis rurais do CAR (SICAR), parcelas certificadas do SIGEF/INCRA, desmatamento PRODES e DETER do INPE, unidades de conservação e limites do IBGE
            sobre imagem de satélite — direto na análise, na vistoria e no cadastro do empreendimento.
          </p>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {[
              { img: "/apresentacao/car-satelite.webp", titulo: "Imóvel do CAR em um clique", texto: "Clique no mapa e o sistema encontra o imóvel rural no CAR, preenche o número e usa o limite oficial como polígono do empreendimento, com a área calculada." },
              { img: "/apresentacao/prodes-car.webp", titulo: "Desmatamento e limites sobrepostos", texto: "Camadas do INPE (PRODES/DETER Cerrado), CAR e SIGEF sobre o satélite; importe KML, KMZ, GeoJSON ou shapefile enviados pelo requerente." },
              { img: "/apresentacao/antes-depois.webp", titulo: "Antes e depois na fiscalização", texto: "Compare imagens históricas e atuais lado a lado para comprovar supressão de vegetação, abertura de área ou obras sem licença." },
            ].map((c) => (
              <figure key={c.titulo} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.img} alt={`Captura de tela: ${c.titulo}`} loading="lazy" className="aspect-[16/9] w-full object-cover object-top" />
                <figcaption className="p-5">
                  <h3 className="font-semibold text-slate-900">{c.titulo}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{c.texto}</p>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-6 text-xs text-slate-500">
            Fontes: SICAR/Serviço Florestal Brasileiro, INCRA, INPE/TerraBrasilis, MMA/ICMBio e IBGE (dados públicos). Imagens de satélite © Esri, Maxar, Earthstar Geographics.
            O CAR público não informa nome do imóvel nem proprietário; esses dados vêm do cadastro do próprio órgão.
          </p>
        </div>
      </section>

      {/* ── Como funciona ── */}
      <section aria-labelledby="titulo-como" className="bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-primaria-700">Como funciona</p>
          <h2 id="titulo-como" className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Do requerimento à transparência, em quatro passos</h2>
          <ol className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PASSOS.map((p, i) => (
              <li key={p.titulo} className="relative rounded-xl border border-slate-200 bg-white p-5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-primaria-100 text-sm font-bold text-primaria-800" aria-hidden>{i + 1}</span>
                <h3 className="mt-3 font-semibold text-slate-900"><span className="sr-only">Passo {i + 1}: </span>{p.titulo}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{p.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Benefícios ── */}
      <section aria-labelledby="titulo-benef" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <h2 id="titulo-benef" className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Benefícios para quem licencia e para quem é licenciado</h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {[
            { titulo: "Para o órgão ambiental", icone: Building2, itens: BENEFICIOS_ORGAO },
            { titulo: "Para o cidadão e o empreendedor", icone: Users, itens: BENEFICIOS_CIDADAO },
          ].map((b) => (
            <div key={b.titulo} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><b.icone className="h-5 w-5 text-primaria-700" aria-hidden />{b.titulo}</h3>
              <ul className="mt-4 space-y-3">
                {b.itens.map((t) => (
                  <li key={t} className="flex gap-2.5 text-sm text-slate-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primaria-600" aria-hidden />{t}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Para consórcios ── */}
      <section aria-labelledby="titulo-consorcio" className="bg-primaria-800 text-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Para consórcios públicos</p>
            <h2 id="titulo-consorcio" className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Vários municípios, um só contrato</h2>
            <p className="mt-4 text-emerald-50">
              Consórcios intermunicipais contratam uma única plataforma para todos os municípios consorciados. Cada município mantém seu órgão,
              brasão, numeração e equipe; a equipe técnica do consórcio apoia as análises com acesso a todos, e os indicadores consolidados ficam prontos para a gestão.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {["Escopo de acesso por município garantido no servidor", "Técnicos do consórcio atuando em qualquer município", "Painel consolidado e por município", "Relatórios e exportações para prestação de contas"].map((t) => (
              <li key={t} className="flex gap-2.5 rounded-xl bg-white/10 p-4 text-sm ring-1 ring-white/15"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Órgãos ── */}
      {orgaos.length > 0 && (
        <section aria-labelledby="titulo-orgaos" className="mx-auto max-w-6xl px-4 py-14">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="titulo-orgaos" className="text-lg font-semibold text-slate-900">{demo ? "Órgãos de demonstração" : "Órgãos que usam o LicenciaGov"}</h2>
            {demo && <p className="text-sm text-slate-600">Municípios fictícios, apenas para demonstração.</p>}
          </div>
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="lista-orgaos">
            {orgaos.map((o) => (
              <li key={o.sigla}>
                <Link href={`/orgao/${o.sigla}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-primaria-600 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primaria-600">
                  <Brasao src={o.brasao_url} nome={o.nome} className="h-10 w-10" />
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{o.nome}</span>
                    <span className="block truncate text-xs text-slate-600">{o.orgao_ambiental_nome}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── CTA final ── */}
      <section aria-labelledby="titulo-cta" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="titulo-cta" className="text-2xl font-bold tracking-tight text-slate-900">Leve o LicenciaGov para o seu município</h2>
            <p className="mt-2 max-w-xl text-slate-600">Agende uma demonstração com a equipe da VALLETECLAB e veja o fluxo completo funcionando.</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a href={MAILTO_DEMONSTRACAO} className="btn-primario px-5 py-3"><Mail className="h-4 w-4" aria-hidden /> Solicitar demonstração</a>
            <Link href="/login" className="btn-secundario px-5 py-3"><FileCheck2 className="h-4 w-4" aria-hidden /> Entrar no sistema</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
