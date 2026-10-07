"use client";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Aviso } from "@/components/ui";
import {
  atualizarClienteAcao, criarClienteAcao, modulosAcao, municipioAcao, reativarAcao, reautenticarAcao, redefinirSenhaAcao, suspenderAcao,
  type EstadoPlataforma,
} from "../actions";

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

/**
 * Envia o formulário sem o reset automático do React 19 (que apagaria tudo o que o operador digitou quando há erro de validação).
 * O atributo `action` continua no <form> (campos $ACTION do envio progressivo); o onSubmit assume o envio.
 */
const enviar = (acao: (dados: FormData) => void) => (e: FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const dados = new FormData(e.currentTarget);
  startTransition(() => acao(dados));
};

function Erro({ e, campo }: { e: EstadoPlataforma; campo?: string }) {
  const msg = campo ? e?.campos?.[campo] : null;
  return msg ? <p role="alert" className="mt-1 text-xs text-red-700">{msg}</p> : null;
}

function Resultado({ e }: { e: EstadoPlataforma }) {
  if (!e) return null;
  if (e.erro) return <Aviso tipo="erro">{e.erro}</Aviso>;
  if (e.ok && e.mensagem) return <Aviso tipo="sucesso">{e.mensagem}</Aviso>;
  return null;
}

/** Credenciais exibidas UMA vez: ao sair da página não há como recuperá-las. */
export function AcessoEntregue({ acesso }: { acesso: NonNullable<EstadoPlataforma>["acesso"] }) {
  if (!acesso || (!acesso.senha && !acesso.link_convite)) return null;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm" data-testid="acesso-entregue">
      <p className="font-semibold text-amber-900">Entregue ao administrador por canal seguro. Estas informações não serão exibidas novamente.</p>
      {acesso.senha && (
        <p>Senha temporária (troca obrigatória no primeiro acesso): <code data-testid="senha-temporaria" className="rounded bg-white px-2 py-1 font-mono text-base select-all">{acesso.senha}</code></p>
      )}
      {acesso.link_convite && (
        <p className="break-all">
          Link para definir a senha (uso único{acesso.expira_em ? `, válido até ${new Date(acesso.expira_em).toLocaleString("pt-BR")}` : ""}):{" "}
          <code data-testid="link-convite" className="select-all">{acesso.link_convite}</code>
          {acesso.email_enviado ? " — também enviado por e-mail." : " — e-mail registrado na caixa de saída (SMTP não configurado ou falhou)."}
        </p>
      )}
    </div>
  );
}

export function FormReautenticar() {
  const [estado, acao, pendente] = useActionState(reautenticarAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="mx-auto max-w-sm space-y-4">
      <p className="text-sm text-slate-600">Por segurança, confirme sua senha para acessar o painel da plataforma. A confirmação vale por 15 minutos.</p>
      <div>
        <label htmlFor="senha-reauth" className="label">Senha</label>
        <input id="senha-reauth" name="senha" type="password" required autoComplete="current-password" className="input" />
      </div>
      {estado?.erro && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{estado.erro}</p>}
      <button className="btn-primario w-full" disabled={pendente}>{pendente ? "Verificando…" : "Confirmar senha"}</button>
    </form>
  );
}

type Municipio = { nome: string; uf: string; ibge: string };

