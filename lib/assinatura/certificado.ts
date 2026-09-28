// Leitura de certificados digitais A1 (.pfx/.p12) – funções PURAS (sem banco/IO), testadas em tests/unit/assinatura.test.ts.
// Extrai titular (CN), CPF/CNPJ pelos OIDs da ICP-Brasil (DOC-ICP-04), emissor, série, impressão digital SHA-1,
// validade e se a cadeia é ICP-Brasil. A chave privada só existe em memória (nunca logar/serializar).
import forge from "node-forge";

/** Erro com mensagem amigável (exibida ao usuário). Nunca contém a senha nem bytes do certificado. */
export class ErroCertificado extends Error {
  status = 422;
  code = "CERTIFICADO_INVALIDO";
  details?: { campo?: string };
  constructor(mensagem: string, campo?: string) {
    super(mensagem);
    this.name = "ErroCertificado";
    if (campo) this.details = { campo };
  }
}

/** Tamanho máximo aceito para o arquivo .pfx/.p12 (A1 típico: 3–10 KB). */
export const TAMANHO_MAXIMO_PFX = 50 * 1024;

// OIDs ICP-Brasil (DOC-ICP-04, item 7.1.2.3 – otherName do subjectAltName)
export const OID_ECPF_DADOS_TITULAR = "2.16.76.1.3.1"; // nascimento(8) + CPF(11) + NIS(11) + RG(15) + órgão/UF(6)
export const OID_ECNPJ_RESPONSAVEL_NOME = "2.16.76.1.3.2";
export const OID_ECNPJ_CNPJ = "2.16.76.1.3.3"; // CNPJ (14)
export const OID_ECNPJ_DADOS_RESPONSAVEL = "2.16.76.1.3.4"; // nascimento(8) + CPF(11) + ...

export type TipoDocumentoTitular = "CPF" | "CNPJ";

export type CertificadoLido = {
  /** Nome do titular (CN sem o sufixo ":documento"). */
  nome: string;
  /** CN completo. */
  cn: string;
  documento: string | null;
  tipo_documento: TipoDocumentoTitular | null;
  /** CN (ou O) do emissor. */
  emissor: string;
  /** Número de série (hex, maiúsculo). */
  serial: string;
  /** SHA-1 do certificado em DER (hex maiúsculo, sem separadores). */
  thumbprint_sha1: string;
  valido_de: Date;
  valido_ate: Date;
  icp_brasil: boolean;
  /** Certificado do titular (forge). */
  certificado: forge.pki.Certificate;
  /** Demais certificados do .pfx (cadeia: AC intermediárias/raiz). */
  cadeia: forge.pki.Certificate[];
  /** Chave privada RSA – somente em memória. */
  chave: forge.pki.rsa.PrivateKey;
};

/** Dados do certificado que podem ser gravados/exibidos (sem chave privada nem objetos forge). */
export type ResumoCertificado = Pick<CertificadoLido, "nome" | "cn" | "documento" | "tipo_documento" | "emissor" | "serial" | "thumbprint_sha1" | "valido_de" | "valido_ate" | "icp_brasil">;

export function resumoCertificado(c: CertificadoLido): ResumoCertificado {
  const { nome, cn, documento, tipo_documento, emissor, serial, thumbprint_sha1, valido_de, valido_ate, icp_brasil } = c;
  return { nome, cn, documento, tipo_documento, emissor, serial, thumbprint_sha1, valido_de, valido_ate, icp_brasil };
}

const soDigitos = (v: string) => v.replace(/\D/g, "");

/** Valor textual de um atributo de nome (decodifica UTF8String). */
function valorAtributo(attr: { value?: unknown; valueTagClass?: number } | null | undefined): string {
  if (!attr || typeof attr.value !== "string") return "";
  if (attr.valueTagClass === forge.asn1.Type.UTF8) {
    try {
      return forge.util.decodeUtf8(attr.value);
    } catch {
      return attr.value;
    }
  }
  if (attr.valueTagClass === forge.asn1.Type.BMPSTRING) {
    let s = "";
    for (let i = 0; i + 1 < attr.value.length; i += 2) s += String.fromCharCode((attr.value.charCodeAt(i) << 8) | attr.value.charCodeAt(i + 1));
    return s;
  }
  return attr.value;
}

function campo(nome: forge.pki.Certificate["subject"], sn: string): string {
  return valorAtributo(nome.getField(sn) as { value?: unknown; valueTagClass?: number } | null).trim();
}

function camposTodos(nome: forge.pki.Certificate["subject"], sn: string): string[] {
  return (nome.attributes as { shortName?: string; value?: unknown; valueTagClass?: number }[]).filter((a) => a.shortName === sn).map((a) => valorAtributo(a).trim());
}

