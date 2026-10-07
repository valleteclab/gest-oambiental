// Dados pessoais do interessado externo do protocolo: nome, CPF/CNPJ, e-mail e telefone ficam CIFRADOS (AES-256-GCM, lib/crypto);
// o CPF/CNPJ tem ainda um hash determinístico (hashBusca) para localizar protocolos sem expor o número.
import { cifrar, decifrar, formatarCpfCnpj, hashBusca, mascararCpfCnpj, somenteDigitos } from "@/lib/crypto";

export type DadosInteressado = { nome: string; cpf_cnpj?: string | null; email?: string | null; telefone?: string | null };

export type ColunasInteressado = {
  interessado_nome_cifrado: string | null;
  interessado_doc_cifrado: string | null;
  interessado_doc_hash: string | null;
  interessado_email_cifrado: string | null;
  interessado_telefone_cifrado: string | null;
};

export const emailNormalizado = (e: string) => e.trim().toLowerCase();

/** Colunas prontas para gravar (tudo que é dado pessoal sai cifrado). */
export function cifrarInteressado(i: DadosInteressado | null | undefined): ColunasInteressado {
  const doc = i?.cpf_cnpj ? somenteDigitos(i.cpf_cnpj) : "";
  return {
    interessado_nome_cifrado: i?.nome ? cifrar(i.nome.trim()) : null,
    interessado_doc_cifrado: doc ? cifrar(doc) : null,
    interessado_doc_hash: doc ? hashBusca(doc) : null,
    interessado_email_cifrado: i?.email ? cifrar(emailNormalizado(i.email)) : null,
    interessado_telefone_cifrado: i?.telefone ? cifrar(somenteDigitos(i.telefone)) : null,
  };
}

export type InteressadoLido = { nome: string | null; cpf_cnpj: string | null; email: string | null; telefone: string | null };

function seguro(v: string | null | undefined): string | null {
  try {
    return decifrar(v);
  } catch {
    return null; // DATA_KEY diferente/linha corrompida: nunca derruba a tela
  }
}

export function lerInteressado(c: Partial<ColunasInteressado>): InteressadoLido {
  return {
    nome: seguro(c.interessado_nome_cifrado),
    cpf_cnpj: seguro(c.interessado_doc_cifrado),
    email: seguro(c.interessado_email_cifrado),
    telefone: seguro(c.interessado_telefone_cifrado),
  };
}

/** "Maria S. S." – para listas e telas com menos exposição. */
export { abreviarNome } from "@/lib/crypto";
export const docMascarado = (doc: string | null | undefined) => (doc ? mascararCpfCnpj(doc) : null);
export const docFormatado = (doc: string | null | undefined) => (doc ? formatarCpfCnpj(doc) : null);

/** "ma***@dominio.com" */
export const mascararEmailInteressado = (e: string) => e.replace(/^(.{2})[^@]*(@.*)$/, "$1***$2");

/** Hash para localizar protocolos por CPF/CNPJ (os dígitos; formatação irrelevante). */
export const hashDocumento = (doc: string) => hashBusca(doc);
