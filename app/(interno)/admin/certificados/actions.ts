"use server";
import { acaoAdmin, obrigatorio, txt, txtOuNulo } from "@/lib/admin/acao";
import type { EstadoAcao } from "@/lib/admin/guard";
import { invalido } from "@/lib/http";
import { desativarCertificado, salvarCertificado } from "@/lib/assinatura/servico";

export async function enviarCertificado(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/certificados", async (u) => {
    const titular = txt(f, "titular");
    if (titular !== "ORGAO" && titular !== "USUARIO") throw invalido("Selecione o titular do certificado.", { campo: "titular" });
    const arquivo = f.get("arquivo");
    const c = await salvarCertificado(u, {
      arquivo: arquivo instanceof File && arquivo.size > 0 ? arquivo : null,
      senha: String(f.get("senha") ?? ""),
      titular,
      municipio_id: titular === "ORGAO" ? txtOuNulo(f, "municipio_id") : null,
      usuario_id: titular === "USUARIO" ? txtOuNulo(f, "usuario_id") : null,
    });
    return `Certificado de ${c.nome_titular} cadastrado (${c.icp_brasil ? "ICP-Brasil" : "fora da ICP-Brasil – documentos sairão como “certificado de teste”"}). Use “Testar assinatura” para conferir.`;
  });
}

export async function desativarCertificadoAdmin(_: EstadoAcao, f: FormData): Promise<EstadoAcao> {
  return acaoAdmin("/admin/certificados", async (u) => {
    await desativarCertificado(u, obrigatorio(f, "id", "o certificado"));
    return "Certificado desativado.";
  });
}
