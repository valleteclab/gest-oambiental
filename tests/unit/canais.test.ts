import { describe, expect, it } from "vitest";
import { normalizarEvolution } from "@/lib/canais/evolution";
import { normalizarZapi } from "@/lib/canais/zapi";
import { MARCA_IA, normalizarChatwoot } from "@/lib/canais/chatwoot";
import { assuntoBase, normalizarEmail, referenciaDoAssunto, removerCitacao } from "@/lib/canais/email";
import { formatarTelefone, mascararTelefone, normalizarTelefone, variantesTelefone } from "@/lib/canais/telefone";
import { hashChat, hashContato, iguaisSeguro } from "@/lib/canais/contato";
import { textoComBotoes } from "@/lib/canais/tipos";

const canal = { id: "c1", config: {} as Record<string, string>, segredos: {} as Record<string, string> };

describe("telefone", () => {
  it("normaliza formatos brasileiros para E.164 canônico (com 9º dígito)", () => {
    expect(normalizarTelefone("+55 (75) 99999-8888")).toBe("5575999998888");
    expect(normalizarTelefone("(75) 99999-8888")).toBe("5575999998888");
    expect(normalizarTelefone("075999998888")).toBe("5575999998888");
    expect(normalizarTelefone("0 21 75 99999-8888")).toBe("5575999998888"); // operadora
    expect(normalizarTelefone("5575999998888@s.whatsapp.net")).toBe("5575999998888");
    expect(normalizarTelefone("557599998888@s.whatsapp.net")).toBe("5575999998888"); // JID antigo sem o 9
    expect(normalizarTelefone("7532211234")).toBe("557532211234"); // fixo mantém 8 dígitos
  });
  it("rejeita lixo e DDD inexistente", () => {
    expect(normalizarTelefone("abc")).toBeNull();
    expect(normalizarTelefone("5520999998888")).toBeNull();
    expect(normalizarTelefone("")).toBeNull();
    expect(normalizarTelefone("123")).toBeNull();
  });
  it("variantes com/sem 9º dígito e máscara", () => {
    expect(variantesTelefone("5575999998888")).toEqual(["5575999998888", "557599998888"]);
    expect(mascararTelefone("5575999998888")).toBe("(75) 9****-8888");
    expect(formatarTelefone("5575999998888")).toBe("(75) 99999-8888");
  });
  it("mesmo cidadão com/sem 9 e formatos diferentes → mesmo hash de contato; e-mail sem diferenciar caixa", () => {
    expect(hashContato("557599998888")).toBe(hashContato("(75) 99999-8888"));
    expect(hashContato("Maria@Exemplo.com ")).toBe(hashContato("maria@exemplo.com"));
    expect(hashContato("maria@exemplo.com")).not.toBe(hashContato("5575999998888"));
    expect(hashContato("xx")).toBeNull();
  });
  it("comparação de segredo em tempo constante", () => {
    expect(iguaisSeguro("abc", "abc")).toBe(true);
    expect(iguaisSeguro("abc", "abd")).toBe(false);
    expect(iguaisSeguro(null, "abc")).toBe(false);
    expect(iguaisSeguro("abc", "abcd")).toBe(false);
  });
});

