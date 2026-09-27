import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { fmtDataHora } from "@/lib/format";
import { AcessoNegado } from "@/components/acesso-negado";
import { Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormAdmin } from "../_comp/form-admin";
import { alternarAtivo } from "./actions";

export const metadata = { title: "Modelos de documento – Administração" };

export default async function Modelos() {
  const { ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const lista = await prisma.modeloDocumento.findMany({ orderBy: [{ tipo: "asc" }, { versao: "desc" }], select: { id: true, tipo: true, nome: true, versao: true, ativo: true, created_at: true } });
  return (
    <>
      <CabecalhoPagina titulo="Modelos de documento" subtitulo={<><Link href="/admin" className="underline">Administração</Link> · sem modelo ativo, o sistema usa o modelo padrão embutido</>} acoes={<Link href="/admin/modelos/novo" className="btn-primario">Novo modelo</Link>} />
      <Card>
        {lista.length === 0 ? <Vazio>Nenhum modelo personalizado – todos os documentos usam os modelos padrão.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela">
              <thead><tr><th>Tipo</th><th>Nome</th><th>Versão</th><th>Criado em</th><th>Situação</th><th></th></tr></thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id}>
                    <td className="font-mono">{m.tipo}</td>
                    <td><Link href={`/admin/modelos/${m.id}`} className="text-primaria-700 hover:underline">{m.nome}</Link></td>
                    <td>v{m.versao}</td>
                    <td>{fmtDataHora(m.created_at)}</td>
                    <td>{m.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge>Inativo</Badge>}</td>
                    <td>
                      <FormAdmin action={alternarAtivo} inline botao={m.ativo ? "Desativar" : "Ativar"} classeBotao="btn-secundario" rotuloAcessivel={`${m.ativo ? "Desativar" : "Ativar"} versão ${m.versao}`}>
                        <input type="hidden" name="id" value={m.id} />
                      </FormAdmin>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
