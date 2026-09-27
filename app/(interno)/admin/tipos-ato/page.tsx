import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";

export const metadata = { title: "Tipos de ato – Administração" };
const ROTULO_CATEGORIA = { LICENCA: "Licença", AUTORIZACAO: "Autorização", CERTIDAO: "Certidão", DECLARACAO: "Declaração" } as const;

export default async function TiposAto() {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const lista = await prisma.tipoAto.findMany({ orderBy: { sigla: "asc" }, include: { checklist_modelo: { select: { nome: true } }, _count: { select: { documentos_exigidos: true, processos: true } } } });
  return (
    <>
      <CabecalhoPagina titulo="Tipos de ato" subtitulo={<Link href="/admin" className="underline">Administração</Link>} acoes={<Link href="/admin/tipos-ato/novo" className="btn-primario">Novo tipo de ato</Link>} />
      <Card>
        <div className="overflow-x-auto">
          <table className="tabela">
            <thead><tr><th>Sigla</th><th>Nome</th><th>Categoria</th><th>Validade</th><th>Prazo análise</th><th>Exige</th><th className="text-right">Docs</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/admin/tipos-ato/${t.id}`} className="font-mono font-medium text-primaria-700 hover:underline">{t.sigla}</Link></td>
                  <td>{t.nome}</td>
                  <td>{ROTULO_CATEGORIA[t.categoria]}</td>
                  <td>{t.validade_meses_padrao ? `${t.validade_meses_padrao} meses` : "—"}</td>
                  <td>{t.prazo_analise_dias} dias</td>
                  <td className="space-x-1">{t.exige_vistoria && <Badge cor="roxo">Vistoria</Badge>}{t.exige_parecer && <Badge cor="azul">Parecer</Badge>}</td>
                  <td className="text-right"><Link className="underline" href={`/admin/documentos-exigidos?tipo_ato=${t.id}`}>{t._count.documentos_exigidos}</Link></td>
                  <td>{t.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
