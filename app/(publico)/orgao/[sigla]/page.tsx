import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, FileCheck2, LogIn, Mail, MapPin, Megaphone, Phone, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { numerosTransparencia } from "@/lib/documentos/publico";
import { fmtNumero } from "@/lib/format";
import { Brasao, LogoOrganizacao, demoAtivo } from "@/components/orgao";
import { logoProprio } from "@/lib/imagem";

// Portal público do órgão (município). Consulta o banco → dinâmico.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ sigla: string }> };

async function carregar(sigla: string) {
  if (!/^[A-Za-z]{2,5}$/.test(sigla)) return null;
  return prisma.municipio.findFirst({
    where: { sigla: sigla.toUpperCase(), ativo: true },
    select: { id: true, sigla: true, nome: true, orgao_ambiental_nome: true, brasao_url: true, endereco: true, email: true, telefone: true, organizacao: { select: { nome: true, logo_url: true } } },
  });
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const m = await carregar((await params).sigla);
  return { title: m ? `${m.orgao_ambiental_nome}` : "Órgão não encontrado" };
}

export default async function PortalOrgao({ params }: Params) {
  const m = await carregar((await params).sigla);
  if (!m) notFound();
  const n = await numerosTransparencia(m.id);
  const s = encodeURIComponent(m.sigla);
  const atalhos = [
    { href: `/consulta?orgao=${s}`, icone: Search, t: "Consultar processo", d: "Acompanhe pelo número do processo." },
    { href: `/licencas?municipio=${s}`, icone: FileCheck2, t: "Licenças emitidas", d: `Licenças, autorizações e certidões de ${m.nome}.` },
    { href: `/validar?orgao=${s}`, icone: BadgeCheck, t: "Validar documento", d: "Confira a autenticidade pelo código ou QR Code." },
    { href: `/denuncia?municipio=${s}`, icone: Megaphone, t: "Fazer denúncia", d: "Informe uma irregularidade ambiental (pode ser anônima)." },
    { href: `/login?orgao=${s}`, icone: LogIn, t: "Entrar", d: "Área do requerente e da equipe do órgão." },
  ];
  const numeros = [
    { rotulo: "Licenças e documentos emitidos", valor: n.licencas, teste: "num-licencas" },
    { rotulo: "Documentos vigentes", valor: n.vigentes, teste: "num-vigentes" },
    { rotulo: "Processos em andamento", valor: n.andamento, teste: "num-andamento" },
    { rotulo: "Denúncias recebidas", valor: n.denuncias, teste: "num-denuncias" },
  ];

  return (
    <div data-testid="portal-orgao" data-sigla={m.sigla}>
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-10 sm:flex-row sm:items-center">
          {logoProprio(m.organizacao.logo_url) ? (
            <LogoOrganizacao src={logoProprio(m.organizacao.logo_url)!} nome={m.organizacao.nome} className="h-20 w-auto max-w-[260px]" />
          ) : (
            <Brasao src={m.brasao_url} nome={m.nome} className="h-20 w-20" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-primaria-700">Município de {m.nome}{demoAtivo() ? " · demonstração" : ""}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{m.orgao_ambiental_nome}</h1>
            <p className="mt-2 text-slate-600">Portal de licenciamento e fiscalização ambiental do município.</p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-10">
        <section aria-labelledby="titulo-servicos">
          <h2 id="titulo-servicos" className="text-lg font-semibold text-slate-900">Serviços</h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {atalhos.map((a) => (
              <li key={a.t}>
                <Link href={a.href} className="flex h-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-primaria-600 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primaria-600">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primaria-50 text-primaria-700"><a.icone className="h-5 w-5" aria-hidden /></span>
                  <span>
                    <span className="block font-semibold text-slate-900">{a.t}</span>
                    <span className="block text-sm text-slate-600">{a.d}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="titulo-transp">
          <h2 id="titulo-transp" className="text-lg font-semibold text-slate-900">Transparência</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {numeros.map((x) => (
              <div key={x.rotulo} className="rounded-xl border border-slate-200 bg-white p-4">
                <dt className="text-xs font-medium text-slate-600">{x.rotulo}</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900" data-testid={x.teste}>{fmtNumero(x.valor)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-slate-500">Números atualizados em tempo real a partir do sistema.</p>
        </section>

        {(m.endereco || m.email || m.telefone) && (
          <section aria-labelledby="titulo-contato" className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 id="titulo-contato" className="text-lg font-semibold text-slate-900">Atendimento</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              {m.endereco && <li className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-primaria-700" aria-hidden />{m.endereco}</li>}
              {m.telefone && <li className="flex gap-2"><Phone className="h-4 w-4 shrink-0 text-primaria-700" aria-hidden />{m.telefone}</li>}
              {m.email && <li className="flex gap-2"><Mail className="h-4 w-4 shrink-0 text-primaria-700" aria-hidden /><a className="min-w-0 break-all underline" href={`mailto:${m.email}`}>{m.email}</a></li>}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
