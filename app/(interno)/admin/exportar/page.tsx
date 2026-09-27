import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { fmtBytes } from "@/lib/backup/registrar";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { acaoSolicitarExportacao } from "./actions";
import { AtualizarEnquanto } from "./atualizar";

export const metadata = { title: "Exportação completa – LicenciaGov" };

const COR = { PENDENTE: "cinza", PROCESSANDO: "azul", CONCLUIDA: "verde", ERRO: "vermelho" } as const;
const ROTULO = { PENDENTE: "Na fila", PROCESSANDO: "Processando", CONCLUIDA: "Concluída", ERRO: "Erro" } as const;

export default async function PaginaExportar({ searchParams }: { searchParams: Promise<{ ok?: string; erro?: string }> }) {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "exportar", "exportacao")) return <Aviso tipo="erro">Acesso negado (403). A exportação completa é restrita a ADMIN e SEMA/INEMA.</Aviso>;
  const sp = await searchParams;
  const exps = await prisma.exportacao.findMany({ orderBy: { created_at: "desc" }, take: 50 });
  const nomes = new Map((await prisma.usuario.findMany({ where: { id: { in: [...new Set(exps.map((e) => e.solicitada_por))] } }, select: { id: true, nome: true } })).map((x) => [x.id, x.nome]));
  const emAndamento = exps.some((e) => e.status === "PENDENTE" || e.status === "PROCESSANDO");

  return (
    <>
      <CabecalhoPagina
        titulo="Exportação completa de dados"
        subtitulo="Portabilidade (SPEC 9.2): ZIP com um CSV e um JSON por tabela, dicionário de dados, todos os anexos e PDFs, e manifest.json com hashes SHA-256."
        acoes={
          <form action={acaoSolicitarExportacao}>
            <button className="btn-primario" data-testid="solicitar-exportacao" disabled={emAndamento}>Solicitar exportação completa</button>
          </form>
        }
      />
      <div className="mb-4 space-y-2">
        {sp.ok && <Aviso tipo="sucesso">Exportação solicitada. O arquivo fica disponível para download abaixo quando concluir.</Aviso>}
        {sp.erro === "403" && <Aviso tipo="erro">Você não tem permissão para exportar.</Aviso>}
        <Aviso>
          Senhas não são exportadas. CPF/CNPJ, e-mail e telefone de pessoas físicas saem <strong>cifrados</strong> (AES-256-GCM); a chave é entregue ao órgão por canal
          separado. O arquivo contém dados pessoais – armazene-o com segurança (LGPD).
        </Aviso>
        <AtualizarEnquanto ativo={emAndamento} />
      </div>
      <Card titulo="Exportações">
        {exps.length === 0 ? (
          <Vazio>Nenhuma exportação solicitada ainda.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabela" data-testid="tabela-exportacoes">
              <thead>
                <tr><th>Solicitada em</th><th>Por</th><th>Situação</th><th className="hidden sm:table-cell">Concluída em</th><th>Tamanho</th><th><span className="sr-only">Download</span></th></tr>
              </thead>
              <tbody>
                {exps.map((e) => (
                  <tr key={e.id} data-testid="linha-exportacao" data-status={e.status}>
                    <td className="whitespace-nowrap">{fmtDataHora(e.created_at)}</td>
                    <td>{nomes.get(e.solicitada_por) ?? "—"}</td>
                    <td>
                      <Badge cor={COR[e.status]}>{ROTULO[e.status]}</Badge>
                      {e.erro && <div className="mt-1 max-w-xs truncate text-xs text-red-700" title={e.erro}>{e.erro}</div>}
                    </td>
                    <td className="hidden whitespace-nowrap sm:table-cell">{fmtDataHora(e.concluida_em)}</td>
                    <td className="whitespace-nowrap">{fmtBytes(e.tamanho)}</td>
                    <td>
                      {e.status === "CONCLUIDA" && (
                        <a className="btn-secundario btn-sm" href={`/api/v1/admin/exportacoes/${e.id}`} download data-testid="baixar-exportacao">Baixar ZIP</a>
                      )}
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