/** Lê os otherName do subjectAltName → { oid: texto }. */
export function otherNamesIcp(cert: forge.pki.Certificate): Record<string, string> {
  const r: Record<string, string> = {};
  const ext = (cert.extensions as { id?: string; name?: string; value?: string }[]).find((e) => e.id === "2.5.29.17" || e.name === "subjectAltName");
  if (!ext?.value || typeof ext.value !== "string") return r;
  let seq: forge.asn1.Asn1;
  try {
    seq = forge.asn1.fromDer(ext.value);
  } catch {
    return r;
  }
  for (const gn of Array.isArray(seq.value) ? seq.value : []) {
    // otherName: [0] { type-id OID, [0] EXPLICIT value }
    if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0 || !Array.isArray(gn.value)) continue;
    const [oidNode, valNode] = gn.value;
    if (!oidNode || oidNode.type !== forge.asn1.Type.OID || typeof oidNode.value !== "string") continue;
    const oid = forge.asn1.derToOid(oidNode.value);
    let v: forge.asn1.Asn1 | undefined = valNode;
    // desembrulha [0] EXPLICIT
    while (v && Array.isArray(v.value) && v.value.length > 0 && v.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC) v = v.value[0];
    if (!v) continue;
    let texto = "";
    if (typeof v.value === "string") texto = v.type === forge.asn1.Type.UTF8 ? safeUtf8(v.value) : v.value;
    r[oid] = texto;
  }
  return r;
}

function safeUtf8(s: string): string {
  try {
    return forge.util.decodeUtf8(s);
  } catch {
    return s;
  }
}

/** CPF/CNPJ do titular pelos OIDs ICP-Brasil; senão pelo padrão "NOME:12345678901" do CN. */
export function documentoDoTitular(cert: forge.pki.Certificate): { documento: string | null; tipo: TipoDocumentoTitular | null } {
  const on = otherNamesIcp(cert);
  const cnpj = soDigitos(on[OID_ECNPJ_CNPJ] ?? "");
  if (cnpj.length === 14 && !/^0+$/.test(cnpj)) return { documento: cnpj, tipo: "CNPJ" };
  const dadosPf = on[OID_ECPF_DADOS_TITULAR] ?? "";
  const cpf = soDigitos(dadosPf.slice(8, 19));
  if (cpf.length === 11 && !/^0+$/.test(cpf)) return { documento: cpf, tipo: "CPF" };
  const cn = campo(cert.subject, "CN");
  const m = /:\s*(\d{11}|\d{14})\s*$/.exec(cn);
  if (m) return { documento: m[1], tipo: m[1].length === 14 ? "CNPJ" : "CPF" };
  return { documento: null, tipo: null };
}

/** O certificado (ou a cadeia) pertence à ICP-Brasil? (O=ICP-Brasil no titular, emissor ou em qualquer AC do .pfx) */
export function ehIcpBrasil(cert: forge.pki.Certificate, cadeia: forge.pki.Certificate[] = []): boolean {
  const icp = (n: forge.pki.Certificate["subject"]) => camposTodos(n, "O").some((o) => /^icp-brasil$/i.test(o.replace(/\s+/g, "")));
  return [cert, ...cadeia].some((c) => icp(c.subject) || icp(c.issuer));
}

export function thumbprintSha1(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return forge.md.sha1.create().update(der).digest().toHex().toUpperCase();
}

function mesmaChave(chave: forge.pki.rsa.PrivateKey, cert: forge.pki.Certificate): boolean {
  const pub = cert.publicKey as forge.pki.rsa.PublicKey;
  return !!pub?.n && !!pub?.e && chave.n.compareTo(pub.n) === 0 && chave.e.compareTo(pub.e) === 0;
}

export type OpcoesLeitura = {
  /** Data de referência para a validade (padrão: agora). */
  agora?: Date;
  /** Aceita certificado vencido/ainda não válido (ex.: listar/diagnosticar). Padrão: false (rejeita). */
  ignorarValidade?: boolean;
};

/**
 * Abre o .pfx/.p12 com a senha e devolve titular, documento, emissor, série, SHA-1, validade, ICP-Brasil e a chave.
 * Erros (ErroCertificado): arquivo inválido, senha incorreta, sem chave privada, chave não-RSA, vencido, ainda não válido.
 */
