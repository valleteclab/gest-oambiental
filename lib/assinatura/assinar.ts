// Assinatura digital PAdES (PDF) com certificado A1 – funções PURAS (sem banco), testadas em tests/unit/assinatura.test.ts.
//
// Fluxo: pdf-lib reabre o PDF gerado pelo Chromium e acrescenta o campo /Sig com placeholder (@signpdf/placeholder-pdf-lib);
// @signpdf/signpdf calcula o /ByteRange e chama o assinante, que monta o CMS (SignedData destacado) no perfil
// PAdES-B-B (SubFilter ETSI.CAdES.detached): atributos assinados contentType + messageDigest (SHA-256) +
// signingCertificateV2 (ESS, RFC 5035), RSA/SHA-256 e a cadeia do .pfx embutida. O horário declarado vai no /M do dicionário.
// Assinatura única por documento (e-CPF do servidor OU e-CNPJ do órgão – ver lib/assinatura/servico.ts).
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { P12Signer } from "@signpdf/signer-p12";
import signpdf from "@signpdf/signpdf";
import type { CertificadoLido } from "./certificado";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
};

/** Espaço reservado para o CMS (hex): cadeias ICP-Brasil com 3–4 ACs passam de 8 KB. */
const TAMANHO_ASSINATURA = 32768;

const a = forge.asn1;
const seq = (v: forge.asn1.Asn1[]) => a.create(a.Class.UNIVERSAL, a.Type.SEQUENCE, true, v);
const set = (v: forge.asn1.Asn1[]) => a.create(a.Class.UNIVERSAL, a.Type.SET, true, v);
const oid = (o: string) => a.create(a.Class.UNIVERSAL, a.Type.OID, false, a.oidToDer(o).getBytes());
const nulo = () => a.create(a.Class.UNIVERSAL, a.Type.NULL, false, "");
const octet = (bytes: string) => a.create(a.Class.UNIVERSAL, a.Type.OCTETSTRING, false, bytes);
const inteiro = (bytes: string) => a.create(a.Class.UNIVERSAL, a.Type.INTEGER, false, bytes);
const der = (x: forge.asn1.Asn1) => a.toDer(x).getBytes();

function certAsn1(c: forge.pki.Certificate): forge.asn1.Asn1 {
  return forge.pki.certificateToAsn1(c);
}

/** Emissor (Name) e número de série exatamente como codificados no certificado. */
function emissorESerial(c: forge.pki.Certificate): { emissor: forge.asn1.Asn1; serial: forge.asn1.Asn1 } {
  const tbs = (c as unknown as { tbsCertificate?: forge.asn1.Asn1 }).tbsCertificate ?? (forge.pki as unknown as { getTBSCertificate: (x: forge.pki.Certificate) => forge.asn1.Asn1 }).getTBSCertificate(c);
  const filhos = tbs.value as forge.asn1.Asn1[];
  const i = filhos[0].tagClass === a.Class.CONTEXT_SPECIFIC ? 1 : 0; // [0] version
  return { serial: filhos[i], emissor: filhos[i + 2] };
}

function ordenarDer(itens: forge.asn1.Asn1[]): forge.asn1.Asn1[] {
  // DER: elementos de SET OF em ordem crescente de codificação
  return itens.map((x) => ({ x, d: der(x) })).sort((p, q) => (p.d < q.d ? -1 : p.d > q.d ? 1 : 0)).map((p) => p.x);
}

