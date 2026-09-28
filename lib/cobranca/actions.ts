"use server";
import { revalidatePath } from "next/cache";
import type { FaseCobranca } from "@prisma/client";
import { getUsuario } from "../auth";
import { ErroApi } from "../http";
import { baixaManual, cancelarCobranca, gerarCobrancaManual, isentar, reenviarCobranca, simularPagamento, tentarNovamente } from "./servico";
import { FASES } from "./regras";

// Server Actions das cobranças (aba Taxas do processo, /financeiro e "Meus processos"). Permissão revalidada no serviço.

export type EstadoCobranca = { ok?: boolean; mensagem?: string; erro?: string } | undefined;

function revalidar(processoId?: string | null) {
  revalidatePath("/financeiro");
  if (processoId) {
    revalidatePath(`/processos/${processoId}`);
    revalidatePath(`/meus-processos/${processoId}`);
  }
}

async function executar(processoId: string | null, fn: () => Promise<string>): Promise<EstadoCobranca> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  try {
    const mensagem = await fn();
    revalidar(processoId);
    return { ok: true, mensagem };
  } catch (e) {
    if (e instanceof ErroApi) return { erro: e.message };
    console.error(e);
    return { erro: "Não foi possível concluir a operação." };
  }
}

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const pid = (f: FormData) => txt(f, "processo_id") || null;
/** "1.234,56" / "1234,56" / "1234.56" → "1234.56" */
const decimal = (v: string) => (v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);

export async function acaoCobranca(_: EstadoCobranca, f: FormData): Promise<EstadoCobranca> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  const id = txt(f, "id");
  const acao = txt(f, "acao");
  return executar(pid(f), async () => {
    switch (acao) {
      case "baixa": {
        const valor = decimal(txt(f, "valor_pago"));
        const data = txt(f, "pago_em");
        const arq = f.get("comprovante");
        const c = await baixaManual(id, u, {
          motivo: txt(f, "motivo"),
          forma: txt(f, "forma") || "MANUAL",
          pago_em: /^\d{4}-\d{2}-\d{2}$/.test(data) ? new Date(`${data}T12:00:00Z`) : null,
          valor_pago: valor && Number.isFinite(Number(valor)) && Number(valor) > 0 ? Number(valor) : null,
          comprovante: arq instanceof File ? arq : null,
        });
        return `Baixa manual registrada (${c.numero}).`;
      }
      case "isentar":
        return `Cobrança ${(await isentar(id, u, txt(f, "motivo"))).numero} isenta.`;
      case "cancelar":
        return `Cobrança ${(await cancelarCobranca(id, u, txt(f, "motivo"))).numero} cancelada.`;
      case "tentar":
        return `Cobrança ${(await tentarNovamente(id, u)).numero} registrada no gateway.`;
      case "reenviar": {
        const n = await reenviarCobranca(id, u);
        return n ? `Dados de pagamento reenviados a ${n} e-mail(s) do requerente.` : "O requerente não tem usuário com e-mail cadastrado.";
      }
      case "simular":
        return `Pagamento simulado – ${(await simularPagamento(id, u)).numero} marcada como paga.`;
      default:
        throw new ErroApi(422, "INVALIDO", "Ação inválida.");
    }
  });
}

export async function gerarCobrancaAcao(_: EstadoCobranca, f: FormData): Promise<EstadoCobranca> {
  const u = await getUsuario();
  if (!u) return { erro: "Sessão expirada. Entre novamente." };
  const fase = txt(f, "fase") as FaseCobranca;
  const valor = decimal(txt(f, "valor"));
  return executar(pid(f), async () => {
    if (!FASES.includes(fase)) throw new ErroApi(422, "INVALIDO", "Fase inválida.");
    const v = valor ? Number(valor) : null;
    if (v !== null && !(Number.isFinite(v) && v > 0)) throw new ErroApi(422, "INVALIDO", "Valor inválido.");
    const c = await gerarCobrancaManual(txt(f, "processo_id"), fase, u, { valor: v });
    return `Cobrança ${c.numero} gerada.`;
  });
}
