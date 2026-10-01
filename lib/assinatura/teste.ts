// Geração de certificados de TESTE (sem valor legal) – usada pelo seed de demonstração (prisma/seed/certificado-demo.ts)
// e pelos testes unitários. Cria uma AC de teste + certificado do titular (RSA 2048) e empacota em .pfx.
// Nunca usar em produção como se fosse ICP-Brasil: `icpBrasil` só serve para testes do detector de cadeia.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import forge from "node-forge";
import { OID_ECNPJ_CNPJ, OID_ECPF_DADOS_TITULAR } from "./certificado";

export type OpcoesCertificadoTeste = {
  /** Nome do titular (vai no CN como "NOME:documento", padrão ICP-Brasil). */
  nome: string;
  /** CPF (11) ou CNPJ (14) – somente dígitos. */
  documento?: string | null;
  senha: string;
  /** Início da validade (padrão: ontem). */
  inicio?: Date;
  /** Dias de validade a partir de `inicio` (padrão: 365). */
  validadeDias?: number;
  /** Marca O=ICP-Brasil (SOMENTE para testes do detector). */
  icpBrasil?: boolean;
  /** Nome da AC de teste. */
  emissor?: string;
  /** Não incluir a chave privada no .pfx (teste de erro). */
  semChave?: boolean;
};

const utf8 = (value: string, shortName: string) => ({ shortName, value, valueTagClass: forge.asn1.Type.UTF8 as number });

function parChaves() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privada: forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString()) as forge.pki.rsa.PrivateKey,
    publica: forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString()) as forge.pki.rsa.PublicKey,
  };
}

/** subjectAltName com otherName ICP-Brasil (2.16.76.1.3.1 = e-CPF; 2.16.76.1.3.3 = e-CNPJ). */
function sanIcp(documento: string): string {
  const a = forge.asn1;
  const cpf = documento.length === 11;
  const oid = cpf ? OID_ECPF_DADOS_TITULAR : OID_ECNPJ_CNPJ;
  // e-CPF: nascimento(8) + CPF(11) + NIS(11) + RG(15) + órgão/UF(6)
  const valor = cpf ? `01011980${documento}${"0".repeat(11)}${"0".repeat(15)}${"SSPBA ".slice(0, 6)}` : documento;
  const otherName = a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [
    a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(oid).getBytes()),
    a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, valor)]),
  ]);
  return a.toDer(a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, [otherName])).getBytes();
}

const serial = () => "01" + randomBytes(15).toString("hex").toUpperCase();

/** Gera .pfx de teste (AC de teste + titular). Retorna o buffer do .pfx. */
export function gerarPfxTeste(o: OpcoesCertificadoTeste): Buffer {
  const inicio = o.inicio ?? new Date(Date.now() - 86400000);
  const fim = new Date(inicio.getTime() + (o.validadeDias ?? 365) * 86400000);
  const org = o.icpBrasil ? "ICP-Brasil" : "LicenciaGov – Ambiente de Testes";

  const ac = parChaves();
  const acCert = forge.pki.createCertificate();
  acCert.publicKey = ac.publica;
  acCert.serialNumber = serial();
  acCert.validity.notBefore = new Date(inicio.getTime() - 86400000);
  acCert.validity.notAfter = new Date(fim.getTime() + 365 * 86400000);
  const acNome = [utf8(o.emissor ?? "AC TESTE LICENCIAGOV – SEM VALOR LEGAL", "CN"), utf8(org, "O"), { shortName: "C", value: "BR" }];
  acCert.setSubject(acNome);
  acCert.setIssuer(acNome);
  acCert.setExtensions([{ name: "basicConstraints", cA: true }, { name: "keyUsage", keyCertSign: true, cRLSign: true }]);
  acCert.sign(ac.privada, forge.md.sha256.create());

  const tit = parChaves();
  const cert = forge.pki.createCertificate();
  cert.publicKey = tit.publica;
  cert.serialNumber = serial();
  cert.validity.notBefore = inicio;
  cert.validity.notAfter = fim;
  const doc = (o.documento ?? "").replace(/\D/g, "");
  cert.setSubject([utf8(doc ? `${o.nome}:${doc}` : o.nome, "CN"), utf8(org, "O"), { shortName: "C", value: "BR" }]);
  cert.setIssuer(acNome);
  const exts: object[] = [
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true, keyEncipherment: true },
    { name: "extKeyUsage", clientAuth: true, emailProtection: true },
  ];
  if (doc) exts.push({ id: "2.5.29.17", name: "subjectAltName", value: sanIcp(doc) });
  cert.setExtensions(exts);
  cert.sign(ac.privada, forge.md.sha256.create());

  const p12 = forge.pkcs12.toPkcs12Asn1(o.semChave ? null : tit.privada, [cert, acCert], o.senha, { algorithm: "3des", friendlyName: o.nome });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}
