import { describe, expect, it, beforeAll } from "vitest";
import type { UsuarioSessao } from "@/lib/rbac";
import {
  dimensoesReduzidas, lerMoeda, manterOriginal, origemFiscalizacao, podeEmitirFiscalizacao, podeRegistrarVistoria, podeTransicionarDenuncia,
  prazoAteNotificacao, tipoImagem, LIMITE_FOTO,
} from "@/lib/fiscalizacao/regras";
import { AutoInfracaoSchema, DenunciaPublicaSchema, FiscalizacaoSchema, NotificacaoSchema, PessoaRapidaSchema } from "@/lib/fiscalizacao/schemas";
import { excedeuLimite } from "@/lib/fiscalizacao/antiabuso";

const MUN_A = "11111111-1111-4111-8111-111111111111";
const MUN_B = "22222222-2222-4222-8222-222222222222";
const usuario = (papel: UsuarioSessao["papeis"][number]["papel"], municipio_id: string | null = MUN_A): UsuarioSessao => ({ id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id: null, trocar_senha: false, papeis: [{ papel, municipio_id }] });

beforeAll(() => {
  process.env.DATA_KEY ??= "0".repeat(64);
});

describe("permissões da fiscalização", () => {
  it("fiscal registra e emite só no próprio município", () => {
    const f = usuario("FISCAL");
    expect(podeRegistrarVistoria(f, MUN_A)).toBe(true);
    expect(podeRegistrarVistoria(f, MUN_B)).toBe(false);
    expect(podeEmitirFiscalizacao(f, MUN_A)).toBe(true);
  });
  it("gestor emite mas não registra vistoria", () => {
    const g = usuario("GESTOR_MUNICIPAL");
    expect(podeRegistrarVistoria(g, MUN_A)).toBe(false);
    expect(podeEmitirFiscalizacao(g, MUN_A)).toBe(true);
  });
  it("SEMA_INEMA é somente leitura", () => {
    const s = usuario("SEMA_INEMA", null);
    expect(podeRegistrarVistoria(s, MUN_A)).toBe(false);
    expect(podeEmitirFiscalizacao(s, MUN_A)).toBe(false);
  });
  it("técnico do consórcio e admin atuam em todos os municípios", () => {
    expect(podeRegistrarVistoria(usuario("TEC_CONSORCIO", null), MUN_B)).toBe(true);
    expect(podeEmitirFiscalizacao(usuario("ADMIN", null), MUN_B)).toBe(true);
  });
  it("requerente não fiscaliza", () => {
    expect(podeRegistrarVistoria(usuario("REQUERENTE", null))).toBe(false);
  });
});

