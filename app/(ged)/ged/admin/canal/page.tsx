import Link from "next/link";
import { forbidden } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { PainelCanalGed } from "@/components/ged/admin/painel-canal";
import { obterConfigCanal } from "@/lib/ged/admin/canal";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed } from "@/lib/ged/papeis";
import { ativarCanalAction, desvincularCanalAction, salvarCanalAction, vincularCanalAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Canal de WhatsApp – Gestão de Documentos" };

const DICAS: Record<string, string> = {
  WHATSAPP_EVOLUTION: "Informe o nome da instância e (opcional) a URL e a API key da sua Evolution API. “Criar instância / QR Code” cria a instância se preciso e mostra o QR para parear. Nenhum webhook é registrado: este canal só envia.",
  WHATSAPP_ZAPI: "Informe o ID da instância, o token e o Client-Token da Z-API. Use “Mostrar QR Code” para parear. Nenhum webhook é configurado: este canal só envia.",
};

export default async function PaginaCanal() {
  const ctx = await exigirGed();
  if (!podeAdministrarGed(ctx)) forbidden();
  const cfg = await obterConfigCanal(ctx);
  const vinculado = cfg.canais.find((c) => c.vinculado) ?? null;
  const outros = cfg.canais.filter((c) => !c.vinculado);

  return (
    <>
      <CabecalhoPagina
        titulo="Canal de WhatsApp"
        subtitulo={<><Link href="/ged/admin" prefetch={false} className="underline">Administração</Link> · número usado para enviar as notificações do módulo (somente envio)</>}
      />
      <div className="space-y-4">
        {cfg.simulado && <Aviso tipo="alerta">O servidor está em modo de envio <strong>simulado</strong> (CANAIS_ENVIO_SIMULADO): nenhuma mensagem real é enviada; os envios aparecem como “Simulada” nos logs.</Aviso>}
        <Aviso>
          As pessoas só recebem WhatsApp depois de cadastrar e <strong>confirmar</strong> o próprio telefone em <Link href="/ged/minha-conta/notificacoes" prefetch={false} className="underline">Minhas notificações</Link> (opt-in por código).
          Provedores não oficiais (Evolution, Z-API) têm risco de bloqueio do número; use um número dedicado e envios moderados. A API oficial (templates aprovados) não é usada nesta fase.
        </Aviso>

        <Card titulo="Canal vinculado" acoes={vinculado ? (vinculado.ativo ? <Badge cor="verde">Ativo</Badge> : <Badge cor="cinza">Inativo</Badge>) : <Badge cor="amarelo">Não configurado</Badge>}>
          {!vinculado ? (
            <p className="text-sm text-slate-600">Nenhum canal vinculado: as notificações vão apenas por e-mail. Configure um canal abaixo.</p>
          ) : (
            <div data-testid="canal-vinculado">
              <p className="font-medium">{vinculado.nome}</p>
              <p className="text-sm text-slate-600">{vinculado.rotulo_tipo}{vinculado.status_conexao ? ` · conexão: ${vinculado.status_conexao}` : ""}</p>
              <p className="mt-1 text-xs text-slate-500">Credenciais guardadas cifradas e nunca exibidas{vinculado.segredos_definidos.length ? ` (definidas: ${vinculado.segredos_definidos.join(", ")})` : ""}.</p>
              <PainelCanalGed canalId={vinculado.id} tipo={vinculado.tipo} />
              <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3">
                <FormGed action={ativarCanalAction} botao={vinculado.ativo ? "Desativar canal" : "Ativar canal"} classeBotao="btn-secundario" rotuloAcessivel="Ativar ou desativar o canal">
                  <input type="hidden" name="canal_id" value={vinculado.id} />
                  <input type="hidden" name="ativo" value={vinculado.ativo ? "false" : "true"} />
                </FormGed>
                <FormGed action={desvincularCanalAction} botao="Desvincular" classeBotao="btn-secundario" confirmar="Desvincular o canal? As notificações por WhatsApp ficam suspensas." rotuloAcessivel="Desvincular canal" />
              </div>
            </div>
          )}
        </Card>

        {outros.length > 0 && (
          <Card titulo="Outros canais de envio do cliente">
            <ul className="divide-y divide-slate-100">
              {outros.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>{c.nome} <span className="text-slate-500">({c.rotulo_tipo})</span></span>
                  <FormGed action={vincularCanalAction} botao="Usar este canal" classeBotao="btn-secundario" inline rotuloAcessivel={`Usar o canal ${c.nome}`}><input type="hidden" name="canal_id" value={c.id} /></FormGed>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {cfg.tipos.map((t) => {
            const existente = cfg.canais.find((c) => c.tipo === t.id && (vinculado ? c.id === vinculado.id : true)) ?? cfg.canais.find((c) => c.tipo === t.id) ?? null;
            const editando = existente && (existente.vinculado || !vinculado);
            return (
              <Card key={t.id} titulo={`${editando ? "Editar" : "Configurar"} – ${t.rotulo}`}>
                <FormGed action={salvarCanalAction} botao={editando ? "Salvar canal" : "Criar e vincular canal"} rotuloAcessivel={`Canal ${t.rotulo}`}>
                  <input type="hidden" name="tipo" value={t.id} />
                  {editando && <input type="hidden" name="id" value={existente!.id} />}
                  <div><label className="label" htmlFor={`${t.id}-nome`}>Nome do canal</label><input id={`${t.id}-nome`} name="nome" className="input" required minLength={3} maxLength={120} defaultValue={editando ? existente!.nome : "WhatsApp de notificações"} /></div>
                  {t.campos.publicos.map((c) => (
                    <div key={c.k}>
                      <label className="label" htmlFor={`${t.id}-p-${c.k}`}>{c.rotulo}</label>
                      <input id={`${t.id}-p-${c.k}`} name={`p_${c.k}`} className="input" maxLength={500} defaultValue={editando ? existente!.config[c.k] ?? "" : ""} />
                      {c.dica && <span className="mt-1 block text-xs text-slate-500">{c.dica}</span>}
                    </div>
                  ))}
                  {t.campos.segredos.map((c) => (
                    <div key={c.k}>
                      <label className="label" htmlFor={`${t.id}-s-${c.k}`}>{c.rotulo}</label>
                      <input id={`${t.id}-s-${c.k}`} name={`s_${c.k}`} type="password" autoComplete="new-password" className="input" maxLength={2000} placeholder={editando && existente!.segredos_definidos.includes(c.k) ? "•••••• (manter)" : ""} />
                      {c.dica && <span className="mt-1 block text-xs text-slate-500">{c.dica}</span>}
                    </div>
                  ))}
                  <p className="text-xs text-slate-600">{DICAS[t.id]}</p>
                </FormGed>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
