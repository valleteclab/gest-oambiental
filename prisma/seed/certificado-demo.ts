// Seed OPCIONAL: certificado digital de TESTE (sem valor legal) para demonstrar a assinatura digital PAdES.
//
//   npm run seed:certificado-demo      (depois do seed:demo e/ou do onboarding de Riachão; no deploy: SEED_CERTIFICADO_DEMO=true)
//
// Gera, para o órgão principal da demonstração (Lagoa do Orvalho – CID-DEMO) e para Riachão das Neves (RDN, se existir),
// um certificado A1 autoassinado por uma "AC TESTE LICENCIAGOV – SEM VALOR LEGAL" (fora da ICP-Brasil → os documentos
// saem com assinatura_tipo = CERTIFICADO_TESTE e o selo "certificado de teste (sem valor legal)").
// Idempotente: pula o órgão que já tem e-CNPJ ativo e vigente. NÃO faz parte do fluxo de seed dos E2E.
// A senha do .pfx é aleatória e fica só cifrada no banco (não é necessária para nada além da assinatura automática).
import path from "node:path";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { cifrar, mascararCpfCnpj } from "../../lib/crypto";
import { lerCertificado } from "../../lib/assinatura/certificado";
import { gerarPfxTeste } from "../../lib/assinatura/teste";
import { registrarAuditoria } from "../../lib/audit";

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  /* variáveis já no ambiente */
}

const prisma = new PrismaClient();

/** CNPJ fictício com dígitos verificadores válidos (base de 12 dígitos começando por 99). */
function cnpjFicticio(base12: string): string {
  const d = base12.split("").map(Number);
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const r = pesos.reduce((s, p, i) => s + d[i] * p, 0) % 11;
    d.push(r < 2 ? 0 : 11 - r);
  }
  return d.join("");
}

const ALVOS = [
  { sigla: "LOR", cnpj: cnpjFicticio("990000010001") },
  { sigla: "RDN", cnpj: cnpjFicticio("990000020001") },
];

async function main() {
  const agora = new Date();
  for (const alvo of ALVOS) {
    const m = await prisma.municipio.findFirst({ where: { sigla: alvo.sigla }, select: { id: true, nome: true, organizacao_id: true } });
    if (!m?.organizacao_id) {
      console.log(`[certificado-demo] ${alvo.sigla}: município não encontrado – pulado.`);
      continue;
    }
    const existente = await prisma.certificadoDigital.findFirst({
      where: { organizacao_id: m.organizacao_id, titular: "ORGAO", municipio_id: m.id, ativo: true, valido_ate: { gt: agora } },
      select: { id: true, nome_titular: true },
    });
    if (existente) {
      console.log(`[certificado-demo] ${m.nome}: já possui certificado ativo (${existente.nome_titular}) – pulado.`);
      continue;
    }
    const senha = randomBytes(18).toString("base64url");
    const pfx = gerarPfxTeste({ nome: `CERTIFICADO DE TESTE – SEM VALOR LEGAL – PREFEITURA DE ${m.nome.toUpperCase()}`, documento: alvo.cnpj, senha, validadeDias: 730 });
    const lido = lerCertificado(pfx, senha);
    const c = await prisma.certificadoDigital.create({
      data: {
        organizacao_id: m.organizacao_id,
        municipio_id: m.id,
        titular: "ORGAO",
        pfx_cifrado: cifrar(pfx.toString("base64")),
        senha_cifrada: cifrar(senha),
        nome_titular: lido.nome,
        documento_titular: lido.documento ? cifrar(lido.documento) : null,
        emissor: lido.emissor,
        serial: lido.serial,
        thumbprint_sha1: lido.thumbprint_sha1,
        valido_de: lido.valido_de,
        valido_ate: lido.valido_ate,
        icp_brasil: false,
        ativo: true,
      },
    });
    await registrarAuditoria({
      usuario_id: null,
      acao: "CADASTRAR_CERTIFICADO",
      entidade: "certificado_digital",
      entidade_id: c.id,
      depois: { origem: "seed:certificado-demo", titular: "ORGAO", municipio_id: m.id, nome_titular: lido.nome, documento: lido.documento ? mascararCpfCnpj(lido.documento) : null, emissor: lido.emissor, valido_ate: lido.valido_ate, icp_brasil: false },
    });
    console.log(`[certificado-demo] ${m.nome}: certificado de teste criado (válido até ${lido.valido_ate.toLocaleDateString("pt-BR")}).`);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
