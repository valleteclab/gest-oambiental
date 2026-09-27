import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

// AES-256-GCM para dados pessoais em repouso (SPEC 9.3). Formato: v1:iv:tag:dados (base64)
function chave(): Buffer {
  const hex = process.env.DATA_KEY;
  if (!hex || hex.length !== 64) throw new Error("DATA_KEY ausente ou inválida (64 hex)");
  return Buffer.from(hex, "hex");
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), dados.toString("base64")].join(":");
}

export function decifrar(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (!valor.startsWith("v1:")) return valor;
  const [, iv, tag, dados] = valor.split(":");
  const d = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

/** Hash determinístico (HMAC) para busca/unicidade de CPF/CNPJ sem expor o valor. */
export function hashBusca(valor: string): string {
  return createHmac("sha256", process.env.HASH_PEPPER ?? "").update(somenteDigitos(valor)).digest("hex");
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export const somenteDigitos = (v: string) => (v ?? "").replace(/\D/g, "");

export function validarCPF(v: string): boolean {
  const c = somenteDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

export function validarCNPJ(v: string): boolean {
  const c = somenteDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(c[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

export function validarCpfCnpj(v: string): boolean {
  const d = somenteDigitos(v);
  return d.length === 11 ? validarCPF(d) : d.length === 14 ? validarCNPJ(d) : false;
}

export function formatarCpfCnpj(v: string): string {
  const d = somenteDigitos(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v;
}

/** Máscara pública: CPF ***.456.789-** ; CNPJ é público (PJ) mas mascaramos parcialmente. */
export function mascararCpfCnpj(v: string): string {
  const d = somenteDigitos(v);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  return "***";
}

/** Abrevia nome de pessoa física para o portal público: "Maria da Silva Souza" → "Maria S. S." */
export function abreviarNome(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length <= 1) return nome;
  const conectores = new Set(["da", "de", "do", "das", "dos", "e"]);
  return [partes[0], ...partes.slice(1).filter((p) => !conectores.has(p.toLowerCase())).map((p) => `${p[0].toUpperCase()}.`)].join(" ");
}

// Código verificador: 12 chars base32 sem ambiguidade (sem 0/O/1/I), formato XXXX-XXXX-XXXX
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function gerarCodigoVerificador(): string {
  const bytes = randomBytes(12);
  const s = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
