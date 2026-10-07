import Link from "next/link";
import { Aviso, Badge, CabecalhoPagina, Card } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { exigirGed } from "@/lib/ged/escopo";
import { estadoWhatsapp, lerPreferencias } from "@/lib/ged/notificar/preferencias";
import { fmtDataHora } from "@/lib/format";
import { confirmarCodigoAction, revogarWhatsappAction, salvarPreferenciasAction, solicitarCodigoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minhas notificações – Gestão de Documentos" };

export default async function PaginaNotificacoes() {
  const ctx = await exigirGed();
  const [prefs, wa] = await Promise.all([lerPreferencias(ctx), estadoWhatsapp(ctx)]);

  return (
    <>
      <CabecalhoPagina
        titulo="Minhas notificações"
        subtitulo={`${ctx.usuario.nome} · ${ctx.usuario.email}`}
        acoes={<Link href="/trocar-senha" prefetch={false} className="btn-secundario">Alterar senha</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card titulo="Avisos por e-mail e WhatsApp">
          <p className="mb-3 text-sm text-slate-600">Escolha por qual canal quer ser avisado(a) em cada situação. O e-mail vai para {ctx.usuario.email}.</p>
          <FormGed action={salvarPreferenciasAction} botao="Salvar preferências" rotuloAcessivel="Preferências de notificação">
            <fieldset>
              <legend className="sr-only">Canais por tipo de aviso</legend>
              <div className="overflow-x-auto">
                <table className="tabela" data-testid="tabela-preferencias">
                  <thead><tr><th>Aviso</th><th className="text-center">E-mail</th><th className="text-center">WhatsApp</th></tr></thead>
                  <tbody>
                    {prefs.map((p) => (
                      <tr key={p.evento}>
                        <td>{p.rotulo}</td>
                        <td className="text-center"><input type="checkbox" name={`email_${p.evento}`} defaultChecked={p.email} aria-label={`${p.rotulo} – e-mail`} className="h-5 w-5" /></td>
                        <td className="text-center"><input type="checkbox" name={`whatsapp_${p.evento}`} defaultChecked={p.whatsapp} aria-label={`${p.rotulo} – WhatsApp`} className="h-5 w-5" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
            {wa.situacao !== "CONFIRMADO" && <p className="text-xs text-slate-500">Os avisos por WhatsApp só são enviados depois que você confirmar o seu telefone no cartão “WhatsApp”.</p>}
          </FormGed>
        </Card>

        <Card titulo="WhatsApp" acoes={wa.situacao === "CONFIRMADO" ? <Badge cor="verde">Confirmado</Badge> : wa.situacao === "AGUARDANDO_CODIGO" ? <Badge cor="amarelo">Aguardando código</Badge> : <Badge cor="cinza">Desligado</Badge>}>
          {!wa.canal_configurado && (
            <Aviso tipo="alerta">O envio por WhatsApp ainda não foi configurado pelo administrador da sua organização. Por enquanto você recebe apenas e-mails.</Aviso>
          )}
          {wa.canal_configurado && wa.situacao === "SEM_TELEFONE" && (
            <FormGed action={solicitarCodigoAction} botao="Enviar código por WhatsApp" rotuloAcessivel="Cadastrar telefone de WhatsApp">
              <p className="text-sm text-slate-600">Informe o seu telefone com DDD. Enviaremos um código de 6 dígitos para confirmar que o número é seu (opt-in).</p>
              <div><label className="label" htmlFor="wa-tel">Telefone (WhatsApp)</label><input id="wa-tel" name="telefone" type="tel" inputMode="tel" autoComplete="tel" className="input" placeholder="(75) 99999-8888" required /></div>
            </FormGed>
          )}
          {wa.canal_configurado && wa.situacao === "AGUARDANDO_CODIGO" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Enviamos um código para <strong>{wa.telefone_mascarado}</strong>.{" "}
                {wa.codigo_expira_em ? `Vale até ${fmtDataHora(wa.codigo_expira_em)}; restam ${wa.tentativas_restantes} tentativa(s).` : "O código expirou: peça outro abaixo."}
              </p>
              {wa.codigo_expira_em && (
                <FormGed action={confirmarCodigoAction} botao="Confirmar telefone" rotuloAcessivel="Confirmar código do WhatsApp" limparAoSalvar>
                  <div><label className="label" htmlFor="wa-codigo">Código de 6 dígitos</label><input id="wa-codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} className="input" required /></div>
                </FormGed>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-primaria-700">Não recebeu? Pedir novo código ou trocar o número</summary>
                <div className="mt-3 space-y-3">
                  <FormGed action={solicitarCodigoAction} botao="Enviar novo código" classeBotao="btn-secundario" rotuloAcessivel="Pedir novo código">
                    <div><label className="label" htmlFor="wa-tel2">Telefone (WhatsApp)</label><input id="wa-tel2" name="telefone" type="tel" inputMode="tel" className="input" placeholder="(75) 99999-8888" required /></div>
                  </FormGed>
                  <FormGed action={revogarWhatsappAction} botao="Cancelar" classeBotao="btn-secundario" rotuloAcessivel="Cancelar cadastro do WhatsApp" />
                </div>
              </details>
            </div>
          )}
          {wa.situacao === "CONFIRMADO" && (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">Telefone <strong>{wa.telefone_mascarado}</strong> confirmado em {fmtDataHora(wa.confirmado_em)}. Você pode desativar a qualquer momento.</p>
              <FormGed action={revogarWhatsappAction} botao="Desativar WhatsApp e remover telefone" classeBotao="btn-perigo" confirmar="Desativar as notificações por WhatsApp e apagar o telefone?" rotuloAcessivel="Revogar WhatsApp" />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
