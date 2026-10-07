// Apoio dos E2E do GED (t18/t20) que precisam do BANCO (não roda como spec): `npx tsx tests/e2e/t20-banco.ts <comando> …`
//   processar            envia as comunicações PENDENTES de todos os clientes (o que o worker `ged-notificar` faria) → {processadas}
//   comunicacoes <doc>   linhas de ged_comunicacao do documento (id da linha) com o e-mail enviado (assunto/corpo) → [{…}]
//   codigo-optin <usuarioId>  código de confirmação do WhatsApp pendente do usuário
//   imutavel             tenta UPDATE em ged_tramite e ged_comentario → mensagens de erro do banco
//   protocolo-comunicacoes <protocoloId>  avisos ao interessado do protocolo (ged_comunicacao) com o e-mail enviado → [{…}]
//   imutavel-protocolo <protocoloId>      tenta alterar/excluir o registro, o andamento e os anexos do protocolo → mensagens do banco
//   codigo-compartilhamento <linkId>   código OTP mais recente do link (só existe com CANAIS_ENVIO_SIMULADO=true: ged_compartilhamento_otp.codigo_teste_cifrado)
//   recuar-otp <linkId>                 "envelhece" 2 min os OTPs do link (vence o intervalo de 60 s entre envios sem esperar)
//   expirar-compartilhamento <linkId>   vence a validade do link (created_at e expira_em no passado)
//   expirar-sessoes <linkId>            vence o teto das sessões abertas do link
//   compartilhamento <linkId>           estado do link (status, downloads, otp_falhas, bloqueado_ate, contagens) – sem token nem telefone
//   eventos-compartilhamento <linkId>   eventos do link [{tipo, ip, user_agent, detalhe}]
//   limpar-bloqueio <linkId>            zera falhas/bloqueio do link
//   emails-para <email>                 assuntos dos e-mails enviados (caixa de teste) a um endereço
//   whatsapp-claro <linkId>             o WhatsApp cifrado/hash do link NÃO contém o número em claro? → {cifrado_ok, hash_ok}
// Última linha da saída: `__JSON__{…}`. Usa a DATABASE_URL do ambiente; "server-only" apontado para o stub do pacote.
import Module from "node:module";
import path from "node:path";

{
  const M = Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string };
  const original = M._resolveFilename;
  M._resolveFilename = function (req: string, ...rest: unknown[]) {
    if (req === "server-only") return path.resolve(__dirname, "../../node_modules/server-only/empty.js");
    return original.call(this, req, ...rest);
  };
}
try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* ambiente */
}