export function lerCertificado(pfx: Buffer | Uint8Array, senha: string, opts: OpcoesLeitura = {}): CertificadoLido {
  const buf = Buffer.from(pfx);
  if (buf.length === 0) throw new ErroCertificado("Selecione o arquivo do certificado (.pfx ou .p12).", "arquivo");
  if (buf.length > TAMANHO_MAXIMO_PFX) throw new ErroCertificado("Arquivo muito grande para um certificado A1 (máximo de 50 KB).", "arquivo");

  let asn1: forge.asn1.Asn1;
  try {
    asn1 = forge.asn1.fromDer(forge.util.createBuffer(buf.toString("binary")), false);
  } catch {
    throw new ErroCertificado("O arquivo não é um certificado A1 válido (.pfx/.p12 no formato PKCS#12).", "arquivo");
  }
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|mac could not be verified|invalid password|decrypt/i.test(msg)) throw new ErroCertificado("Senha do certificado incorreta.", "senha");
    if (/unsupported|not supported/i.test(msg)) throw new ErroCertificado("Formato de criptografia do .pfx não suportado. Exporte novamente o certificado (ex.: com 3DES/SHA-1 ou AES-256/SHA-256).", "arquivo");
    throw new ErroCertificado("Não foi possível abrir o certificado: arquivo inválido ou senha incorreta.", "senha");
  }

  const bags = (tipo: string) => (p12.getBags({ bagType: tipo })[tipo] ?? []) as forge.pkcs12.Bag[];
  const chaves = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)].map((b) => b.key).filter(Boolean) as forge.pki.PrivateKey[];
  const certs = bags(forge.pki.oids.certBag).map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  if (certs.length === 0) throw new ErroCertificado("O arquivo não contém certificado.", "arquivo");
  if (chaves.length === 0) throw new ErroCertificado("O arquivo não contém a chave privada. Exporte o certificado A1 COM a chave privada (.pfx).", "arquivo");
  const chave = chaves[0] as forge.pki.rsa.PrivateKey;
  if (!chave || !(chave as { n?: unknown }).n) throw new ErroCertificado("Tipo de chave não suportado (somente RSA, padrão dos certificados A1 ICP-Brasil).", "arquivo");

  const certificado = certs.find((c) => mesmaChave(chave, c));
  if (!certificado) throw new ErroCertificado("A chave privada não corresponde a nenhum certificado do arquivo.", "arquivo");
  const cadeia = certs.filter((c) => c !== certificado);

  const agora = opts.agora ?? new Date();
  const valido_de = certificado.validity.notBefore;
  const valido_ate = certificado.validity.notAfter;
  if (!opts.ignorarValidade) {
    if (valido_ate.getTime() < agora.getTime()) throw new ErroCertificado(`Certificado vencido em ${valido_ate.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}. Renove-o na Autoridade Certificadora.`, "arquivo");
    if (valido_de.getTime() > agora.getTime()) throw new ErroCertificado(`Certificado ainda não é válido (início em ${valido_de.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}).`, "arquivo");
  }

  const cn = campo(certificado.subject, "CN") || campo(certificado.subject, "O") || "(sem nome)";
  const nome = cn.replace(/:\s*\d{11,14}\s*$/, "").trim() || cn;
  const { documento, tipo } = documentoDoTitular(certificado);
  const emissor = campo(certificado.issuer, "CN") || campo(certificado.issuer, "O") || "(emissor desconhecido)";

  return {
    nome,
    cn,
    documento,
    tipo_documento: tipo,
    emissor,
    serial: (certificado.serialNumber || "").toUpperCase(),
    thumbprint_sha1: thumbprintSha1(certificado),
    valido_de,
    valido_ate,
    icp_brasil: ehIcpBrasil(certificado, cadeia),
    certificado,
    cadeia,
    chave,
  };
}

/** Dias (inteiros, arredondados para baixo) até o vencimento; negativo se vencido. */
export function diasParaVencer(validoAte: Date, agora = new Date()): number {
  return Math.floor((validoAte.getTime() - agora.getTime()) / 86400000);
}

export type SituacaoCertificado = "VALIDO" | "VENCENDO" | "VENCIDO" | "FUTURO" | "INATIVO";

/** Semáforo do certificado: vencendo = até `janela` dias (padrão 30). */
export function situacaoCertificado(c: { valido_de: Date; valido_ate: Date; ativo?: boolean }, agora = new Date(), janela = 30): SituacaoCertificado {
  if (c.ativo === false) return "INATIVO";
  if (c.valido_ate.getTime() < agora.getTime()) return "VENCIDO";
  if (c.valido_de.getTime() > agora.getTime()) return "FUTURO";
  return diasParaVencer(c.valido_ate, agora) <= janela ? "VENCENDO" : "VALIDO";
}

/** Tipo exibido no documento/validação: e-CPF, e-CNPJ ou genérico. */
export function rotuloTipoCertificado(tipoDoc: TipoDocumentoTitular | null | undefined, titular: "ORGAO" | "USUARIO"): string {
  if (tipoDoc === "CNPJ") return "e-CNPJ";
  if (tipoDoc === "CPF") return "e-CPF";
  return titular === "ORGAO" ? "certificado do órgão" : "certificado do servidor";
}
