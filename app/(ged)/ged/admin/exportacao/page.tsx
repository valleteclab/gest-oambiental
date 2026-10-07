import Link from "next/link";
import { forbidden } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { AtualizarEnquanto } from "@/components/ged/admin/atualizar-enquanto";
import { listarExportacoes } from "@/lib/ged/admin/exportacao";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed } from "@/lib/ged/papeis";
import { fmtDataHora } from "@/lib/format";
import { fmtBytes } from "@/lib/backup/registrar";
import { solicitarExportacaoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exportação – Gestão de Documentos" };

const COR = { PENDENTE: "cinza", PROCESSANDO: "azul", CONCLUIDA: "verde", ERRO: "vermelho" } as const;
const ROTULO = { PENDENTE: "Na fila", PROCESSANDO: "Processando", CONCLUIDA: "Concluída", ERRO: "Erro" } as const;

export default async function PaginaExportacao() {
  const ctx = await exigirGed();
  if (!podeAdministrarGed(ctx)) forbidden();
  const exps = await listarExportacoes(ctx);
  const andamento = exps.some((e) => e.status === "PENDENTE" || e.status === "PROCESSANDO");

  return (
    <>
      <CabecalhoPagina titulo="Exportação completa" subtitulo={<><Link href="/ged/admin" prefetch={false} className="underline">Administração</Link> · portabilidade dos dados do seu cliente</>} />
      <div className="space-y-4">
        <Aviso>
          O arquivo ZIP reúne <strong>somente os dados da sua organização</strong>: um CSV e um JSON por tabela, o dicionário de dados, os arquivos dos documentos e o manifesto com hashes SHA-256. Senhas não são exportadas.
          Dados pessoais (CPF/CNPJ, e-mail, telefone) saem cifrados. O arquivo contém dados pessoais: guarde-o com segurança (LGPD).
        </Aviso>
        <Card titulo="Nova exportação">
          <FormGed action={solicitarExportacaoAction} botao="Solicitar exportação completa" rotuloAcessivel="Solicitar exportação">
            <p className="text-sm text-slate-600">{andamento ? "Há uma exportação em andamento; aguarde a conclusão para pedir outra." : "A geração roda em segundo plano e pode levar alguns minutos conforme o volume."}</p>
          </FormGed>
          <div className="mt-2"><AtualizarEnquanto ativo={andamento} texto="Exportação em andamento – esta página atualiza sozinha." /></div>
        </Card>
        <Card titulo="Histórico">
          {exps.length === 0 ? <Vazio>Nenhuma exportação solicitada ainda.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tabela" data-testid="tabela-exportacoes">
                <thead><tr><th>Solicitada em</th><th>Por</th><th>Situação</th><th>Concluída em</th><th>Tamanho</th><th><span className="sr-only">Download</span></th></tr></thead>
                <tbody>
                  {exps.map((e) => (
                    <tr key={e.id} data-status={e.status}>
                      <td className="whitespace-nowrap">{fmtDataHora(e.created_at)}</td>
                      <td>{e.solicitada_por}</td>
                      <td><Badge cor={COR[e.status]}>{ROTULO[e.status]}</Badge>{e.erro && <div className="mt-1 max-w-xs truncate text-xs text-red-700" title={e.erro}>{e.erro}</div>}</td>
                      <td className="whitespace-nowrap">{fmtDataHora(e.concluida_em)}</td>
                      <td className="whitespace-nowrap">{fmtBytes(e.tamanho)}</td>
                      <td>{e.status === "CONCLUIDA" && <a className="btn-secundario btn-sm" href={`/api/v1/ged/admin/exportacao/${e.id}`} download>Baixar ZIP</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
