import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { organizacaoDoAdmin, whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { situacaoCertificado } from "@/lib/assinatura/certificado";
import { AcessoNegado } from "@/components/acesso-negado";
import { Aviso, CabecalhoPagina, Card } from "@/components/ui";
import { ListaCertificados, textoValidade } from "@/components/certificados";
import { FormAdmin } from "../_comp/form-admin";
import { Texto } from "../_comp/campos";
import { CamposTitular } from "./campos-titular";
import { desativarCertificadoAdmin, enviarCertificado } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certificados digitais – Administração" };

const CAMPOS_PUBLICOS = {
  id: true, titular: true, nome_titular: true, emissor: true, serial: true, thumbprint_sha1: true, valido_de: true, valido_ate: true, icp_brasil: true, ativo: true,
  municipio: { select: { nome: true } }, usuario: { select: { nome: true } },
} as const;

export default async function Certificados() {
  const { u, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado mensagem="A gestão de certificados digitais é restrita ao administrador." />;
  const org = organizacaoDoAdmin(u);
  const [certificados, municipios, usuarios] = await Promise.all([
    prisma.certificadoDigital.findMany({ where: { organizacao_id: org }, select: CAMPOS_PUBLICOS, orderBy: [{ ativo: "desc" }, { valido_ate: "desc" }] }),
    prisma.municipio.findMany({ where: whereMunicipiosAdmin(u), orderBy: { nome: "asc" }, select: { id: true, nome: true } }),
    prisma.usuario.findMany({ where: { organizacao_id: org, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true, email: true } }),
  ]);
  const agora = new Date();
  const ativos = certificados.filter((c) => c.ativo);
  const vencidos = ativos.filter((c) => situacaoCertificado(c, agora) === "VENCIDO");
  const vencendo = ativos.filter((c) => situacaoCertificado(c, agora) === "VENCENDO");
  const temOrgao = ativos.some((c) => c.titular === "ORGAO" && situacaoCertificado(c, agora) !== "VENCIDO");

  return (
    <>
      <CabecalhoPagina
        titulo="Certificados digitais"
        subtitulo={<><Link href="/admin" className="underline">Administração</Link> · assinatura digital dos documentos oficiais (PAdES / ICP-Brasil)</>}
        acoes={<Link className="btn-secundario" href="/minha-conta/certificado">Meu e-CPF</Link>}
      />
      <div className="space-y-4">
        {vencidos.map((c) => (
          <Aviso key={c.id} tipo="erro">
            O certificado de <strong>{c.nome_titular}</strong> está <strong>{textoValidade(c, agora)}</strong> e deixou de ser usado: os documentos
            passaram a ser assinados com outro certificado vigente ou com assinatura eletrônica avançada. Renove-o na Autoridade Certificadora e envie o novo arquivo.
          </Aviso>
        ))}
        {vencendo.map((c) => (
          <Aviso key={c.id} tipo="alerta">
            O certificado de <strong>{c.nome_titular}</strong> {textoValidade(c, agora)}. Providencie a renovação.
          </Aviso>
        ))}
        {!temOrgao && (
          <Aviso>
            Nenhum e-CNPJ vigente cadastrado: documentos emitidos por servidores sem e-CPF saem com <strong>assinatura eletrônica avançada</strong>
            {" "}(login + código verificador + hash SHA-256 + trilha de auditoria – Lei 14.063/2020, art. 4º, II). Para assinatura qualificada ICP-Brasil,
            cadastre o certificado A1 (e-CNPJ) da prefeitura/secretaria.
          </Aviso>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
          <Card titulo="Certificados cadastrados">
            <ListaCertificados itens={certificados} desativar={desativarCertificadoAdmin} />
          </Card>
          <Card titulo="Enviar certificado A1">
            <FormAdmin action={enviarCertificado} botao="Validar e salvar" limparAoSalvar>
              <Texto name="arquivo" label="Arquivo do certificado (.pfx ou .p12)" type="file" accept=".pfx,.p12,application/x-pkcs12" required dica="Certificado A1 com a chave privada; máximo de 50 KB." />
              <Texto name="senha" label="Senha do certificado" type="password" autoComplete="new-password" required dica="Usada para validar agora e para assinar; guardada cifrada." />
              <CamposTitular municipios={municipios} usuarios={usuarios} />
              <p className="text-xs text-slate-500">
                Ordem de uso na emissão: e-CPF do servidor que emite → e-CNPJ do órgão do documento → e-CNPJ da organização.
                Um certificado ativo por titular (o anterior é desativado). O arquivo e a senha ficam cifrados e nunca são exibidos.
              </p>
            </FormAdmin>
          </Card>
        </div>
      </div>
    </>
  );
}
