import { describe, expect, it } from "vitest";
import type { Papel } from "@prisma/client";
import {
  calcularTaxa,
  chaveSandbox,
  dataPagamento,
  decidirTransicao,
  ehSimulada,
  faseDoProtocolo,
  faseGeradaPor,
  fasesQueBloqueiam,
  formaDoAsaas,
  lerEventoAsaas,
  mascararChave,
  mensagemBloqueio,
  pixSimulado,
  resumoTaxas,
  statusDoAsaas,
  statusDoEvento,
  venceu,
  type LinhaTaxa,
} from "@/lib/cobranca/regras";
import { can, type UsuarioSessao } from "@/lib/rbac";

// Cobrança de taxas (lib/cobranca/regras.ts – docs/cobranca.md): regras puras.

const MUN = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";
const LO = "33333333-3333-4333-8333-333333333333";
const LP = "44444444-4444-4444-8444-444444444444";

let seq = 0;
const linha = (p: Partial<LinhaTaxa> & { valor: number }): LinhaTaxa => ({ id: `l${++seq}`, municipio_id: null, tipo_ato_id: null, fase: "ANALISE", porte: null, potencial: null, ativo: true, ...p });
const proc = { municipio_id: MUN, tipo_ato_id: LO, porte: "PEQUENO" as const, potencial: "MEDIO" as const };

describe("calcularTaxa – a linha mais específica vence", () => {
  const org = linha({ valor: 100 });
  const orgPorte = linha({ valor: 350, porte: "PEQUENO" });
  const orgTipo = linha({ valor: 500, tipo_ato_id: LO });
  const orgTipoPorte = linha({ valor: 600, tipo_ato_id: LO, porte: "PEQUENO" });
  const mun = linha({ valor: 80, municipio_id: MUN });
  const outroMun = linha({ valor: 1, municipio_id: OUTRO, tipo_ato_id: LO, porte: "PEQUENO", potencial: "MEDIO" });

  it("sem linhas aplicáveis → null", () => {
    expect(calcularTaxa([], proc, "ANALISE")).toBeNull();
    expect(calcularTaxa([linha({ valor: 10, fase: "VISTORIA" })], proc, "ANALISE")).toBeNull();
    expect(calcularTaxa([linha({ valor: 10, porte: "GRANDE" })], proc, "ANALISE")).toBeNull();
    expect(calcularTaxa([linha({ valor: 10, tipo_ato_id: LP })], proc, "ANALISE")).toBeNull();
  });
  it("porte definido > nulo", () => expect(calcularTaxa([org, orgPorte], proc, "ANALISE")?.valor).toBe(350));
  it("tipo de ato definido > porte definido", () => expect(calcularTaxa([orgPorte, orgTipo], proc, "ANALISE")?.valor).toBe(500));
  it("tipo + porte > só tipo", () => expect(calcularTaxa([orgTipo, orgTipoPorte, orgPorte], proc, "ANALISE")?.valor).toBe(600));
  it("município > organização (mesmo menos específica nas demais colunas)", () => expect(calcularTaxa([org, orgPorte, orgTipoPorte, mun], proc, "ANALISE")?.valor).toBe(80));
  it("linha de outro município nunca se aplica", () => expect(calcularTaxa([outroMun, org], proc, "ANALISE")?.valor).toBe(100));
  it("potencial conta como porte (definido > nulo)", () => {
    const pot = linha({ valor: 700, tipo_ato_id: LO, potencial: "MEDIO" });
    const ambos = linha({ valor: 900, tipo_ato_id: LO, porte: "PEQUENO", potencial: "MEDIO" });
    expect(calcularTaxa([orgTipo, pot], proc, "ANALISE")?.valor).toBe(700);
    expect(calcularTaxa([pot, ambos, orgTipoPorte], proc, "ANALISE")?.valor).toBe(900);
  });
  it("inativa ou valor zero é ignorada", () => {
    expect(calcularTaxa([linha({ valor: 999, porte: "PEQUENO", ativo: false }), org], proc, "ANALISE")?.valor).toBe(100);
    expect(calcularTaxa([linha({ valor: 0, porte: "PEQUENO" }), org], proc, "ANALISE")?.valor).toBe(100);
  });
  it("empate → a mais recente", () => {
    const velha = linha({ valor: 1, porte: "PEQUENO", created_at: new Date("2026-01-01") });
    const nova = linha({ valor: 2, porte: "PEQUENO", created_at: new Date("2026-06-01") });
    expect(calcularTaxa([velha, nova], proc, "ANALISE")?.valor).toBe(2);
  });
  it("processo sem porte só casa com linhas de porte nulo", () => expect(calcularTaxa([orgPorte, org], { ...proc, porte: null }, "ANALISE")?.valor).toBe(100));
});

