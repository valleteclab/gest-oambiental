import "server-only";
import { prisma } from "@/lib/db";
import { podeVerMunicipio, type UsuarioSessao } from "@/lib/rbac";
import { podeEmitirFiscalizacao } from "@/lib/fiscalizacao/regras";

/** Carrega a fiscalização para os formulários de auto/notificação, com checagem de escopo e permissão. */
export async function fiscalizacaoParaForm(u: UsuarioSessao, id: string) {
  const f = await prisma.fiscalizacao.findUnique({
    where: { id },
    select: {
      id: true, municipio_id: true, data_hora: true, relato: true, constatacao: true,
      municipio: { select: { nome: true } },
      empreendimento: { select: { nome: true, requerente: { select: { id: true, nome: true, tipo: true, cpf_cnpj_mascara: true } } } },
      denuncia: { select: { protocolo: true } },
    },
  });
  if (!f) return { status: 404 as const };
  if (!podeVerMunicipio(u, f.municipio_id) || !podeEmitirFiscalizacao(u, f.municipio_id)) return { status: 403 as const };
  return { status: 200 as const, f };
}