describe("regras", () => {
  it("origem conforme vínculo", () => {
    expect(origemFiscalizacao({ denuncia_id: "x", processo_id: "y" })).toBe("DENUNCIA");
    expect(origemFiscalizacao({ processo_id: "y" })).toBe("PROCESSO");
    expect(origemFiscalizacao({})).toBe("ROTINA");
  });
  it("transições de denúncia", () => {
    expect(podeTransicionarDenuncia("NOVA", "EM_APURACAO")).toBe(true);
    expect(podeTransicionarDenuncia("NOVA", "CONCLUIDA")).toBe(false);
    expect(podeTransicionarDenuncia("EM_APURACAO", "CONCLUIDA")).toBe(true);
    expect(podeTransicionarDenuncia("ARQUIVADA", "EM_APURACAO")).toBe(true);
  });
  it("prazo da notificação em dias corridos até o fim do dia", () => {
    const d = prazoAteNotificacao(10, new Date(2026, 8, 27, 10, 0));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 7, 23]);
  });
  it("redimensiona mantendo proporção", () => {
    expect(dimensoesReduzidas(4000, 3000, 2000)).toEqual({ largura: 2000, altura: 1500 });
    expect(dimensoesReduzidas(1000, 800, 2000)).toEqual({ largura: 1000, altura: 800 });
  });
  it("mantém original pequeno (preserva EXIF) e recomprime grande/HEIC", () => {
    expect(manterOriginal("image/jpeg", 500_000)).toBe(true);
    expect(manterOriginal("image/jpeg", LIMITE_FOTO + 1)).toBe(false);
    expect(manterOriginal("image/heic", 500_000)).toBe(false);
  });
  it("detecta imagem pelos bytes mágicos", () => {
    expect(tipoImagem(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(tipoImagem(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(tipoImagem(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });
  it("lê valores monetários pt-BR", () => {
    expect(lerMoeda("1.234,56")).toBe(1234.56);
    expect(lerMoeda("R$ 5.000")).toBe(5000);
    expect(lerMoeda("250.5")).toBe(250.5);
    expect(lerMoeda("")).toBeNull();
  });
  it("limite por IP", () => {
    const t = 1_000_000;
    for (let i = 0; i < 5; i++) expect(excedeuLimite("teste-ip", 5, 60000, t + i)).toBe(false);
    expect(excedeuLimite("teste-ip", 5, 60000, t + 10)).toBe(true);
    expect(excedeuLimite("teste-ip", 5, 60000, t + 70000)).toBe(false);
  });
});

describe("schemas", () => {
  const base = { municipio_id: MUN_A, descricao: "Descarte de entulho às margens do rio há semanas", endereco: "Estrada do Rio, km 2" };
  it("denúncia pública válida (anônima)", () => {
    expect(DenunciaPublicaSchema.safeParse({ ...base, anonima: true }).success).toBe(true);
  });
  it("honeypot preenchido é rejeitado", () => {
    expect(DenunciaPublicaSchema.safeParse({ ...base, website: "spam" }).success).toBe(false);
  });
  it("denúncia identificada exige nome; descrição tem limites", () => {
    expect(DenunciaPublicaSchema.safeParse({ ...base, anonima: false }).success).toBe(false);
    expect(DenunciaPublicaSchema.safeParse({ ...base, descricao: "curta" }).success).toBe(false);
    expect(DenunciaPublicaSchema.safeParse({ ...base, descricao: "x".repeat(5001) }).success).toBe(false);
    expect(DenunciaPublicaSchema.safeParse({ ...base, latitude: -12.5 }).success).toBe(false);
  });
  it("vistoria exige coordenadas, relato e constatação", () => {
    const v = { data_hora: new Date().toISOString(), latitude: -12.52, longitude: -40.3, relato: "Constatado depósito irregular de resíduos.", constatacao: "IRREGULAR" };
    expect(FiscalizacaoSchema.safeParse(v).success).toBe(true);
    expect(FiscalizacaoSchema.safeParse({ ...v, latitude: 120 }).success).toBe(false);
    expect(FiscalizacaoSchema.safeParse({ ...v, constatacao: "X" }).success).toBe(false);
    expect(FiscalizacaoSchema.safeParse({ ...v, data_hora: new Date(Date.now() + 86400000).toISOString() }).success).toBe(false);
  });
  it("pessoa rápida valida CPF/CNPJ e tipo", () => {
    expect(PessoaRapidaSchema.safeParse({ tipo: "PF", cpf_cnpj: "529.982.247-25", nome: "João Silva" }).success).toBe(true);
    expect(PessoaRapidaSchema.safeParse({ tipo: "PF", cpf_cnpj: "529.982.247-24", nome: "João Silva" }).success).toBe(false);
    expect(PessoaRapidaSchema.safeParse({ tipo: "PF", cpf_cnpj: "11.222.333/0001-81", nome: "Empresa" }).success).toBe(false);
    expect(PessoaRapidaSchema.safeParse({ tipo: "PJ", cpf_cnpj: "11.222.333/0001-81", nome: "Empresa Ltda" }).success).toBe(true);
  });
  it("auto: multa exige valor; exige autuado", () => {
    const a = { fiscalizacao_id: MUN_A, autuado: { pessoa_id: MUN_B }, enquadramento_legal: "Art. 60 Lei 9.605/98", descricao_infracao: "Funcionamento sem licença ambiental", penalidade: "MULTA", valor_multa: 5000 };
    expect(AutoInfracaoSchema.safeParse(a).success).toBe(true);
    expect(AutoInfracaoSchema.safeParse({ ...a, valor_multa: null }).success).toBe(false);
    expect(AutoInfracaoSchema.safeParse({ ...a, penalidade: "ADVERTENCIA", valor_multa: null }).success).toBe(true);
    expect(AutoInfracaoSchema.safeParse({ ...a, autuado: {} }).success).toBe(false);
  });
  it("notificação exige vínculo e prazo", () => {
    const n = { fiscalizacao_id: MUN_A, notificado: { pessoa_id: MUN_B }, exigencia: "Apresentar licença de operação", prazo_dias: 30 };
    expect(NotificacaoSchema.safeParse(n).success).toBe(true);
    expect(NotificacaoSchema.safeParse({ ...n, fiscalizacao_id: null }).success).toBe(false);
    expect(NotificacaoSchema.safeParse({ ...n, prazo_dias: 0 }).success).toBe(false);
  });
});