describe("fluxo do processo", () => {
  it("protocolo: UNICA tem precedência sobre ANALISE", () => {
    const linhas = [linha({ valor: 350 }), linha({ valor: 90, fase: "UNICA", tipo_ato_id: LO })];
    expect(faseDoProtocolo(linhas, proc)?.fase).toBe("UNICA");
    expect(faseDoProtocolo([linha({ valor: 350 })], proc)?.fase).toBe("ANALISE");
    expect(faseDoProtocolo([linha({ valor: 90, fase: "VISTORIA" })], proc)).toBeNull();
  });
  it("gatilhos de geração", () => {
    expect(faseGeradaPor("protocolar")).toBe("PROTOCOLO");
    expect(faseGeradaPor("agendar_vistoria")).toBe("VISTORIA");
    expect(faseGeradaPor("agendar_vistoria", { demandaUrbana: true })).toBeNull();
    expect(faseGeradaPor("deferir")).toBe("EMISSAO");
    expect(faseGeradaPor("deferir", { temUnica: true })).toBeNull();
    expect(faseGeradaPor("indeferir")).toBeNull();
    expect(faseGeradaPor("parecer")).toBeNull();
  });
  it("bloqueios: aceite (análise/única), conclusão da vistoria, emissão", () => {
    expect(fasesQueBloqueiam("aceitar")).toEqual(["UNICA", "ANALISE"]);
    expect(fasesQueBloqueiam("concluir_vistoria")).toEqual(["VISTORIA"]);
    expect(fasesQueBloqueiam("emitir_documento")).toEqual(["EMISSAO"]);
    expect(fasesQueBloqueiam("distribuir")).toEqual([]);
    expect(fasesQueBloqueiam("pendencia")).toEqual([]);
    expect(mensagemBloqueio({ fase: "ANALISE", numero: "DAM-LOR-000001/2026", vencimento: new Date() })).toMatch(/^Aguardando pagamento da taxa de análise \(DAM-LOR-000001\/2026\)/);
  });
  it("resumo do processo: valor_taxa soma as não canceladas; taxa_paga só com todas quitadas", () => {
    expect(resumoTaxas([])).toEqual({ valor_taxa: null, taxa_paga: false });
    expect(resumoTaxas([{ status: "PAGA", valor: "350.00" }, { status: "CANCELADA", valor: 100 }])).toEqual({ valor_taxa: 350, taxa_paga: true });
    expect(resumoTaxas([{ status: "PAGA", valor: 350 }, { status: "PENDENTE", valor: 250.1 }])).toEqual({ valor_taxa: 600.1, taxa_paga: false });
    expect(resumoTaxas([{ status: "ISENTA", valor: 350 }, { status: "PAGA", valor: 120 }]).taxa_paga).toBe(true);
    expect(resumoTaxas([{ status: "ESTORNADA", valor: 350 }]).taxa_paga).toBe(false);
  });
  it("vencimento: vence no fim do dia", () => {
    const agora = new Date("2026-09-28T15:00:00Z");
    expect(venceu(new Date("2026-09-28T12:00:00Z"), agora)).toBe(false);
    expect(venceu(new Date("2026-09-27T12:00:00Z"), agora)).toBe(true);
  });
});

