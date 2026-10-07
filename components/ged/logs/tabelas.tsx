import Link from "next/link";
import { Badge, Vazio } from "@/components/ui";
import { fmtDataHora } from "@/lib/format";
import type { LinhaAcesso, LinhaAlteracao, LinhaComunicacao } from "@/lib/ged/logs/consulta";
import type { CampoResumo } from "@/lib/ged/logs/resumo-json";

const COR_STATUS = { ENVIADA: "verde", SIMULADA: "azul", PENDENTE: "amarelo", ERRO: "vermelho", IGNORADA: "cinza" } as const;
const ROTULO_STATUS: Record<string, string> = { ENVIADA: "Enviada", SIMULADA: "Simulada", PENDENTE: "Pendente", ERRO: "Erro", IGNORADA: "Ignorada" };
const ROTULO_CANAL: Record<string, string> = { EMAIL: "E-mail", WHATSAPP: "WhatsApp" };
const ROTULO_ACAO_ACESSO: Record<string, string> = { VISUALIZAR: "Visualizou", BAIXAR: "Baixou", BUSCAR: "Buscou", LISTAR: "Listou", NEGADO: "Acesso negado", LOGIN_GED: "Entrou no módulo" };

function LinkDoc({ id, numero }: { id: string | null; numero: string | null }) {
  if (!id) return <span className="text-slate-400">—</span>;
  if (!numero) return <span className="text-slate-500" title="Documento não encontrado neste cliente">—</span>;
  return <Link href={`/ged/documentos/${id}`} prefetch={false} className="text-primaria-700 hover:underline">{numero}</Link>;
}

function Campos({ campos, titulo }: { campos: CampoResumo[]; titulo: string }) {
  if (!campos.length) return <span className="text-slate-400">—</span>;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-primaria-700">{titulo} ({campos.length})</summary>
      <dl className="mt-1 max-w-xs space-y-0.5">
        {campos.map((c) => (
          <div key={c.campo} className="flex gap-1"><dt className="font-medium text-slate-600">{c.campo}:</dt><dd className="break-words text-slate-800">{c.valor}</dd></div>
        ))}
      </dl>
    </details>
  );
}

export function TabelaAcessos({ itens }: { itens: LinhaAcesso[] }) {
  if (!itens.length) return <Vazio>Nenhum acesso registrado para os filtros escolhidos.</Vazio>;
  return (
    <div className="overflow-x-auto">
      <table className="tabela" data-testid="tabela-acessos">
        <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Documento</th><th>IP</th></tr></thead>
        <tbody>
          {itens.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap">{fmtDataHora(a.quando)}</td>
              <td>{a.usuario ?? "—"}</td>
              <td>{a.acao === "NEGADO" ? <Badge cor="vermelho">{ROTULO_ACAO_ACESSO[a.acao]}</Badge> : ROTULO_ACAO_ACESSO[a.acao] ?? a.acao}</td>
              <td><LinkDoc id={a.documento_id} numero={a.documento_numero} /></td>
              <td className="whitespace-nowrap font-mono text-xs">{a.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TabelaAlteracoes({ itens }: { itens: LinhaAlteracao[] }) {
  if (!itens.length) return <Vazio>Nenhuma alteração registrada para os filtros escolhidos.</Vazio>;
  return (
    <div className="overflow-x-auto">
      <table className="tabela" data-testid="tabela-alteracoes">
        <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Registro</th><th>Antes</th><th>Depois</th></tr></thead>
        <tbody>
          {itens.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap">{fmtDataHora(a.quando)}</td>
              <td>{a.usuario ?? "Sistema"}</td>
              <td className="font-mono text-xs">{a.acao}</td>
              <td className="text-xs">{a.entidade.replace(/^ged_/, "")}</td>
              <td><Campos campos={a.antes} titulo="Antes" /></td>
              <td><Campos campos={a.depois} titulo="Depois" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TabelaComunicacoes({ itens }: { itens: LinhaComunicacao[] }) {
  if (!itens.length) return <Vazio>Nenhuma comunicação registrada para os filtros escolhidos.</Vazio>;
  return (
    <div className="overflow-x-auto">
      <table className="tabela" data-testid="tabela-comunicacoes">
        <thead><tr><th>Enviada em</th><th>Situação</th><th>Canal</th><th>Destinatário</th><th>Evento</th><th>Documento</th></tr></thead>
        <tbody>
          {itens.map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">{c.enviado_em ? fmtDataHora(c.enviado_em) : <span className="text-slate-500" title={`Criada em ${fmtDataHora(c.quando)}`}>não enviada</span>}</td>
              <td>
                <Badge cor={COR_STATUS[c.status as keyof typeof COR_STATUS] ?? "cinza"}>{ROTULO_STATUS[c.status] ?? c.status}</Badge>
                {c.erro && <div className="mt-1 max-w-xs text-xs text-slate-600">{c.erro}</div>}
              </td>
              <td>{ROTULO_CANAL[c.canal] ?? c.canal}</td>
              <td className="whitespace-nowrap">{c.destinatario_mascarado}<div className="text-xs text-slate-500">{c.usuario}</div></td>
              <td>{c.evento_rotulo}</td>
              <td><LinkDoc id={c.documento_id} numero={c.documento_numero} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
