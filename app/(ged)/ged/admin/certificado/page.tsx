import Link from "next/link";
import { forbidden } from "next/navigation";
import { Aviso, Badge, CabecalhoPagina, Card, Vazio } from "@/components/ui";
import { FormGed } from "@/components/ged/form-ged";
import { listarCertificados } from "@/lib/ged/admin/certificado";
import { exigirGed } from "@/lib/ged/escopo";
import { podeAdministrarGed } from "@/lib/ged/papeis";
import { fmtData } from "@/lib/format";
import { desativarCertificadoAction, enviarCertificadoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificado digital – Gestão de Documentos" };

const COR = { VALIDO: "verde", VENCENDO: "amarelo", VENCIDO: "vermelho", FUTURO: "azul", INATIVO: "cinza" } as const;
const ROTULO = { VALIDO: "Válido", VENCENDO: "Vencendo", VENCIDO: "Vencido", FUTURO: "Ainda não vigente", INATIVO: "Desativado" } as const;

export default async function PaginaCertificado() {
  const ctx = await exigirGed();
  if (!podeAdministrarGed(ctx)) forbidden();
  const certs = await listarCertificados(ctx);
  const ativos = certs.filter((c) => c.ativo);
  const vigente = ativos.find((c) => c.situacao === "VALIDO" || c.situacao === "VENCENDO");

  return (
    <>
      <CabecalhoPagina
        titulo="Certificado digital (e-CNPJ A1)"
        subtitulo={<><Link href="/ged/admin" prefetch={false} className="underline">Administração</Link> · selo digital do órgão nos documentos assinados (PAdES)</>}
      />
      <div className="space-y-4">
        {!vigente && (
          <Aviso tipo="alerta">
            Nenhum e-CNPJ A1 vigente. Os documentos concluídos recebem o selo com <strong>assinatura eletrônica avançada</strong> (Lei 14.063/2020) e aviso visível; para o selo ICP-Brasil, envie o certificado A1 do órgão.
          </Aviso>
        )}
        {ativos.filter((c) => c.situacao === "VENCENDO").map((c) => <Aviso key={c.id} tipo="alerta">O certificado de <strong>{c.nome_titular}</strong> vence em {c.dias_para_vencer} dia(s) ({fmtData(c.valido_ate)}). Providencie a renovação.</Aviso>)}
        {ativos.filter((c) => c.situacao === "VENCIDO").map((c) => <Aviso key={c.id} tipo="erro">O certificado de <strong>{c.nome_titular}</strong> está vencido e não é mais usado nas assinaturas. Envie o novo arquivo.</Aviso>)}
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <Card titulo="Certificados cadastrados">
            {certs.length === 0 ? <Vazio>Nenhum certificado cadastrado.</Vazio> : (
              <ul className="divide-y divide-slate-100" data-testid="lista-certificados">
                {certs.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-words">{c.nome_titular}</span>
                      <Badge cor={COR[c.situacao]}>{ROTULO[c.situacao]}</Badge>
                      {c.icp_brasil ? <Badge cor="verde">ICP-Brasil</Badge> : <Badge cor="amarelo">Fora da ICP-Brasil (teste)</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-slate-600">Emissor: {c.emissor} · Série: <span className="font-mono">{c.serial.slice(0, 16)}</span> · Válido de {fmtData(c.valido_de)} até {fmtData(c.valido_ate)}</p>
                    {c.ativo && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <a className="btn-secundario btn-sm" href={`/api/v1/ged/admin/certificado/${c.id}/teste`} download>Testar assinatura (baixar PDF)</a>
                        <FormGed action={desativarCertificadoAction} botao="Desativar" classeBotao="btn-secundario" inline confirmar="Desativar este certificado? Os próximos selos usarão assinatura eletrônica avançada." rotuloAcessivel={`Desativar certificado de ${c.nome_titular}`}>
                          <input type="hidden" name="id" value={c.id} />
                        </FormGed>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card titulo="Enviar ou substituir certificado A1" className="self-start">
            <FormGed action={enviarCertificadoAction} botao="Validar e salvar" limparAoSalvar rotuloAcessivel="Enviar certificado A1">
              <div><label className="label" htmlFor="cert-arq">Arquivo do certificado (.pfx ou .p12)</label><input id="cert-arq" name="arquivo" type="file" accept=".pfx,.p12,application/x-pkcs12" className="input" required /><span className="mt-1 block text-xs text-slate-500">Certificado A1 do órgão (e-CNPJ) com a chave privada; máximo de 50 KB.</span></div>
              <div><label className="label" htmlFor="cert-senha">Senha do certificado</label><input id="cert-senha" name="senha" type="password" autoComplete="new-password" className="input" required /><span className="mt-1 block text-xs text-slate-500">Usada para validar agora e para assinar; guardada cifrada, nunca exibida.</span></div>
              <p className="text-xs text-slate-500">Um único certificado ativo: o anterior é desativado ao enviar o novo. Certificado vencido, com senha incorreta ou de pessoa física (e-CPF) é recusado.</p>
            </FormGed>
          </Card>
        </div>
      </div>
    </>
  );
}
