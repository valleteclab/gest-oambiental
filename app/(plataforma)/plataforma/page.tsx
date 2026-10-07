import Link from "next/link";
import { operadorDaPagina } from "@/lib/plataforma/operador";
import { listarClientes } from "@/lib/plataforma/servico";
import { ROTULO_MODULO, type Modulo } from "@/lib/plataforma/regras";
import { fmtData } from "@/lib/format";
import { Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormReautenticar } from "./_comp/forms";

export const dynamic = "force-dynamic";

export default async function Clientes() {
  const { reautenticado } = await operadorDaPagina();
  if (!reautenticado) return <Card titulo="Confirme sua senha"><FormReautenticar /></Card>;
  const clientes = await listarClientes();
  return (
    <>
      <CabecalhoPagina titulo="Clientes" subtitulo="Organizações cadastradas na plataforma. Aqui só há metadados do cadastro – nunca dados de negócio dos clientes." acoes={<Link href="/plataforma/novo" className="btn-primario">Novo cliente</Link>} />
      <Card>
        {clientes.length === 0 ? <Vazio>Nenhum cliente cadastrado.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-clientes">
              <thead><tr><th>Cliente</th><th>Módulos</th><th>Situação</th><th className="text-right">Usuários</th><th>Criado em</th><th /></tr></thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} data-testid={`cliente-${c.sigla}`}>
                    <td><div className="font-medium">{c.nome}</div><div className="text-xs text-slate-500">{c.sigla}</div></td>
                    <td><div className="flex flex-wrap gap-1">{c.modulos.map((m) => <Badge key={m} cor="azul">{ROTULO_MODULO[m as Modulo]}</Badge>)}</div></td>
                    <td>{c.status === "ATIVO" ? <Badge cor="verde">Ativo</Badge> : <Badge cor="vermelho">Suspenso</Badge>}</td>
                    <td className="text-right">{c._count.usuarios}</td>
                    <td>{fmtData(c.created_at)}</td>
                    <td><Link href={`/plataforma/clientes/${c.id}`} className="underline">Abrir</Link></td>
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
