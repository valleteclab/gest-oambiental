import Link from "next/link";
import { forbidden } from "next/navigation";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";
import { obterConfigCanal } from "@/lib/ged/admin/canal";
import { listarCertificados } from "@/lib/ged/admin/certificado";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed, podeGerirEstruturaGed, podeVerLogs } from "@/lib/ged/papeis";

export const dynamic = "force-dynamic";

type Item = { href: string; rotulo: string; texto: string; selo?: React.ReactNode };

export default async function AdminGed() {
  const ctx = await exigirGed();
  if (!podeGerirEstruturaGed(ctx)) forbidden();
  const admin = podeAdministrarGed(ctx);
  const [canal, certs] = admin ? await Promise.all([obterConfigCanal(ctx), listarCertificados(ctx)]) : [null, null];
  const canalOk = !!canal?.canais.some((c) => c.vinculado && c.ativo);
  const certOk = !!certs?.some((c) => c.ativo && (c.situacao === "VALIDO" || c.situacao === "VENCENDO"));

  const estrutura: Item[] = [
    { href: "/ged/admin/setores", rotulo: "Setores", texto: "Setores e seus participantes (base das permissões e do trâmite)." },
    { href: "/ged/admin/marcadores", rotulo: "Marcadores", texto: "Marcadores coloridos para classificar documentos." },
    { href: "/ged/admin/tipos", rotulo: "Tipos de documento", texto: "Tipos usados na classificação dos documentos." },
  ];
  const administracao: Item[] = admin
    ? [
        { href: "/ged/admin/membros", rotulo: "Membros", texto: "Pessoas com acesso, papéis, setores e senhas provisórias." },
        { href: "/ged/admin/canal", rotulo: "Canal de WhatsApp", texto: "Número usado para enviar as notificações (somente envio).", selo: canalOk ? <Badge cor="verde">Configurado</Badge> : <Badge cor="amarelo">Pendente</Badge> },
        { href: "/ged/admin/certificado", rotulo: "Certificado digital", texto: "e-CNPJ A1 do órgão para o selo dos documentos assinados.", selo: certOk ? <Badge cor="verde">Vigente</Badge> : <Badge cor="amarelo">Sem certificado</Badge> },
        { href: "/ged/admin/exportacao", rotulo: "Exportação", texto: "Exportação completa dos dados do seu cliente." },
        { href: "/ged/admin/configuracoes", rotulo: "Configurações", texto: "Prazos de assinatura, lembretes, retenção dos logs e cota." },
      ]
    : [];
  const acompanhamento: Item[] = [
    ...(podeVerLogs(ctx) ? [{ href: "/ged/logs", rotulo: "Logs", texto: "Acessos, alterações e comunicações." }] : []),
    { href: "/ged/minha-conta/notificacoes", rotulo: "Minhas notificações", texto: "Seus avisos por e-mail e WhatsApp." },
  ];

  const grupo = (titulo: string, itens: Item[]) =>
    itens.length === 0 ? null : (
      <Card titulo={titulo}>
        <ul className="grid gap-3 sm:grid-cols-2">
          {itens.map((i) => (
            <li key={i.href}>
              <Link href={i.href} prefetch={false} className="block h-full rounded-md border border-slate-200 p-3 hover:border-primaria-600 hover:bg-primaria-50">
                <span className="flex flex-wrap items-center gap-2 font-medium text-primaria-800">{i.rotulo}{i.selo}</span>
                <span className="mt-1 block text-sm text-slate-600">{i.texto}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    );

  return (
    <>
      <CabecalhoPagina titulo="Administração" subtitulo={ctx.organizacao.nome} />
      <div className="space-y-6">
        {grupo("Estrutura", estrutura)}
        {grupo("Administração do cliente", administracao)}
        {grupo("Acompanhamento e conta", acompanhamento)}
      </div>
    </>
  );
}