describe("Asaas – status, eventos e idempotência", () => {
  it("status do pagamento → status da cobrança", () => {
    expect(statusDoAsaas("RECEIVED")).toBe("PAGA");
    expect(statusDoAsaas("CONFIRMED")).toBe("PAGA");
    expect(statusDoAsaas("RECEIVED_IN_CASH")).toBe("PAGA");
    expect(statusDoAsaas("OVERDUE")).toBe("VENCIDA");
    expect(statusDoAsaas("REFUNDED")).toBe("ESTORNADA");
    expect(statusDoAsaas("PENDING")).toBe("PENDENTE");
    expect(statusDoAsaas("AWAITING_RISK_ANALYSIS")).toBeNull();
    expect(statusDoAsaas("PENDING", true)).toBe("CANCELADA");
  });
  it("evento do webhook → status", () => {
    expect(statusDoEvento("PAYMENT_RECEIVED")).toBe("PAGA");
    expect(statusDoEvento("PAYMENT_CONFIRMED")).toBe("PAGA");
    expect(statusDoEvento("PAYMENT_OVERDUE")).toBe("VENCIDA");
    expect(statusDoEvento("PAYMENT_DELETED")).toBe("CANCELADA");
    expect(statusDoEvento("PAYMENT_REFUNDED")).toBe("ESTORNADA");
    expect(statusDoEvento("PAYMENT_CREATED")).toBeNull();
  });
  it("lê o corpo do webhook", () => {
    const ev = lerEventoAsaas({ id: "evt_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_1", status: "RECEIVED", value: 350, billingType: "PIX", clientPaymentDate: "2026-09-28", externalReference: "x" } });
    expect(ev).toMatchObject({ id: "evt_1", evento: "PAYMENT_RECEIVED", pagamento: { id: "pay_1", value: 350, billingType: "PIX", deleted: false } });
    expect(dataPagamento(ev!.pagamento).toISOString().slice(0, 10)).toBe("2026-09-28");
    expect(formaDoAsaas(ev!.pagamento.billingType)).toBe("PIX");
    expect(formaDoAsaas("UNDEFINED")).toBe("UNDEFINED");
    expect(lerEventoAsaas({ event: "ACCOUNT_STATUS_UPDATED" })).toBeNull();
    expect(lerEventoAsaas({ event: "PAYMENT_RECEIVED", payment: {} })).toBeNull();
    expect(lerEventoAsaas("lixo")).toBeNull();
    expect(lerEventoAsaas(null)).toBeNull();
  });
  it("idempotência: mesmo status não muda nada; pagamento só uma vez", () => {
    expect(decidirTransicao("PENDENTE", "PAGA")).toEqual({ para: "PAGA", pagamento: true });
    expect(decidirTransicao("VENCIDA", "PAGA")).toEqual({ para: "PAGA", pagamento: true });
    expect(decidirTransicao("PAGA", "PAGA")).toBeNull(); // RECEIVED depois de CONFIRMED
    expect(decidirTransicao("PAGA", "VENCIDA")).toBeNull();
    expect(decidirTransicao("PAGA", "CANCELADA")).toBeNull(); // remoção no Asaas após baixa manual
    expect(decidirTransicao("PAGA", "ESTORNADA")).toEqual({ para: "ESTORNADA", pagamento: false });
    expect(decidirTransicao("PENDENTE", "VENCIDA")).toEqual({ para: "VENCIDA", pagamento: false });
    expect(decidirTransicao("VENCIDA", "PENDENTE")).toEqual({ para: "PENDENTE", pagamento: false });
    expect(decidirTransicao("PENDENTE", "CANCELADA")).toEqual({ para: "CANCELADA", pagamento: false });
    expect(decidirTransicao("CANCELADA", "CANCELADA")).toBeNull();
    expect(decidirTransicao("CANCELADA", "VENCIDA")).toBeNull();
    expect(decidirTransicao("CANCELADA", "PAGA")).toEqual({ para: "PAGA", pagamento: true }); // dinheiro entrou mesmo assim
    expect(decidirTransicao("ISENTA", "PAGA")).toBeNull();
    expect(decidirTransicao("PENDENTE", null)).toBeNull();
  });
  it("chave: sandbox pelo prefixo e máscara com os 4 últimos", () => {
    expect(chaveSandbox("$aact_hmlg_000MzkwODA2MWY2OGM3MWRlNTZkMjY5")).toBe(true);
    expect(chaveSandbox("$aact_prod_000MzkwODA2MWY2OGM3MWRlNTZkMjY5")).toBe(false);
    expect(mascararChave("$aact_prod_000abcd1234")).toBe("••••1234");
    expect(mascararChave(null)).toBeNull();
    expect(mascararChave("$aact_prod_000abcd1234")).not.toContain("prod");
  });
  it("homologação: cobrança simulada claramente marcada", () => {
    expect(ehSimulada("sim_abc")).toBe(true);
    expect(ehSimulada("pay_123")).toBe(false);
    expect(ehSimulada(null)).toBe(false);
    expect(pixSimulado("DAM-LOR-000001/2026", 350)).toMatch(/SIMULACAO.*NAO-PAGAR.*DAM-LOR-000001\/2026.*350\.00/);
  });
});

describe("permissões de cobrança (rbac)", () => {
  const LOR = MUN;
  const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const u = (papel: Papel, municipio: string | null = null): UsuarioSessao => ({ id: "u", nome: "U", email: "u@x", cargo: null, pessoa_id: null, trocar_senha: false, papeis: [{ papel, municipio_id: municipio }], organizacao_id: papel === "REQUERENTE" ? null : ORG, municipios_org: papel === "REQUERENTE" ? [] : [LOR] });
  it("ver: servidores do município; editar (baixa/isenção/cancelamento): ADMIN e GESTOR_MUNICIPAL", () => {
    for (const [p, m] of [["ADMIN", null], ["TEC_CONSORCIO", null], ["TEC_MUNICIPAL", LOR], ["GESTOR_MUNICIPAL", LOR], ["FISCAL", LOR], ["SEMA_INEMA", null]] as [Papel, string | null][]) expect(can(u(p, m), "ver", "cobranca", LOR)).toBe(true);
    expect(can(u("ADMIN"), "editar", "cobranca", LOR)).toBe(true);
    expect(can(u("GESTOR_MUNICIPAL", LOR), "editar", "cobranca", LOR)).toBe(true);
    for (const [p, m] of [["TEC_CONSORCIO", null], ["TEC_MUNICIPAL", LOR], ["FISCAL", LOR], ["SEMA_INEMA", null], ["REQUERENTE", null]] as [Papel, string | null][]) expect(can(u(p, m), "editar", "cobranca", LOR)).toBe(false);
  });
  it("fora da organização/município: nada", () => {
    expect(can(u("ADMIN"), "ver", "cobranca", OUTRO)).toBe(false);
    expect(can(u("GESTOR_MUNICIPAL", LOR), "editar", "cobranca", OUTRO)).toBe(false);
    expect(can(u("REQUERENTE"), "ver", "cobranca", LOR)).toBe(false); // requerente vê só pelos próprios processos
  });
});
