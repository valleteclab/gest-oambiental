import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/rbac";
import { podeTerCertificadoProprio } from "@/lib/assinatura/servico";
import { AcessoNegado } from "@/components/acesso-negado";
import { Aviso, CabecalhoPagina, Card } from "@/components/ui";
import { ListaCertificados } from "@/components/certificados";
import { FormAdmin } from "../../admin/_comp/form-admin";
import { Texto } from "../../admin/_comp/campos";
import { desativarMeuCertificado, enviarMeuCertificado } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meu certificado digital – LicenciaGov" };

export default async function MeuCertificado() {
  const u = await exigirUsuario({ interno: true });
  if (!podeTerCertificadoProprio(u)) return <AcessoNegado mensagem="Somente servidores que emitem documentos oficiais podem cadastrar certificado digital." />;
  const certificados = await prisma.certificadoDigital.findMany({
    where: { organizacao_id: u.organizacao_id!, titular: "USUARIO", usuario_id: u.id },
    select: {
      id: true, titular: true, nome_titular: true, emissor: true, serial: true, thumbprint_sha1: true, valido_de: true, valido_ate: true, icp_brasil: true, ativo: true,
      municipio: { select: { nome: true } }, usuario: { select: { nome: true } },
    },
    orderBy: [{ ativo: "desc" }, { valido_ate: "desc" }],
  });
  const admin = can(u, "configurar", "admin");
  return (
    <>
      <CabecalhoPagina
        titulo="Meu certificado digital (e-CPF)"
        subtitulo="Assine digitalmente, com certificado ICP-Brasil, os documentos oficiais que você emitir"
        acoes={admin ? <Link className="btn-secundario" href="/admin/certificados">Certificados da organização</Link> : undefined}
      />
      <div className="space-y-4">
        <Aviso>
          Com um e-CPF A1 ativo, as licenças, pareceres, autos e demais documentos emitidos por você recebem assinatura digital PAdES com o seu certificado
          (MP 2.200-2/2001). Sem ele, vale o e-CNPJ do órgão (se cadastrado) ou a assinatura eletrônica avançada do sistema.
        </Aviso>
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card titulo="Meus certificados">
            <ListaCertificados itens={certificados} desativar={desativarMeuCertificado} />
          </Card>
          <Card titulo="Enviar meu e-CPF (A1)">
            <FormAdmin action={enviarMeuCertificado} botao="Validar e salvar" limparAoSalvar>
              <Texto name="arquivo" label="Arquivo do certificado (.pfx ou .p12)" type="file" accept=".pfx,.p12,application/x-pkcs12" required dica="Certificado A1 com a chave privada; máximo de 50 KB." />
              <Texto name="senha" label="Senha do certificado" type="password" autoComplete="new-password" required dica="Guardada cifrada; usada apenas para assinar os documentos que você emitir." />
              <p className="text-xs text-slate-500">Certificados A3 (token/cartão) ainda não são suportados.</p>
            </FormAdmin>
          </Card>
        </div>
      </div>
    </>
  );
}
