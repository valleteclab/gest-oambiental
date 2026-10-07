import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { AcessoNegado } from "@/components/acesso-negado";
import { can, temPapel } from "@/lib/rbac";
import { fmtDataHora } from "@/lib/format";
import { fmtBytes, situacaoBackup } from "@/lib/backup/registrar";
import { hostOffsite, lerConfig, proximaExecucao, sha256DaObservacao } from "@/lib/backup/nucleo";
import { execucoesEmAndamento } from "@/lib/backup/executar";
import { workerOnline } from "@/lib/export/exportar";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { AtualizarEnquanto } from "../exportar/atualizar";
import { BotoesExecucao } from "./botoes-execucao";
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
  const [s, andamento, worker] = await Promise.all([situacaoBackup(), execucoesEmAndamento(), workerOnline()]);
  const admin = temPapel(u, "ADMIN");
  const cfg = lerConfig();
  const proxBackup = proximaExecucao(cfg.cronBackup, cfg.tz);
  const proxRestore = proximaExecucao(cfg.cronRestore, cfg.tz);
  const shaUltimo = sha256DaObservacao(s.ultimoBackup?.observacao);
  const emAndamento = andamento.backup || andamento.restore;

  return (
    <>
      <CabecalhoPagina
        titulo="Backup e restauração"
        subtitulo="Backup diário real do banco (pg_dump criptografado com AES-256, enviado a um bucket em outro provedor, retenção de 30 dias) e teste de restauração mensal automático (SPEC 9.2)."
        acoes={can(u, "exportar", "exportacao") && <Link href="/admin/exportar" className="btn-secundario">Exportação completa</Link>}
      />

      <div className="mb-4 space-y-2">
        {!cfg.offsite && (
          <div data-testid="aviso-offsite">
            <Aviso tipo="alerta">
              <strong>Cópia fora do provedor não configurada.</strong> Os dumps estão sendo gravados no storage da própria aplicação (<code>backups/</code>).
              Defina <code>{cfg.offsiteFaltando.join(", ")}</code> (bucket S3-compatível em outro provedor/região, ex.: Cloudflare R2 ou Backblaze B2) – ver <code>docs/backup.md</code>.
            </Aviso>
          </div>
        )}
        {cfg.passphraseDerivada && (
          <Aviso tipo="alerta">
            <code>BACKUP_PASSPHRASE</code> não definida: a chave de criptografia dos dumps é derivada da <code>DATA_KEY</code>. Defina uma senha própria no cofre de segredos.
          </Aviso>
        )}
        {!worker && (
          <Aviso tipo="alerta">
            O worker de jobs (<code>npm run jobs</code>) não está conectado: o backup diário e o teste mensal agendados não rodam até ele subir. Use os botões abaixo para executar agora.
          </Aviso>
        )}
        <AtualizarEnquanto ativo={emAndamento} texto={`${andamento.backup ? "Backup" : "Teste de restauração"} em execução – esta página atualiza sozinha.`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card titulo="Último backup">
          {s.ultimoBackup ? (
            <div
              data-testid="ultimo-backup"
              data-atrasado={s.backupAtrasado ? "1" : "0"}
              data-executado-em={s.ultimoBackup.executado_em.toISOString()}
              className={`rounded-md border p-3 ${s.backupAtrasado ? "border-red-300 bg-red-50" : "border-emerald-300 bg-emerald-50"}`}
            >
              <p className="text-2xl font-semibold" data-testid="ultimo-backup-data">{fmtDataHora(s.ultimoBackup.executado_em)}</p>
              <p className={`text-sm font-medium ${s.backupAtrasado ? "text-red-700" : "text-emerald-700"}`}>
                {horas(s.horasDesdeBackup)} · {s.backupAtrasado ? "ATRASADO (mais de 24 h)" : "dentro das 24 h"}
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Tamanho</dt><dd data-testid="ultimo-backup-tamanho">{fmtBytes(s.ultimoBackup.tamanho)}</dd>
                <dt className="text-slate-500">Destino</dt><dd className="break-all" data-testid="ultimo-backup-destino">{s.ultimoBackup.destino ?? "—"}</dd>
                <dt className="text-slate-500">SHA-256</dt><dd className="break-all font-mono text-xs" data-testid="ultimo-backup-sha256">{shaUltimo ?? "—"}</dd>
                {s.ultimoBackup.observacao && (<><dt className="text-slate-500">Detalhes</dt><dd className="break-words text-xs text-slate-700">{s.ultimoBackup.observacao}</dd></>)}
              </dl>
            </div>
          ) : (
            <Aviso tipo="erro">Nenhum backup executado ainda. O worker executa o backup diariamente; o administrador pode executá-lo agora pelo botão abaixo.</Aviso>
          )}
          {s.ultimaFalha && <div className="mt-3" data-testid="ultima-falha-backup"><Aviso tipo="erro">Última execução falhou em {fmtDataHora(s.ultimaFalha.executado_em)}: {s.ultimaFalha.observacao}</Aviso></div>}
        </Card>

        <Card titulo="Última restauração testada">
          {s.ultimoRestore ? (
            <div data-testid="ultimo-restore" data-executado-em={s.ultimoRestore.executado_em.toISOString()} data-sucesso={s.ultimoRestore.sucesso ? "1" : "0"} className={s.restoreAtrasado || !s.ultimoRestore.sucesso ? "rounded-md border border-amber-300 bg-amber-50 p-3" : ""}>
              <p className="text-2xl font-semibold">{fmtDataHora(s.ultimoRestore.executado_em)}</p>
              <p className="text-sm">
                <Badge cor={s.ultimoRestore.sucesso ? "verde" : "vermelho"}>{s.ultimoRestore.sucesso ? "Sucesso" : "Falhou"}</Badge>{" "}
                <span className={s.restoreAtrasado ? "font-medium text-amber-800" : "text-slate-600"}>{horas(s.diasDesdeRestore !== null ? s.diasDesdeRestore * 24 : null)}{s.restoreAtrasado ? " · teste mensal pendente" : ""}</span>
              </p>
              {s.ultimoRestore.destino && <p className="mt-2 text-xs text-slate-500">{s.ultimoRestore.destino}</p>}
              {s.ultimoRestore.observacao && <p className="mt-1 break-words text-sm text-slate-700">{s.ultimoRestore.observacao}</p>}
            </div>
          ) : (
            <Aviso tipo="alerta">Nenhum teste de restauração executado ainda. O worker o executa mensalmente; o administrador pode executá-lo agora pelo botão abaixo.</Aviso>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card titulo="Agendamento e configuração">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-500">Próximo backup</dt>
            <dd data-testid="proximo-backup">{proxBackup ? fmtDataHora(proxBackup) : "—"} <span className="text-xs text-slate-500">(cron <code>{cfg.cronBackup}</code>, {cfg.tz})</span></dd>
            <dt className="text-slate-500">Próximo teste de restauração</dt>
            <dd>{proxRestore ? fmtDataHora(proxRestore) : "—"} <span className="text-xs text-slate-500">(cron <code>{cfg.cronRestore}</code>)</span></dd>
            <dt className="text-slate-500">Worker de jobs</dt>
            <dd>{worker ? <Badge cor="verde">conectado</Badge> : <Badge cor="vermelho">fora do ar</Badge>}</dd>
            <dt className="text-slate-500">Cópia fora do provedor</dt>
            <dd data-testid="offsite-configurado" data-configurado={cfg.offsite ? "1" : "0"}>
              {cfg.offsite ? (
                <><Badge cor="verde">configurada</Badge> <span className="break-all text-xs text-slate-600">s3://{cfg.offsite.bucket}/{cfg.offsite.prefixo} ({hostOffsite(cfg.offsite)})</span></>
              ) : (
                <Badge cor="vermelho">não configurada</Badge>
              )}
            </dd>
            <dt className="text-slate-500">Conteúdo e cifra</dt>
            <dd>pg_dump formato custom (schemas: {cfg.schemas.join(", ")}) · AES-256-CBC/PBKDF2 · retenção {cfg.retencaoDias} dias</dd>
          </dl>
          {admin && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <p className="mb-3 text-sm text-slate-600">O backup cobre o banco inteiro da plataforma (todas as organizações). As execuções manuais ficam registradas no log de auditoria.</p>
              <BotoesExecucao backupEmAndamento={andamento.backup} restoreEmAndamento={andamento.restore} />
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card titulo="Histórico (últimos 30 registros)">
          {s.historico.length === 0 ? (
            <Vazio>Sem registros.</Vazio>
          ) : (
            <div className="overflow-x-auto">
              <table className="tabela" data-testid="historico-backup">
                <thead><tr><th>Data/hora</th><th>Tipo</th><th>Resultado</th><th>Tamanho</th><th className="hidden md:table-cell">Destino / detalhes</th></tr></thead>
                <tbody>
                  {s.historico.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{fmtDataHora(r.executado_em)}</td>
                      <td>{r.tipo === "BACKUP" ? "Backup" : r.tipo === "REPLICACAO_ARQUIVOS" ? "Replicação de arquivos" : "Teste de restauração"}</td>
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

      {admin && (
        <div className="mt-4">
          <Card titulo="Registrar teste de restauração manual (checklist completo)">
            <p className="mb-3 text-sm text-slate-600">
              Para o checklist completo de <code>docs/restore.md</code> (subir a aplicação sobre o banco restaurado, validar documentos e anexos). O teste automático acima registra sozinho.
            </p>
            <FormRestore />
          </Card>
        </div>
      )}
    </>
  );
}
