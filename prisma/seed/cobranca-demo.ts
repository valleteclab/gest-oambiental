// Cobrança de taxas de DEMONSTRAÇÃO (docs/cobranca.md) – OPCIONAL: `npm run seed:cobranca-demo` (predeploy: SEED_COBRANCA_DEMO=true).
//
// Ativa a cobrança SIMULADA (sandbox sem chave do Asaas → Pix/linha digitável fictícios + botão "Simular pagamento")
// e cadastra uma tabela de taxas ilustrativa (valores e lei FICTÍCIOS) em:
//   • Riachão das Neves (RDN, organização PM-RDN) – exige o onboarding riachao-das-neves;
//   • Alto do Umbuzeiro (AUM, consórcio fictício CID-DEMO) – município que os testes E2E não usam.
// NUNCA toca LOR/SSR/CSE (fluxos dos E2E). Também gera a cobrança do protocolo para os processos de RDN/AUM que estão
// na triagem (aguardando o aceite), para a fila /financeiro e o bloqueio "Aguardando pagamento" aparecerem na demo.
// Idempotente: upsert da configuração; linhas da tabela só são criadas se a organização ainda não tiver taxas no município.
//
// Os módulos de lib/ importam "server-only": rodar com `tsx --conditions=react-server` (ver package.json).
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { FaseCobranca, PotencialPoluidor, Porte } from "@prisma/client";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const MUNICIPIOS = ["RDN", "AUM"];
const LEI = "Lei Municipal nº 000/2026 (FICTÍCIA – demonstração)";

type Linha = { fase: FaseCobranca; tipo?: string; porte?: Porte; potencial?: PotencialPoluidor; valor: number; descricao: string };

const TABELA: Linha[] = [
  // Análise (LP/LI/LO/LU/RLO… – qualquer tipo de ato) por porte
  { fase: "ANALISE", porte: "MICRO", valor: 180, descricao: "Análise – porte micro" },
  { fase: "ANALISE", porte: "PEQUENO", valor: 350, descricao: "Análise – porte pequeno" },
  { fase: "ANALISE", porte: "MEDIO", valor: 950, descricao: "Análise – porte médio" },
  { fase: "ANALISE", porte: "GRANDE", valor: 2800, descricao: "Análise – porte grande" },
  { fase: "ANALISE", porte: "GRANDE", potencial: "ALTO", valor: 3600, descricao: "Análise – porte grande, potencial alto" },
  { fase: "ANALISE", porte: "EXCEPCIONAL", valor: 5200, descricao: "Análise – porte excepcional" },
  // Atos simplificados: taxa única no protocolo (substitui as demais fases)
  { fase: "UNICA", tipo: "CERT_DISP", valor: 90, descricao: "Certidão de dispensa – taxa única" },
  { fase: "UNICA", tipo: "DECL", valor: 60, descricao: "Declaração ambiental – taxa única" },
  { fase: "UNICA", tipo: "APC", valor: 45, descricao: "Poda/corte de árvore – taxa única" },
  { fase: "UNICA", tipo: "ASE", valor: 120, descricao: "Som em evento – taxa única" },
  { fase: "UNICA", tipo: "ACS", valor: 80, descricao: "Carro de som – taxa única" },
  // Vistoria e emissão
  { fase: "VISTORIA", valor: 250, descricao: "Vistoria técnica" },
  { fase: "EMISSAO", valor: 120, descricao: "Emissão do documento" },
];

async function main() {
  const { prisma } = await import("../../lib/db");
  const { criarRegistroCobranca, registrarNoGateway } = await import("../../lib/cobranca/servico");
  const { sessaoPorEmail } = await import("../../lib/sessao");
  const { registrarAuditoria } = await import("../../lib/audit");

  for (const sigla of MUNICIPIOS) {
    const m = await prisma.municipio.findUnique({ where: { sigla }, select: { id: true, nome: true, organizacao_id: true } });
    if (!m) {
      console.log(`[cobranca-demo] ${sigla} não existe neste banco – ignorado.`);
      continue;
    }
    const antes = await prisma.configCobranca.findUnique({ where: { municipio_id: m.id } });
    const cfg = await prisma.configCobranca.upsert({
      where: { municipio_id: m.id },
      update: { ativo: true, gateway: "ASAAS", asaas_sandbox: true },
      create: {
        municipio_id: m.id,
        ativo: true,
        gateway: "ASAAS",
        asaas_sandbox: true, // sem chave em sandbox = SIMULADO (nenhuma chamada ao Asaas)
        asaas_webhook_token: randomBytes(24).toString("hex"),
        dias_vencimento: 10,
        exige_pagamento: true,
        multa_percentual: 2,
        juros_mensal_percentual: 1,
        instrucoes: `Taxa de licenciamento ambiental – ${LEI}.`,
      },
    });
    await registrarAuditoria({ usuario_id: null, acao: antes ? "EDITAR" : "CRIAR", entidade: "config_cobranca", entidade_id: cfg.id, depois: { municipio: sigla, ativo: true, origem: "seed:cobranca-demo" } });

    const jaTem = await prisma.tabelaTaxa.count({ where: { organizacao_id: m.organizacao_id, municipio_id: m.id } });
    if (!jaTem) {
      const tipos = new Map((await prisma.tipoAto.findMany({ where: { organizacao_id: m.organizacao_id }, select: { id: true, sigla: true } })).map((t) => [t.sigla, t.id]));
      for (const l of TABELA) {
        if (l.tipo && !tipos.has(l.tipo)) continue;
        const t = await prisma.tabelaTaxa.create({
          data: { organizacao_id: m.organizacao_id, municipio_id: m.id, tipo_ato_id: l.tipo ? tipos.get(l.tipo)! : null, fase: l.fase, porte: l.porte ?? null, potencial: l.potencial ?? null, valor: l.valor, descricao: l.descricao, base_legal: LEI },
        });
        await registrarAuditoria({ usuario_id: null, acao: "CRIAR", entidade: "tabela_taxa", entidade_id: t.id, depois: t });
      }
    }

    // Cobrança do protocolo para processos na triagem (demonstra a fila e o bloqueio do aceite)
    const admin = await prisma.usuario.findFirst({ where: { organizacao_id: m.organizacao_id, ativo: true, papeis: { some: { papel: "ADMIN" } } }, select: { email: true } });
    const u = admin ? await sessaoPorEmail(admin.email) : null;
    const emTriagem = await prisma.processo.findMany({ where: { municipio_id: m.id, status: { in: ["PROTOCOLADO", "EM_TRIAGEM"] }, cobrancas: { none: {} } }, select: { id: true, numero: true } });
    let geradas = 0;
    for (const p of emTriagem) {
      const c = await prisma.$transaction(async (tx) => (await criarRegistroCobranca(tx, p.id, "UNICA", u)) ?? (await criarRegistroCobranca(tx, p.id, "ANALISE", u)));
      if (c) {
        await registrarNoGateway(c.id, u);
        geradas++;
      }
    }
    const tabela = await prisma.tabelaTaxa.count({ where: { organizacao_id: m.organizacao_id, municipio_id: m.id } });
    console.log(`[cobranca-demo] ${m.nome} (${sigla}): cobrança SIMULADA ativa (exige pagamento), ${tabela} linha(s) na tabela de taxas, ${geradas} cobrança(s) gerada(s) para processos na triagem.`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
