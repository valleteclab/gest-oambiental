import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { diasParaVencer, ErroCertificado, lerCertificado, rotuloTipoCertificado, situacaoCertificado } from "@/lib/assinatura/certificado";
import { assinarPdf, verificarAssinaturaPdf } from "@/lib/assinatura/assinar";
import { gerarPfxTeste } from "@/lib/assinatura/teste";
import { pdfDeTeste } from "@/lib/assinatura/amostra";

const SENHA = "s3nh@-teste";
const DIA = 86400000;

describe("lerCertificado (.pfx)", () => {
  const pfxCnpj = gerarPfxTeste({ nome: "PREFEITURA MUNICIPAL DE TESTE", documento: "11222333000181", senha: SENHA });
  const pfxCpf = gerarPfxTeste({ nome: "FULANA DE TAL", documento: "52998224725", senha: SENHA, icpBrasil: true });

  it("extrai titular, CNPJ (OID 2.16.76.1.3.3), emissor, série, SHA-1 e validade", () => {
    const c = lerCertificado(pfxCnpj, SENHA);
    expect(c.nome).toBe("PREFEITURA MUNICIPAL DE TESTE");
    expect(c.cn).toBe("PREFEITURA MUNICIPAL DE TESTE:11222333000181");
    expect(c.documento).toBe("11222333000181");
    expect(c.tipo_documento).toBe("CNPJ");
    expect(c.emissor).toBe("AC TESTE LICENCIAGOV – SEM VALOR LEGAL");
    expect(c.serial).toMatch(/^[0-9A-F]+$/);
    expect(c.thumbprint_sha1).toMatch(/^[0-9A-F]{40}$/);
    expect(c.icp_brasil).toBe(false);
    expect(c.cadeia).toHaveLength(1);
    expect(c.valido_ate.getTime()).toBeGreaterThan(Date.now());
    expect(rotuloTipoCertificado(c.tipo_documento, "ORGAO")).toBe("e-CNPJ");
  });

  it("extrai CPF das posições 8..19 do OID 2.16.76.1.3.1 e detecta O=ICP-Brasil", () => {
    const c = lerCertificado(pfxCpf, SENHA);
    expect(c.documento).toBe("52998224725");
    expect(c.tipo_documento).toBe("CPF");
    expect(c.icp_brasil).toBe(true);
    expect(rotuloTipoCertificado(c.tipo_documento, "USUARIO")).toBe("e-CPF");
  });

  it("usa o padrão NOME:documento do CN quando não há otherName", () => {
    const c = lerCertificado(gerarPfxTeste({ nome: "JOAO DA SILVA", senha: SENHA }), SENHA);
    expect(c.documento).toBeNull();
    expect(c.nome).toBe("JOAO DA SILVA");
  });

  it("rejeita senha incorreta, arquivo inválido, sem chave, vencido e ainda não válido", () => {
    const erro = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        expect(e).toBeInstanceOf(ErroCertificado);
        return (e as Error).message;
      }
      throw new Error("deveria falhar");
    };
    expect(erro(() => lerCertificado(pfxCnpj, "errada"))).toMatch(/senha/i);
    expect(erro(() => lerCertificado(Buffer.from("isto não é um pfx"), SENHA))).toMatch(/PKCS#12|inválido/i);
    expect(erro(() => lerCertificado(Buffer.alloc(0), SENHA))).toMatch(/Selecione/);
    expect(erro(() => lerCertificado(Buffer.alloc(60 * 1024, 1), SENHA))).toMatch(/50 KB/);
    expect(erro(() => lerCertificado(gerarPfxTeste({ nome: "X", senha: SENHA, semChave: true }), SENHA))).toMatch(/chave privada/i);
    const vencido = gerarPfxTeste({ nome: "VENCIDO", senha: SENHA, inicio: new Date(Date.now() - 400 * DIA), validadeDias: 365 });
    expect(erro(() => lerCertificado(vencido, SENHA))).toMatch(/vencido/i);
    expect(lerCertificado(vencido, SENHA, { ignorarValidade: true }).nome).toBe("VENCIDO");
    const futuro = gerarPfxTeste({ nome: "FUTURO", senha: SENHA, inicio: new Date(Date.now() + 10 * DIA) });
    expect(erro(() => lerCertificado(futuro, SENHA))).toMatch(/ainda não é válido/i);
  });

  it("semáforo de validade", () => {
    const agora = new Date("2026-09-28T12:00:00Z");
    const de = new Date("2026-01-01T00:00:00Z");
    expect(situacaoCertificado({ valido_de: de, valido_ate: new Date("2027-01-01T00:00:00Z") }, agora)).toBe("VALIDO");
    expect(situacaoCertificado({ valido_de: de, valido_ate: new Date("2026-10-10T00:00:00Z") }, agora)).toBe("VENCENDO");
    expect(situacaoCertificado({ valido_de: de, valido_ate: new Date("2026-09-01T00:00:00Z") }, agora)).toBe("VENCIDO");
    expect(situacaoCertificado({ valido_de: de, valido_ate: new Date("2027-01-01T00:00:00Z"), ativo: false }, agora)).toBe("INATIVO");
    expect(diasParaVencer(new Date("2026-10-08T12:00:00Z"), agora)).toBe(10);
  });
});

describe("assinarPdf (PAdES)", () => {
  const cert = lerCertificado(gerarPfxTeste({ nome: "SERVIDOR DE TESTE", documento: "52998224725", senha: SENHA }), SENHA);

  it("assina PDF (fixture) com /Sig, /ByteRange cobrindo o arquivo e CMS verificável", async () => {
    const original = readFileSync(path.resolve(__dirname, "../fixtures/documento-exemplo.pdf"));
    const assinado = await assinarPdf(original, cert, { motivo: "Teste", local: "Lagoa do Orvalho/BA", nome: cert.nome, contato: "https://exemplo/validar/X" });
    expect(assinado.subarray(0, 5).toString()).toBe("%PDF-");
    const txt = assinado.toString("latin1");
    expect(txt).toContain("/Type /Sig");
    expect(txt).toContain("/SubFilter /ETSI.CAdES.detached");
    const v = verificarAssinaturaPdf(assinado);
    expect(v).toMatchObject({ assinado: true, integro: true, assinaturaValida: true, cobreArquivo: true, subFilter: "ETSI.CAdES.detached" });
    expect(v.signatario).toBe("SERVIDOR DE TESTE:52998224725");
    // pdf-lib reabre o arquivo assinado
    const doc = await PDFDocument.load(assinado);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it("detecta adulteração do conteúdo assinado", async () => {
    const assinado = await assinarPdf(await pdfDeTeste("Amostra", new Date()), cert, { motivo: "Teste", local: "BA", nome: cert.nome });
    const adulterado = Buffer.from(assinado);
    adulterado[20] = adulterado[20] ^ 0x01;
    expect(verificarAssinaturaPdf(adulterado).integro).toBe(false);
    expect(verificarAssinaturaPdf(await pdfDeTeste("Sem assinatura", new Date())).assinado).toBe(false);
  });
});
