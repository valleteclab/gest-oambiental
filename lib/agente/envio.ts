import "server-only";
import type { AutorMensagem, Conversa } from "@prisma/client";
import { prisma } from "../db";
import { decifrar } from "../crypto";
import { comRitmo, envioSimulado, provedor } from "../canais";
import { textoComBotoes, type CanalRuntime } from "../canais/tipos";
import type { Resposta } from "./textos";
import { foraDaJanela } from "./janela";

// Despacho das respostas pelo canal da conversa: grava a mensagem OUT (auditável) e envia pelo provedor.
// Regras: janela de 24 h na API oficial (Chatwoot) → não envia e registra "requer template aprovado";
// CANAIS_ENVIO_SIMULADO=true → não chama o provedor (status SIMULADA); provedores não oficiais → ritmo 3–8 s.


export async function enviarRespostas(
  canal: CanalRuntime,
  conversa: Pick<Conversa, "id" | "destino_cifrado" | "ultima_msg_cidadao_em" | "dados_coletados">,
  respostas: Resposta[],
  autor: AutorMensagem,
  usuarioId: string | null = null,
) {
  const lista = respostas.filter((r) => r.texto.trim());
  if (!lista.length) return [];
  const prov = provedor(canal.tipo);
  const destino = decifrar(conversa.destino_cifrado) ?? "";
  // E-mail: uma única mensagem por rodada (botões viram opções numeradas)
  const itens: Resposta[] = canal.tipo === "EMAIL" ? [{ texto: lista.map((r) => (r.botoes?.length ? textoComBotoes(r.texto, r.botoes) : r.texto)).join("\n\n") }] : lista;
  const dados = (conversa.dados_coletados ?? {}) as { assunto_email?: string | null };
  const gravadas = [];
  for (const r of itens) {
    const msg = await prisma.mensagemConversa.create({
      data: {
        conversa_id: conversa.id, canal_id: canal.id, direcao: "OUT", autor, autor_usuario_id: usuarioId, tipo: "TEXTO",
        texto: r.texto, botoes: r.botoes?.length ? r.botoes : undefined, status_envio: "PENDENTE",
      },
    });
    let status = "ENVIADA";
    let erro: string | null = null;
    let providerId: string | null = null;
    if (canal.tipo === "WEBCHAT") status = "ENVIADA";
    else if (prov.oficial(canal) && foraDaJanela(conversa.ultima_msg_cidadao_em)) {
      status = "IGNORADA";
      erro = "Fora da janela de 24 h da API oficial do WhatsApp: requer template aprovado.";
      console.warn(`[agente] conversa ${conversa.id}: ${erro}`);
    } else if (envioSimulado() && canal.tipo !== "EMAIL") {
      // (e-mail sempre passa por lib/email: sem SMTP ele só grava na caixa de teste /admin/emails)
      status = "SIMULADA";
      console.log(`[agente][simulado] ${canal.tipo} → conversa ${conversa.id}: ${r.texto.slice(0, 200).replace(/\n/g, " ⏎ ")}`);
    } else {
      try {
        const res = await comRitmo(canal, async () => {
          await prov.setTyping?.(canal, destino).catch(() => {});
          if (r.botoes?.length && prov.sendButtons) {
            try {
              return await prov.sendButtons(canal, destino, r.texto, r.botoes);
            } catch {
              /* sem suporte a botões → texto numerado */
            }
          }
          const texto = r.botoes?.length ? textoComBotoes(r.texto, r.botoes) : r.texto;
          return prov.sendText(canal, destino, texto, { assunto: dados.assunto_email ?? null, referencia: conversa.id.slice(0, 8) });
        });
        providerId = res.providerMessageId ?? null;
      } catch (e) {
        status = "ERRO";
        erro = (e as Error).message?.slice(0, 500) ?? "Erro no envio.";
        console.error(`[agente] envio ${canal.tipo} conversa ${conversa.id}:`, erro);
      }
    }
    try {
      gravadas.push(await prisma.mensagemConversa.update({ where: { id: msg.id }, data: { status_envio: status, erro, provider_message_id: providerId } }));
    } catch {
      // id do provedor já registrado (eco processado antes): mantém sem o id
      gravadas.push(await prisma.mensagemConversa.update({ where: { id: msg.id }, data: { status_envio: status, erro } }));
    }
  }
  await prisma.conversa.update({ where: { id: conversa.id }, data: { ultima_msg_em: new Date() } });
  return gravadas;
}
