import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { CabecalhoPagina } from "@/components/ui";
import { municipiosDoUsuario } from "@/lib/fiscalizacao/servico";
import { podeCriarDenuncia } from "@/lib/fiscalizacao/regras";
import { SemAcesso } from "../../_componentes/sem-acesso";
import { FormDenunciaInterna } from "./form";

export const metadata = { title: "Registrar denúncia – LicenciaGov" };

export default async function NovaDenuncia() {
  const u = await exigirUsuario({ interno: true });
  if (!podeCriarDenuncia(u)) return <SemAcesso mensagem="Seu perfil não pode registrar denúncias." />;
  const municipios = (await municipiosDoUsuario(u)).filter((m) => podeCriarDenuncia(u, m.id));
  return (
    <div className="mx-auto max-w-2xl">
      <CabecalhoPagina titulo="Registrar denúncia" subtitulo="Denúncia recebida presencialmente, por telefone ou outro canal" acoes={<Link href="/fiscalizacao/denuncias" className="btn-secundario btn-sm">Voltar</Link>} />
      <FormDenunciaInterna municipios={municipios} />
    </div>
  );
}
