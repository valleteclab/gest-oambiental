import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { AcessoNegado } from "@/components/acesso-negado";
import { can, temPapel } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { fmtBytes, situacaoBackup } from "@/lib/backup/registrar";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormRestore } from "./form-restore";

export const metadata = { title: "Backup – LicenciaGov" };
export const dynamic = "force-dynamic";

function horas(h: number | null) {
  if (h === null) return "—";
  if (h < 1) return "há menos de 1 h";
  if (h < 48) return `há ${Math.floor(h)} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

export default async function PaginaBackup() {
  const u = await exigirUsuario({ interno: true });
  if (!can(u, "ver", "admin") && !can(u, "ver", "exportacao")) return <AcessoNegado mensagem="A página de backup é restrita ao administrador e à SEMA/INEMA." />;
  const s = await situacaoBackup();
  const admin = temPapel(u, "ADMIN");

  return (
    <>
      <CabecalhoPagina
        titulo="Backup e restauração"
        subtitulo="Backup diário do Postgres gerenciado + pg_dump criptografado em outra região/provedor (retenção 30 dias) e teste de restauração mensal (SPEC 9.2)."
        acoes={can(u, "exportar", "exportacao") && <Link href="/admin/exportar" className="btn-secundario">Exportação completa</Link>}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card titulo="Último backup">
          {s.ultimoBackup ? (
            <div data-testid="ultimo-backup" data-atrasado={s.backupAtrasado ? "1" : "0"} className={s.backupAtrasado ? "rounded-md border border-red-300 bg-red-50 p-3" : ""}>
              <p className="text-2xl font-semibold" data-testid="ultimo-backup-data">{fmtDataHora(s.ultimoBackup.executado_em)}</p>
              <p className={`text-sm ${s.backupAtrasado ? "font-medium text-red-700" : "text-emerald-700"}`}>
                {horas(s.horasDesdeBackup)} · {s.backupAtrasado ? "ATRASADO (mais de 24 h)" : "dentro das 24 h"}
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Tamanho</dt><dd data-testid="ultimo-backup-tamanho">{fmtBytes(s.ultimoBackup.tamanho)}</dd>
                <dt className="text-slate-500">Destino</dt><dd className="break-all">{s.ultimoBackup.destino ?? "—"}</dd>
                {s.ultimoBackup.observacao && (<><dt className="text-slate-500">Obs.</dt><dd className="break-words text-slate-700">{s.ultimoBackup.observacao}</dd></>)}
              </dl>
            </div>
          ) : (
            <Aviso tipo="erro">Nenhum backup registrado. Configure o agendamento de <code>scripts/backup/pg_dump.sh</code>.</Aviso>
          )}
          {s.ultimaFalha && <div className="mt-3"><Aviso tipo="erro">Última execução falhou em {fmtDataHora(s.ultimaFalha.executado_em)}: {s.ultimaFalha.observacao}</Aviso></div>}
        </Card>

        <Card titulo="Última restauração testada">
          {s.ultimoRestore ? (
            <div data-testid="ultimo-restore" className={s.restoreAtrasado || !s.ultimoRestore.sucesso ? "rounded-md border border-amber-300 bg-amber-50 p-3" : ""}>
              <p className="text-2xl font-semibold">{fmtDataHora(s.ultimoRestore.executado_em)}</p>
              <p className="text-sm">
                <Badge cor={s.ultimoRestore.sucesso ? "verde" : "vermelho"}>{s.ultimoRestore.sucesso ? "Sucesso" : "Falhou"}</Badge>{" "}
                <span className={s.restoreAtrasado ? "font-medium text-amber-800" : "text-slate-600"}>{horas(s.diasDesdeRestore !== null ? s.diasDesdeRestore * 24 : null)}{s.restoreAtrasado ? " · teste mensal pendente" : ""}</span>
              </p>
              {s.ultimoRestore.observacao && <p className="mt-2 break-words text-sm text-slate-700">{s.ultimoRestore.observacao}</p>}
            </div>
          ) : (
            <Aviso tipo="alerta">Nenhum teste de restauração registrado. Siga o checklist de <code>docs/restore.md</code>.</Aviso>
          )}
        </Card>
      </div>

      {admin && (
        <div className="mt-4">
          <Card titulo="Registrar teste de restauração manual">
            <p className="mb-3 text-sm text-slate-600">
              Use após executar o checklist mensal (<code>docs/restore.md</code>). O teste automatizado <code>scripts/backup/restore-test.sh</code> registra sozinho.
            </p>
            <FormRestore />
          </Card>
        </div>
      )}

      <div className="mt-4">
        <Card titulo="Histórico (últimos 30 registros)">
          {s.historico.length === 0 ? (
            <Vazio>Sem registros.</Vazio>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela">
                <thead><tr><th>Data/hora</th><th>Tipo</th><th>Resultado</th><th>Tamanho</th><th className="hidden md:table-cell">Destino / observação</th></tr></thead>
                <tbody>
                  {s.historico.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{fmtDataHora(r.executado_em)}</td>
                      <td>{r.tipo === "BACKUP" ? "Backup" : "Teste de restauração"}</td>
                      <td><Badge cor={r.sucesso ? "verde" : "vermelho"}>{r.sucesso ? "OK" : "Falha"}</Badge></td>
                      <td className="whitespace-nowrap">{fmtBytes(r.tamanho)}</td>
                      <td className="hidden max-w-md break-words text-xs text-slate-600 md:table-cell">{[r.destino, r.observacao].filter(Boolean).join(" · ")}</td>
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