describe("Evolution API (messages.upsert)", () => {
  const base = (message: object, key: object = {}) => ({ event: "messages.upsert", instance: "lor", data: { key: { remoteJid: "557599998888@s.whatsapp.net", fromMe: false, id: "MSG1", ...key }, pushName: "Zé", messageTimestamp: 1790000000, message } });
  it("texto simples e extendedTextMessage", () => {
    const [e] = normalizarEvolution(base({ conversation: "Olá" }), canal);
    expect(e).toMatchObject({ providerMessageId: "MSG1", chatId: "557599998888@s.whatsapp.net", replyTarget: "557599998888@s.whatsapp.net", kind: "text", text: "Olá", isGroup: false, fromMe: false });
    expect(e.from).toEqual({ phoneE164: "5575999998888", name: "Zé" });
    expect(e.timestamp.getTime()).toBe(1790000000 * 1000);
    expect(normalizarEvolution(base({ extendedTextMessage: { text: "Oi" } }), canal)[0].text).toBe("Oi");
  });
  it("imagem com legenda, áudio, documento e localização", () => {
    const img = normalizarEvolution(base({ imageMessage: { caption: "lixo", mimetype: "image/jpeg" } }), canal)[0];
    expect(img).toMatchObject({ kind: "image", text: "lixo" });
    expect(img.media?.mime).toBe("image/jpeg");
    expect(normalizarEvolution(base({ audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" } }), canal)[0].kind).toBe("audio");
    expect(normalizarEvolution(base({ documentMessage: { fileName: "a.pdf", mimetype: "application/pdf" } }), canal)[0]).toMatchObject({ kind: "document" });
    const loc = normalizarEvolution(base({ locationMessage: { degreesLatitude: -12.1, degreesLongitude: -40.2, name: "Ponte", address: "Estrada" } }), canal)[0];
    expect(loc).toMatchObject({ kind: "location", location: { lat: -12.1, lng: -40.2, endereco: "Ponte – Estrada" } });
  });
  it("@lid usa remoteJidAlt/senderPn como telefone; grupo é marcado; fromMe", () => {
    const lid = normalizarEvolution(base({ conversation: "x" }, { remoteJid: "123456789@lid", remoteJidAlt: "5575988887777@s.whatsapp.net" }), canal)[0];
    expect(lid.from.phoneE164).toBe("5575988887777");
    expect(lid.replyTarget).toBe("123456789@lid");
    const semAlt = normalizarEvolution(base({ conversation: "x" }, { remoteJid: "123456789@lid" }), canal)[0];
    expect(semAlt.from.phoneE164).toBeNull();
    expect(normalizarEvolution(base({ conversation: "x" }, { remoteJid: "1203@g.us" }), canal)[0].isGroup).toBe(true);
    const eu = normalizarEvolution(base({ conversation: "resposta do atendente" }, { fromMe: true }), canal)[0];
    expect(eu).toMatchObject({ fromMe: true, sentByApi: false });
    expect(eu.from.name).toBeNull();
  });
  it("resposta de botão e eventos que não são mensagem", () => {
    expect(normalizarEvolution(base({ buttonsResponseMessage: { selectedButtonId: "lgpd_sim", selectedDisplayText: "Sim" } }), canal)[0]).toMatchObject({ kind: "button", buttonId: "lgpd_sim", text: "Sim" });
    expect(normalizarEvolution({ event: "connection.update", data: { state: "open" } }, canal)).toEqual([]);
    expect(normalizarEvolution({ event: "MESSAGES_UPSERT", data: [{ key: { remoteJid: "5575999998888@s.whatsapp.net", id: "A" }, message: { conversation: "a" } }, { key: { remoteJid: "5575999998888@s.whatsapp.net", id: "B" }, message: { conversation: "b" } }] }, canal).map((e) => e.providerMessageId)).toEqual(["A", "B"]);
  });
});

describe("Z-API (ReceivedCallback)", () => {
  const base = (x: object) => ({ type: "ReceivedCallback", instanceId: "I", messageId: "Z1", phone: "5575999998888", senderName: "Ana", fromMe: false, fromApi: false, isGroup: false, momment: 1790000000000, ...x });
  it("texto, imagem, localização e botão", () => {
    expect(normalizarZapi(base({ text: { message: "oi" } }), canal)[0]).toMatchObject({ kind: "text", text: "oi", chatId: "5575999998888", from: { phoneE164: "5575999998888", name: "Ana" } });
    const img = normalizarZapi(base({ image: { imageUrl: "https://x/y.jpg", caption: "foto" } }), canal)[0];
    expect(img).toMatchObject({ kind: "image", text: "foto" });
    expect(typeof img.media?.fetch).toBe("function");
    expect(normalizarZapi(base({ location: { latitude: -12, longitude: -40, address: "Rua A" } }), canal)[0]).toMatchObject({ kind: "location", location: { lat: -12, lng: -40, endereco: "Rua A" } });
    expect(normalizarZapi(base({ buttonsResponseMessage: { buttonId: "confirmar", message: "Sim, registrar" } }), canal)[0]).toMatchObject({ kind: "button", buttonId: "confirmar" });
  });
  it("fromApi marca eco da API; fromMe sem fromApi = atendente; grupo; outros callbacks ignorados", () => {
    expect(normalizarZapi(base({ fromMe: true, fromApi: true, text: { message: "x" } }), canal)[0]).toMatchObject({ fromMe: true, sentByApi: true });
    expect(normalizarZapi(base({ fromMe: true, fromApi: false, text: { message: "x" } }), canal)[0]).toMatchObject({ fromMe: true, sentByApi: false });
    expect(normalizarZapi(base({ isGroup: true, phone: "1203-group", text: { message: "x" } }), canal)[0].isGroup).toBe(true);
    expect(normalizarZapi({ type: "MessageStatusCallback", messageId: "Z1", phone: "55" }, canal)).toEqual([]);
  });
});

describe("Chatwoot (message_created)", () => {
  const base = (x: object) => ({ event: "message_created", message_type: "incoming", id: 77, content: "Olá", private: false, sender: { name: "João", phone_number: "+5575999998888" }, conversation: { id: 12, inbox_id: 3, meta: { sender: { phone_number: "+5575999998888" } } }, attachments: [], ...x });
  it("entrada do cidadão com telefone e conversa como destino", () => {
    const [e] = normalizarChatwoot(base({}), { ...canal, config: { inbox_id: "3" } });
    expect(e).toMatchObject({ providerMessageId: "77", chatId: "12", replyTarget: "12", kind: "text", text: "Olá", fromMe: false, from: { phoneE164: "5575999998888", name: "João" } });
  });
  it("saída sem a marca da IA = atendente humano; com a marca = eco da API; nota privada e outra caixa ignoradas", () => {
    expect(normalizarChatwoot(base({ message_type: "outgoing", content: "Sou o fiscal" }), canal)[0]).toMatchObject({ fromMe: true, sentByApi: false, text: "Sou o fiscal" });
    expect(normalizarChatwoot(base({ message_type: "outgoing", content: `${MARCA_IA}Olá!` }), canal)[0]).toMatchObject({ fromMe: true, sentByApi: true, text: "Olá!" });
    expect(normalizarChatwoot(base({ private: true }), canal)).toEqual([]);
    expect(normalizarChatwoot(base({}), { ...canal, config: { inbox_id: "9" } })).toEqual([]);
    expect(normalizarChatwoot({ event: "conversation_status_changed" }, canal)).toEqual([]);
  });
  it("anexos: imagem e localização", () => {
    expect(normalizarChatwoot(base({ content: null, attachments: [{ file_type: "image", data_url: "https://c/f.jpg" }] }), canal)[0]).toMatchObject({ kind: "image" });
    expect(normalizarChatwoot(base({ content: null, attachments: [{ file_type: "location", coordinates_lat: -12.5, coordinates_long: -40.1, fallback_title: "Praça" }] }), canal)[0]).toMatchObject({ kind: "location", location: { lat: -12.5, lng: -40.1, endereco: "Praça" } });
  });
});

describe("E-mail (Postmark / SendGrid)", () => {
  const pm = { From: "Maria <Maria@Exemplo.com>", FromFull: { Email: "Maria@Exemplo.com", Name: "Maria" }, Subject: "Denúncia de esgoto", MessageID: "pm-1", TextBody: "Tem esgoto na rua.\n\nEm seg., Fulano escreveu:\n> texto antigo", Attachments: [{ Name: "a.jpg", Content: Buffer.from("x").toString("base64"), ContentType: "image/jpeg" }] };
  it("Postmark: remetente, texto sem citação, anexos como eventos separados, conversa por remetente+assunto", async () => {
    const ev = normalizarEmail(pm, canal);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ providerMessageId: "pm-1", kind: "text", text: "Tem esgoto na rua.", replyTarget: "maria@exemplo.com", chatId: "maria@exemplo.com|denúncia de esgoto" });
    expect(ev[1]).toMatchObject({ providerMessageId: "pm-1#1", kind: "image" });
    expect((await ev[1].media!.fetch()).dados.toString()).toBe("x");
    // resposta "Re: … [Atendimento #…]" cai na MESMA conversa do e-mail original
    const re = normalizarEmail({ ...pm, Subject: "Re: Denúncia de esgoto [Atendimento #ab12cd34]", MessageID: "pm-2", Attachments: [] }, canal);
    expect(re[0].chatId).toBe(ev[0].chatId);
    expect(re[0].extra?.referencia).toBe("ab12cd34");
    expect(normalizarEmail({ ...pm, Subject: "RES: Denúncia de esgoto", MessageID: "pm-3", Attachments: [] }, canal)[0].chatId).toBe(ev[0].chatId);
  });
  it("StrippedTextReply tem prioridade; sem remetente → nada", () => {
    expect(normalizarEmail({ ...pm, StrippedTextReply: "Só isso", Attachments: [] }, canal)[0].text).toBe("Só isso");
    expect(normalizarEmail({ Subject: "x" }, canal)).toEqual([]);
  });
  it("SendGrid convertido pela rota (multipart → JSON)", () => {
    const ev = normalizarEmail({ formato: "sendgrid", campos: { from: "José <jose@x.com.br>", subject: "Lixo", text: "Lixo na praça", headers: "Message-ID: <sg-1@x>\nX: y" }, anexos: [] }, canal);
    expect(ev[0]).toMatchObject({ providerMessageId: "<sg-1@x>", text: "Lixo na praça", from: { email: "jose@x.com.br", name: "José" } });
  });
  it("helpers de assunto e citação", () => {
    expect(assuntoBase("Re: RES: Fwd: Lixo [Atendimento #abcdef12]")).toBe("Lixo");
    expect(referenciaDoAssunto("Re: x [Atendimento #ABCDEF12]")).toBe("abcdef12");
    expect(removerCitacao("oi\n> velho\nOn Mon, X wrote:\nmais")).toBe("oi");
  });
});

describe("dedup / idempotência", () => {
  it("o mesmo payload gera o mesmo id do provedor e o mesmo chat (UNIQUE canal+provider_message_id)", () => {
    const p = { event: "messages.upsert", data: { key: { remoteJid: "5575999998888@s.whatsapp.net", id: "DUP1" }, message: { conversation: "a" } } };
    const a = normalizarEvolution(p, canal)[0];
    const b = normalizarEvolution(JSON.parse(JSON.stringify(p)), canal)[0];
    expect(a.providerMessageId).toBe(b.providerMessageId);
    expect(hashChat("c1", a.chatId)).toBe(hashChat("c1", b.chatId));
    expect(hashChat("c1", a.chatId)).not.toBe(hashChat("c2", a.chatId));
  });
  it("botões viram texto numerado no fallback", () => {
    expect(textoComBotoes("Confirma?", [{ id: "s", rotulo: "Sim" }, { id: "n", rotulo: "Não" }])).toBe("Confirma?\n\n1️⃣ Sim\n2️⃣ Não");
  });
});