const saida = (o: unknown) => console.log(`__JSON__${JSON.stringify(o)}`);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    if (cmd === "processar") {
      const { processarComunicacao } = await import("../../lib/ged/notificar/enviar");
      const pend = await prisma.gedComunicacao.findMany({ where: { status: "PENDENTE" }, select: { id: true, organizacao_id: true }, orderBy: { created_at: "asc" }, take: 500 });
      const res: Record<string, number> = {};
      for (const p of pend) {
        const r = await processarComunicacao(p.organizacao_id, p.id);
        res[r] = (res[r] ?? 0) + 1;
      }
      saida({ processadas: pend.length, resultado: res });
    } else if (cmd === "comunicacoes") {
      const linhas = await prisma.gedComunicacao.findMany({ where: { documento_id: args[0] }, orderBy: { created_at: "asc" } });
      const out = [];
      for (const l of linhas) {
        const e = l.email_enviado_id ? await prisma.emailEnviado.findUnique({ where: { id: l.email_enviado_id } }) : null;
        out.push({ id: l.id, evento: l.evento, canal: l.canal, status: l.status, usuario_id: l.usuario_id, enviado_em: l.enviado_em, destinatario_mascarado: l.destinatario_mascarado, assunto: l.assunto, erro: l.erro, email: e && { para: e.para, assunto: e.assunto, corpo: e.corpo } });
      }
      saida(out);
    } else if (cmd === "protocolo-comunicacoes") {
      const linhas = await prisma.gedComunicacao.findMany({ where: { protocolo_id: args[0] }, orderBy: { created_at: "asc" } });
      const out = [];
      for (const l of linhas) {
        const e = l.email_enviado_id ? await prisma.emailEnviado.findUnique({ where: { id: l.email_enviado_id } }) : null;
        out.push({ id: l.id, evento: l.evento, canal: l.canal, status: l.status, enviado_em: l.enviado_em, destinatario_mascarado: l.destinatario_mascarado, assunto: l.assunto, erro: l.erro, email: e && { para: e.para, assunto: e.assunto, corpo: e.corpo } });
      }
      saida(out);
    } else if (cmd === "imutavel-protocolo") {
      const id = args[0];
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("id inválido");
      const tenta = async (sql: string) => {
        try {
          await prisma.$executeRawUnsafe(sql);
          return null;
        } catch (e) {
          return (e as Error).message.replace(/\s+/g, " ").slice(0, 220);
        }
      };
      saida({
        assunto: await tenta(`UPDATE ged_protocolo SET assunto = 'adulterado' WHERE id = '${id}'`),
        numero: await tenta(`UPDATE ged_protocolo SET numero = 'PROT-ENT-1999-000001' WHERE id = '${id}'`),
        data: await tenta(`UPDATE ged_protocolo SET created_at = now() - interval '5 years' WHERE id = '${id}'`),
        codigo: await tenta(`UPDATE ged_protocolo SET codigo_consulta = 'AAAA-BBBB-CCCC' WHERE id = '${id}'`),
        interessado: await tenta(`UPDATE ged_protocolo SET interessado_nome_cifrado = 'v1:x:y:z' WHERE id = '${id}'`),
        exclusao: await tenta(`DELETE FROM ged_protocolo WHERE id = '${id}'`),
        comprovante: await tenta(`UPDATE ged_protocolo SET comprovante_sha256 = '${"0".repeat(64)}' WHERE id = '${id}'`),
        evento_update: await tenta(`UPDATE ged_protocolo_evento SET texto = 'adulterado' WHERE protocolo_id = '${id}'`),
        evento_delete: await tenta(`DELETE FROM ged_protocolo_evento WHERE protocolo_id = '${id}'`),
        anexo_update: await tenta(`UPDATE ged_protocolo_documento SET sha256 = '${"0".repeat(64)}' WHERE protocolo_id = '${id}'`),
        anexo_delete: await tenta(`DELETE FROM ged_protocolo_documento WHERE protocolo_id = '${id}'`),
        // mudar a situação é permitido (é o andamento): UPDATE sem alteração de valor
        situacao_permitida: await tenta(`UPDATE ged_protocolo SET situacao = situacao WHERE id = '${id}'`),
      });
    } else if (cmd === "codigo-optin") {
      // Código de 6 dígitos do opt-in do WhatsApp: é derivado (HMAC) do estado pendente guardado cifrado – não há outra forma de lê-lo em modo simulado.
      const { decifrar } = await import("../../lib/crypto");
      const { chaveOptinDoServidor, codigoOptin, lerPendente } = await import("../../lib/ged/notificar/regras");
      const m = await prisma.gedMembro.findFirst({ where: { usuario_id: args[0] } });
      const pend = m ? lerPendente(decifrar(m.telefone_cifrado)) : null;
      saida({ codigo: m && pend ? codigoOptin(chaveOptinDoServidor(), pend.cid, args[0], pend.tel) : null });
    } else if (cmd === "codigo-compartilhamento") {
      const { decifrar } = await import("../../lib/crypto");
      const o = await prisma.gedCompartilhamentoOtp.findFirst({ where: { compartilhamento_id: args[0], usado_em: null, invalidado_em: null }, orderBy: { created_at: "desc" } });
      saida({ codigo: o?.codigo_teste_cifrado ? decifrar(o.codigo_teste_cifrado) : null, tem_hash: !!o?.codigo_hash });
    } else if (cmd === "recuar-otp") {
      const r = await prisma.$executeRawUnsafe("UPDATE ged_compartilhamento_otp SET created_at = created_at - interval '2 minutes' WHERE compartilhamento_id = $1::uuid", args[0]);
      saida({ atualizados: r });
    } else if (cmd === "expirar-compartilhamento") {
      const r = await prisma.$executeRawUnsafe("UPDATE ged_compartilhamento SET created_at = now() - interval '3 days', expira_em = now() - interval '1 minute' WHERE id = $1::uuid", args[0]);
      saida({ atualizados: r });
    } else if (cmd === "expirar-sessoes") {
      const r = await prisma.$executeRawUnsafe("UPDATE ged_compartilhamento_sessao SET teto_em = now() - interval '1 minute', expira_em = now() - interval '1 minute' WHERE compartilhamento_id = $1::uuid", args[0]);
      saida({ atualizados: r });
    } else if (cmd === "limpar-bloqueio") {
      await prisma.gedCompartilhamento.update({ where: { id: args[0] }, data: { otp_falhas: 0, bloqueado_ate: null } });
      saida({ ok: true });
    } else if (cmd === "compartilhamento") {
      const l = await prisma.gedCompartilhamento.findUnique({ where: { id: args[0] } });
      const [otps, sessoes, eventos] = await Promise.all([
        prisma.gedCompartilhamentoOtp.count({ where: { compartilhamento_id: args[0] } }),
        prisma.gedCompartilhamentoSessao.count({ where: { compartilhamento_id: args[0], encerrada_em: null } }),
        prisma.gedCompartilhamentoEvento.count({ where: { compartilhamento_id: args[0] } }),
      ]);
      saida(l && { status: l.status, downloads: l.downloads, otp_falhas: l.otp_falhas, bloqueado_ate: l.bloqueado_ate, primeiro_acesso_em: l.primeiro_acesso_em, token_hash_len: l.token_hash.length, otps, sessoes_abertas: sessoes, eventos });
    } else if (cmd === "eventos-compartilhamento") {
      saida((await prisma.gedCompartilhamentoEvento.findMany({ where: { compartilhamento_id: args[0] }, orderBy: { created_at: "asc" }, select: { tipo: true, ip: true, user_agent: true, detalhe: true, documento_id: true } })));
    } else if (cmd === "emails-para") {
      saida((await prisma.emailEnviado.findMany({ where: { para: args[0] }, orderBy: { created_at: "desc" }, take: 20, select: { assunto: true, corpo: true } })));
    } else if (cmd === "whatsapp-claro") {
      const l = await prisma.gedCompartilhamento.findUnique({ where: { id: args[0] } });
      const { decifrar } = await import("../../lib/crypto");
      const tel = l ? decifrar(l.destinatario_whatsapp_cifrado) : null;
      saida({ cifrado_ok: !!l && !!tel && !l.destinatario_whatsapp_cifrado.includes(tel), hash_ok: !!l && !!tel && !l.destinatario_whatsapp_hash.includes(tel), mascarado_ok: !!l && !!tel && !l.destinatario_mascarado.includes(tel.slice(2, 9)) });
    } else if (cmd === "imutavel") {
      const tenta = async (sql: string) => {
        try {
          await prisma.$executeRawUnsafe(sql);
          return null;
        } catch (e) {
          return (e as Error).message.replace(/\s+/g, " ").slice(0, 200);
        }
      };
      saida({
        tramite: await tenta("UPDATE ged_tramite SET despacho = 'adulterado' WHERE id = (SELECT id FROM ged_tramite LIMIT 1)"),
        comentario: await tenta("UPDATE ged_comentario SET texto = 'adulterado' WHERE id = (SELECT id FROM ged_comentario LIMIT 1)"),
      });
    } else throw new Error(`comando desconhecido: ${cmd}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