/** Monta o CMS SignedData destacado (PAdES-B-B) para `conteudo` (bytes do /ByteRange). */
export function cmsDestacado(conteudo: Buffer, cert: Pick<CertificadoLido, "certificado" | "cadeia" | "chave">): Buffer {
  const hashConteudo = forge.md.sha256.create().update(conteudo.toString("binary")).digest().getBytes();
  const certDer = der(certAsn1(cert.certificado));
  const hashCert = forge.md.sha256.create().update(certDer).digest().getBytes();
  const { emissor, serial } = emissorESerial(cert.certificado);

  // ESSCertIDv2 { certHash, issuerSerial { GeneralNames { [4] Name }, serial } } (hashAlgorithm = sha256 padrão → omitido)
  const signingCertV2 = seq([
    seq([
      seq([
        octet(hashCert),
        seq([seq([a.create(a.Class.CONTEXT_SPECIFIC, 4, true, [emissor])]), inteiro(serial.value as string)]),
      ]),
    ]),
  ]);
  const atributos = ordenarDer([
    seq([oid(OID.contentType), set([oid(OID.data)])]),
    seq([oid(OID.messageDigest), set([octet(hashConteudo)])]),
    seq([oid(OID.signingCertificateV2), set([signingCertV2])]),
  ]);

  // Assina o DER do SET OF atributos (tag SET), mas grava como [0] IMPLICIT no SignerInfo.
  const md = forge.md.sha256.create();
  md.update(der(set(atributos)));
  const assinatura = cert.chave.sign(md);

  const algSha256 = seq([oid(OID.sha256), nulo()]);
  const signerInfo = seq([
    inteiro(String.fromCharCode(1)),
    seq([emissor, inteiro(serial.value as string)]),
    algSha256,
    a.create(a.Class.CONTEXT_SPECIFIC, 0, true, atributos),
    seq([oid(OID.rsaEncryption), nulo()]),
    octet(assinatura),
  ]);
  const certificados = [cert.certificado, ...cert.cadeia].map(certAsn1);
  const signedData = seq([
    inteiro(String.fromCharCode(1)),
    set([seq([oid(OID.sha256), nulo()])]),
    seq([oid(OID.data)]),
    a.create(a.Class.CONTEXT_SPECIFIC, 0, true, certificados),
    set([signerInfo]),
  ]);
  const contentInfo = seq([oid(OID.signedData), a.create(a.Class.CONTEXT_SPECIFIC, 0, true, [signedData])]);
  return Buffer.from(der(contentInfo), "binary");
}

/** Assinante para o @signpdf: reaproveita a interface do P12Signer, mas usa o certificado já aberto (chave em memória). */
class AssinanteCertificado extends P12Signer {
  constructor(private readonly lido: Pick<CertificadoLido, "certificado" | "cadeia" | "chave">) {
    super(Buffer.alloc(1)); // o .pfx não é relido aqui: a chave já foi extraída por lerCertificado()
  }
  async sign(pdf: Buffer): Promise<Buffer> {
    return cmsDestacado(pdf, this.lido);
  }
}

export type OpcoesAssinatura = {
  /** /Reason – ex.: "Emissão de Licença Ambiental nº LO-LOR-0001/2026". */
  motivo: string;
  /** /Location – ex.: "Lagoa do Orvalho/BA". */
  local: string;
  /** /Name – nome do signatário. */
  nome: string;
  /** /ContactInfo – ex.: URL de validação. */
  contato?: string;
  /** /M – horário declarado (padrão: agora). */
  quando?: Date;
};

/**
 * Assina o PDF (PAdES, assinatura invisível – o carimbo visual já está no HTML do documento).
 * Retorna o PDF assinado; o SHA-256 do documento oficial deve ser calculado SOBRE este buffer.
 */
export async function assinarPdf(pdf: Buffer, cert: Pick<CertificadoLido, "certificado" | "cadeia" | "chave">, o: OpcoesAssinatura): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: o.motivo,
    contactInfo: o.contato ?? "",
    name: o.nome,
    location: o.local,
    signingTime: o.quando,
    signatureLength: TAMANHO_ASSINATURA,
    subFilter: "ETSI.CAdES.detached",
    appName: "LicenciaGov",
  });
  const comPlaceholder = Buffer.from(await doc.save({ useObjectStreams: false }));
  return signpdf.sign(comPlaceholder, new AssinanteCertificado(cert));
}

// ───────────── Verificação (testes, diagnóstico e "Testar assinatura") ─────────────

