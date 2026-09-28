import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { whereOrganizacao } from "@/lib/rbac";
import { faixasParaTexto } from "@/lib/cadastros/porte";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { AreaTexto } from "../_comp/campos";
import { importarTipologias } from "./actions";

export const metadata = { title: "Tipologias – Administração" };

const PP = { BAIXO: <Badge cor="verde">Baixo</Badge>, MEDIO: <Badge cor="amarelo">Médio</Badge>, ALTO: <Badge cor="vermelho">Alto</Badge> };

export default async function Tipologias() {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const lista = await prisma.tipologia.findMany({ where: whereOrganizacao(admin), orderBy: { codigo: "asc" }, include: { _count: { select: { empreendimentos: true } } } });
  return (
    <>
      <CabecalhoPagina titulo="Tipologias" subtitulo={<Link href="/admin" className="underline">Administração</Link>} acoes={<Link href="/admin/tipologias/novo" className="btn-primario">Nova tipologia</Link>} />
      <div className="space-y-6">
        <Card>
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Código</th><th>Descrição</th><th>Unidade de porte</th><th>Faixas</th><th>Potencial</th><th className="text-right">Empreend.</th><th>Situação</th></tr></thead>
              <tbody>
                {lista.map((t) => (
                  <tr key={t.id}>
                    <td><Link href={`/admin/tipologias/${t.id}`} className="font-mono font-medium text-primaria-700 hover:underline">{t.codigo}</Link></td>
                    <td>{t.descricao}<div className="text-xs text-slate-500">{t.divisao}</div></td>
                    <td>{t.unidade_porte}</td>
                    <td className="font-mono text-xs">{faixasParaTexto(t.faixas_porte)}</td>
                    <td>{PP[t.potencial_poluidor]}</td>
                    <td className="text-right">{t._count.empreendimentos}</td>
                    <td>{t.ativo ? <Badge cor="verde">Ativa</Badge> : <Badge>Inativa</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card titulo="Importar CSV">
          <p className="mb-2 text-sm text-slate-700">Separador <code>;</code>, UTF-8, uma tipologia por linha (cabeçalho opcional). Códigos existentes são atualizados. Colunas:</p>
          <pre className="mb-4 overflow-x-auto rounded bg-slate-100 p-3 text-xs">{`codigo;divisao;descricao;unidade_porte;potencial_poluidor;faixas
C1.1;Indústria de alimentos;Laticínio;litros/dia;ALTO;MICRO:5000|PEQUENO:20000|MEDIO:60000|GRANDE:150000|EXCEPCIONAL`}</pre>
          <FormAdmin action={importarTipologias} botao="Importar" limparAoSalvar>
            <div>
              <label htmlFor="arquivo-csv" className="label">Arquivo CSV</label>
              <input id="arquivo-csv" name="arquivo" type="file" accept=".csv,text/csv,text/plain" className="block text-sm" />
            </div>
            <AreaTexto name="csv" label="…ou cole o conteúdo" rows={4} className="font-mono" />
          </FormAdmin>
        </Card>
      </div>
    </>
  );
}