export function FormNovoCliente() {
  const [estado, acao, pendente] = useActionState(criarClienteAcao, undefined);
  const [modulos, setModulos] = useState<string[]>(["LICENCIAMENTO"]);
  const [municipios, setMunicipios] = useState<Municipio[]>([{ nome: "", uf: "BA", ibge: "" }]);
  const tem = (m: string) => modulos.includes(m);
  const alternar = (m: string) => setModulos((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]));
  const atualizar = (i: number, p: Partial<Municipio>) => setMunicipios((l) => l.map((m, j) => (j === i ? { ...m, ...p } : m)));

  if (estado?.ok && estado.acesso) {
    return (
      <div className="space-y-4">
        <Resultado e={estado} />
        <AcessoEntregue acesso={estado.acesso} />
        {estado.organizacao_id && <a className="btn-primario" href={`/plataforma/clientes/${estado.organizacao_id}`}>Abrir o cliente</a>}
      </div>
    );
  }
  return (
    <form action={acao} onSubmit={enviar(acao)} className="space-y-6" noValidate>
      <Resultado e={estado} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-700">Dados do cliente</legend>
        <div className="sm:col-span-2">
          <label htmlFor="nome" className="label">Nome do cliente</label>
          <input id="nome" name="nome" required className="input" maxLength={160} />
          <Erro e={estado} campo="nome" />
        </div>
        <div>
          <label htmlFor="sigla" className="label">Sigla (única)</label>
          <input id="sigla" name="sigla" required className="input uppercase" maxLength={20} />
          <Erro e={estado} campo="sigla" />
        </div>
        <div>
          <label htmlFor="cnpj" className="label">CNPJ (opcional)</label>
          <input id="cnpj" name="cnpj" className="input" inputMode="numeric" />
          <Erro e={estado} campo="cnpj" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="slug" className="label">Endereço público (opcional)</label>
          <input id="slug" name="slug" className="input" maxLength={60} />
          <p className="mt-1 text-xs text-slate-500">Usado no portal público do cliente (ex.: /protocolo/endereco). Único; letras minúsculas, números e hífen.</p>
          <Erro e={estado} campo="slug" />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-slate-700">Módulos contratados</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="modulos" value="LICENCIAMENTO" checked={tem("LICENCIAMENTO")} onChange={() => alternar("LICENCIAMENTO")} /> Licenciamento ambiental</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="modulos" value="GED" checked={tem("GED")} onChange={() => alternar("GED")} /> Gestão de Documentos</label>
        <Erro e={estado} campo="modulos" />
      </fieldset>

      {tem("LICENCIAMENTO") && (
        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-semibold text-slate-700">Órgãos/municípios iniciais</legend>
          {municipios.map((m, i) => (
            <div key={i} className="grid gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_6rem_9rem_auto]">
              <div><label htmlFor={`mn-${i}`} className="label">Nome</label><input id={`mn-${i}`} name="municipio_nome" className="input" value={m.nome} onChange={(e) => atualizar(i, { nome: e.target.value })} /></div>
              <div><label htmlFor={`mu-${i}`} className="label">UF</label><select id={`mu-${i}`} name="municipio_uf" className="input" value={m.uf} onChange={(e) => atualizar(i, { uf: e.target.value })}>{UFS.map((u) => <option key={u}>{u}</option>)}</select></div>
              <div><label htmlFor={`mi-${i}`} className="label">Código IBGE</label><input id={`mi-${i}`} name="municipio_ibge" className="input" inputMode="numeric" maxLength={7} value={m.ibge} onChange={(e) => atualizar(i, { ibge: e.target.value })} /></div>
              <div className="flex items-end"><button type="button" className="btn-secundario btn-sm" onClick={() => setMunicipios((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : l))} disabled={municipios.length === 1}>Remover</button></div>
            </div>
          ))}
          <Erro e={estado} campo="municipios" />
          <button type="button" className="btn-secundario btn-sm" onClick={() => setMunicipios((l) => [...l, { nome: "", uf: l[l.length - 1]?.uf ?? "BA", ibge: "" }])}>Adicionar órgão</button>
        </fieldset>
      )}

      {tem("GED") && (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold text-slate-700">Gestão de Documentos</legend>
          <div>
            <label htmlFor="cota_gb" className="label">Cota de armazenamento (GB)</label>
            <input id="cota_gb" name="cota_gb" type="number" min={1} defaultValue={10} className="input" />
          </div>
          <p className="self-end text-xs text-slate-500">Serão criados: configuração padrão, setores (Administração, Protocolo, Jurídico), tipos de documento comuns e o administrador como GED_ADMIN.</p>
        </fieldset>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-700">Administrador inicial</legend>
        <div><label htmlFor="admin_nome" className="label">Nome</label><input id="admin_nome" name="admin_nome" required className="input" /><Erro e={estado} campo="admin_nome" /></div>
        <div><label htmlFor="admin_email" className="label">E-mail</label><input id="admin_email" name="admin_email" type="email" required className="input" /><Erro e={estado} campo="admin_email" /></div>
        <div><label htmlFor="admin_whatsapp" className="label">WhatsApp (opcional)</label><input id="admin_whatsapp" name="admin_whatsapp" className="input" inputMode="tel" /><Erro e={estado} campo="admin_whatsapp" /><p className="mt-1 text-xs text-slate-500">Guardado cifrado, só no módulo GED; o consentimento para mensagens é confirmado pelo próprio usuário.</p></div>
        <div>
          <label htmlFor="entrega" className="label">Entrega do acesso</label>
          <select id="entrega" name="entrega" className="input" defaultValue="SENHA">
            <option value="SENHA">Senha temporária (exibida uma vez)</option>
            <option value="CONVITE">Convite por e-mail (link de uso único)</option>
            <option value="AMBOS">Senha temporária e convite por e-mail</option>
          </select>
        </div>
      </fieldset>
      <button className="btn-primario" disabled={pendente || modulos.length === 0}>{pendente ? "Criando…" : "Criar cliente"}</button>
    </form>
  );
}

export function FormEditarCliente({ id, nome, cnpj, slug }: { id: string; nome: string; cnpj: string | null; slug: string | null }) {
  const [estado, acao, pendente] = useActionState(atualizarClienteAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <div className="sm:col-span-2"><label htmlFor="ed-nome" className="label">Nome</label><input id="ed-nome" name="nome" defaultValue={nome} className="input" required /><Erro e={estado} campo="nome" /></div>
      <div><label htmlFor="ed-cnpj" className="label">CNPJ</label><input id="ed-cnpj" name="cnpj" defaultValue={cnpj ?? ""} className="input" /><Erro e={estado} campo="cnpj" /></div>
      <div><label htmlFor="ed-slug" className="label">Endereço público</label><input id="ed-slug" name="slug" defaultValue={slug ?? ""} className="input" /><Erro e={estado} campo="slug" /><p className="mt-1 text-xs text-slate-500">Mudar o endereço quebra links já divulgados do portal.</p></div>
      <div className="sm:col-span-2 space-y-2"><Resultado e={estado} /><button className="btn-secundario" disabled={pendente}>Salvar dados</button></div>
    </form>
  );
}

export function FormModulos({ id, modulos }: { id: string; modulos: string[] }) {
  const [estado, acao, pendente] = useActionState(modulosAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="modulos" value="LICENCIAMENTO" defaultChecked={modulos.includes("LICENCIAMENTO")} /> Licenciamento ambiental</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="modulos" value="GED" defaultChecked={modulos.includes("GED")} /> Gestão de Documentos</label>
      <p className="text-xs text-slate-500">Desativar um módulo não apaga dados: apenas bloqueia o acesso. Ao reativar, tudo volta como estava.</p>
      <Erro e={estado} campo="modulos" />
      <Resultado e={estado} />
      <button className="btn-secundario" disabled={pendente}>Salvar módulos</button>
    </form>
  );
}

export function FormMunicipio({ id }: { id: string }) {
  const [estado, acao, pendente] = useActionState(municipioAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="grid gap-3 sm:grid-cols-[1fr_6rem_9rem_auto]">
      <input type="hidden" name="id" value={id} />
      <div><label htmlFor="mm-nome" className="label">Nome do órgão/município</label><input id="mm-nome" name="nome" required className="input" /></div>
      <div><label htmlFor="mm-uf" className="label">UF</label><select id="mm-uf" name="uf" className="input" defaultValue="BA">{UFS.map((u) => <option key={u}>{u}</option>)}</select></div>
      <div><label htmlFor="mm-ibge" className="label">Código IBGE</label><input id="mm-ibge" name="codigo_ibge" required inputMode="numeric" maxLength={7} className="input" /><Erro e={estado} campo="codigo_ibge" /></div>
      <div className="flex items-end"><button className="btn-secundario" disabled={pendente}>Adicionar</button></div>
      <div className="sm:col-span-4"><Resultado e={estado} /></div>
    </form>
  );
}

export function FormSuspender({ id, sigla }: { id: string; sigla: string }) {
  const [estado, acao, pendente] = useActionState(suspenderAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Aviso tipo="alerta">Suspender derruba as sessões, bloqueia o login de todos os usuários do cliente e tira do ar os portais públicos e canais. Os dados são preservados.</Aviso>
      <div><label htmlFor="sp-motivo" className="label">Motivo</label><input id="sp-motivo" name="motivo" required minLength={5} maxLength={500} className="input" /><Erro e={estado} campo="motivo" /></div>
      <div><label htmlFor="sp-conf" className="label">Digite a sigla <strong>{sigla}</strong> para confirmar</label><input id="sp-conf" name="confirmacao" required autoComplete="off" className="input" /><Erro e={estado} campo="confirmacao" /></div>
      <Resultado e={estado} />
      <button className="btn-perigo" disabled={pendente}>{pendente ? "Suspendendo…" : "Suspender cliente"}</button>
    </form>
  );
}

export function FormReativar({ id, sigla }: { id: string; sigla: string }) {
  const [estado, acao, pendente] = useActionState(reativarAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div><label htmlFor="re-conf" className="label">Digite a sigla <strong>{sigla}</strong> para confirmar</label><input id="re-conf" name="confirmacao" required autoComplete="off" className="input" /><Erro e={estado} campo="confirmacao" /></div>
      <Resultado e={estado} />
      <button className="btn-primario" disabled={pendente}>{pendente ? "Reativando…" : "Reativar cliente"}</button>
    </form>
  );
}

export function FormRedefinirSenha({ id, usuarioId, email }: { id: string; usuarioId: string; email: string }) {
  const [estado, acao, pendente] = useActionState(redefinirSenhaAcao, undefined);
  return (
    <form action={acao} onSubmit={enviar(acao)} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="usuario_id" value={usuarioId} />
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`rs-${usuarioId}`} className="label">Redefinir senha de {email}</label>
          <select id={`rs-${usuarioId}`} name="entrega" className="input" defaultValue="SENHA">
            <option value="SENHA">Senha temporária</option>
            <option value="CONVITE">Convite por e-mail</option>
            <option value="AMBOS">Senha e convite</option>
          </select>
        </div>
        <button className="btn-secundario" disabled={pendente}>Redefinir</button>
      </div>
      <Resultado e={estado} />
      <AcessoEntregue acesso={estado?.acesso} />
    </form>
  );
}