export type VerificacaoPdf = {
  assinado: boolean;
  byteRange: number[] | null;
  /** messageDigest do CMS confere com o SHA-256 dos bytes cobertos pelo /ByteRange. */
  integro: boolean;
  /** Assinatura RSA sobre os atributos assinados confere com a chave pública do certificado do signatário. */
  assinaturaValida: boolean;
  /** /ByteRange cobre o arquivo inteiro (exceto /Contents). */
  cobreArquivo: boolean;
  signatario: string | null;
  subFilter: string | null;
};

/** Verifica a (última) assinatura PAdES do PDF com node-forge – não valida cadeia/revogação (isso é do validar.iti.gov.br). */
export function verificarAssinaturaPdf(pdf: Buffer): VerificacaoPdf {
  const vazio: VerificacaoPdf = { assinado: false, byteRange: null, integro: false, assinaturaValida: false, cobreArquivo: false, signatario: null, subFilter: null };
  const texto = pdf.toString("latin1");
  const brs = [...texto.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  if (brs.length === 0) return vazio;
  const m = brs[brs.length - 1];
  const br = m.slice(1, 5).map(Number);
  const sub = /\/SubFilter\s*\/([A-Za-z0-9.]+)/.exec(texto)?.[1] ?? null;
  const [i1, l1, i2, l2] = br;
  const conteudo = Buffer.concat([pdf.subarray(i1, i1 + l1), pdf.subarray(i2, i2 + l2)]);
  // Conteúdo de /Contents <...> (CMS + zeros de preenchimento; o DER traz o próprio tamanho)
  const hexAssinatura = pdf.subarray(i1 + l1 + 1, i2 - 1).toString("latin1");
  const r: VerificacaoPdf = { ...vazio, assinado: true, byteRange: br, subFilter: sub, cobreArquivo: i1 === 0 && i2 + l2 === pdf.length };
  try {
    const bytes = forge.util.hexToBytes(hexAssinatura);
    const ci = a.fromDer(bytes, { strict: false, parseAllBytes: false } as unknown as boolean);
    const sd = ((ci.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0];
    const filhos = sd.value as forge.asn1.Asn1[];
    const certs = filhos.find((x) => x.tagClass === a.Class.CONTEXT_SPECIFIC && x.type === 0);
    const signerInfos = filhos[filhos.length - 1];
    const si = (signerInfos.value as forge.asn1.Asn1[])[0].value as forge.asn1.Asn1[];
    const sid = si[1].value as forge.asn1.Asn1[];
    const serialHex = forge.util.bytesToHex(sid[1].value as string).toUpperCase();
    const atributos = si.find((x) => x.tagClass === a.Class.CONTEXT_SPECIFIC && x.type === 0)!;
    const assinatura = si[si.length - 1].value as string;

    const lista = ((certs?.value as forge.asn1.Asn1[]) ?? []).map((c) => forge.pki.certificateFromAsn1(c));
    const cert = lista.find((c) => c.serialNumber.toUpperCase().replace(/^0+/, "") === serialHex.replace(/^0+/, ""));
    r.signatario = (cert?.subject.getField("CN") as { value?: string } | null)?.value ?? null;

    let digest: string | null = null;
    for (const at of atributos.value as forge.asn1.Asn1[]) {
      const [tipo, valores] = at.value as forge.asn1.Asn1[];
      if (a.derToOid(tipo.value as string) === OID.messageDigest) digest = ((valores.value as forge.asn1.Asn1[])[0].value as string) ?? null;
    }
    const calculado = forge.md.sha256.create().update(conteudo.toString("binary")).digest().getBytes();
    r.integro = digest === calculado;

    if (cert) {
      const setAttrs = a.create(a.Class.UNIVERSAL, a.Type.SET, true, atributos.value as forge.asn1.Asn1[]);
      const md = forge.md.sha256.create().update(der(setAttrs));
      r.assinaturaValida = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), assinatura);
    }
  } catch {
    /* CMS ilegível → não íntegro */
  }
  return r;
}
