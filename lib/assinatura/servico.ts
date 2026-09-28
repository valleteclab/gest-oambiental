// Serviço de certificados digitais (A1) e assinatura de documentos oficiais – usa o banco.
//  - Seleção do certificado na emissão: e-CPF ativo do SERVIDOR que emite → e-CNPJ do ÓRGÃO (município do documento)
//    → e-CNPJ da ORGANIZAÇÃO (municipio_id NULL). Vencidos/ainda não válidos são pulados (cai na assinatura eletrônica
//    avançada; o admin vê o aviso em /admin/certificados).
//  - .pfx e senha: cifrados em repouso (lib/crypto – DATA_KEY); decifrados só em memória; nunca logados nem devolvidos.
import "server-only";
import type { CertificadoDigital, TitularCertificado } from "@prisma/client";
import { prisma } from "../db";
import { auditar } from "../audit";
import { cifrar, decifrar, mascararCpfCnpj } from "../crypto";
import { invalido, naoEncontrado, proibido } from "../http";
import { can, isSomenteLeitura, type UsuarioSessao } from "../rbac";
import { ErroCertificado, lerCertificado, rotuloTipoCertificado, TAMANHO_MAXIMO_PFX, type CertificadoLido } from "./certificado";
import { assinarPdf } from "./assinar";
import { pdfDeTeste } from "./amostra";

export type AssinaturaTipo = "ICP_BRASIL" | "CERTIFICADO_TESTE" | "ELETRONICA_AVANCADA";

/** Entrada de `documento_oficial.assinaturas` (JSON). Só dados públicos/mascarados. */
export type RegistroAssinatura = {
  tipo: AssinaturaTipo;
  titular?: TitularCertificado;
  tipo_certificado?: string; // e-CPF / e-CNPJ
  nome: string;
  cargo?: string | null;
  documento_mascarado?: string | null;
  emissor?: string;
  serial?: string;
  valido_ate?: string;
  icp_brasil?: boolean;
  assinado_em: string;
};

/** Selecionado para uma emissão: registro + certificado aberto (chave só em memória). */
export type CertificadoEmissao = { registro: CertificadoDigital; lido: CertificadoLido; rotulo: string };

/** Converte erro de certificado em erro da API (422) com mensagem amigável. */
export function erroCertificadoApi(e: unknown): unknown {
  if (e instanceof ErroCertificado) return invalido(e.message, e.details);
  return e;
}

/** Decifra e abre o .pfx de um registro (em memória). */
export function abrirCertificado(reg: Pick<CertificadoDigital, "pfx_cifrado" | "senha_cifrada">, agora = new Date(), ignorarValidade = false): CertificadoLido {
  let pfx: Buffer;
  let senha: string;
  try {
    pfx = Buffer.from(decifrar(reg.pfx_cifrado) ?? "", "base64");
    senha = decifrar(reg.senha_cifrada) ?? "";
  } catch {
    throw new ErroCertificado("Não foi possível decifrar o certificado armazenado (a chave DATA_KEY mudou?). Reenvie o certificado.");
  }
  return lerCertificado(pfx, senha, { agora, ignorarValidade });
}

/**
 * Certificado aplicável a um documento emitido por `usuarioId` no município: e-CPF do servidor → e-CNPJ do órgão →
 * e-CNPJ da organização. Somente ativos e dentro da validade. Falha ao ABRIR um certificado válido (senha/DATA_KEY)
 * lança erro claro – a emissão é interrompida em vez de gerar documento sem a assinatura esperada.
 */
export async function certificadoParaEmissao(municipioId: string, usuarioId: string | null, agora = new Date()): Promise<CertificadoEmissao | null> {
  const mun = await prisma.municipio.findUnique({ where: { id: municipioId }, select: { organizacao_id: true } });
  if (!mun?.organizacao_id) return null;
  const org = mun.organizacao_id;
  const vigente = { ativo: true, organizacao_id: org, valido_de: { lte: agora }, valido_ate: { gte: agora } };
  const candidatos = await prisma.certificadoDigital.findMany({
    where: {
      ...vigente,
      OR: [
        ...(usuarioId ? [{ titular: "USUARIO" as const, usuario_id: usuarioId }] : []),
        { titular: "ORGAO" as const, municipio_id: municipioId },
        { titular: "ORGAO" as const, municipio_id: null },
      ],
    },
    orderBy: { created_at: "desc" },
  });
  const ordem = (c: CertificadoDigital) => (c.titular === "USUARIO" ? 0 : c.municipio_id ? 1 : 2);
  const escolhido = candidatos.sort((x, y) => ordem(x) - ordem(y))[0];
  if (!escolhido) return null;
  try {
    const lido = abrirCertificado(escolhido, agora);
    return { registro: escolhido, lido, rotulo: rotuloTipoCertificado(lido.tipo_documento, escolhido.titular) };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : "erro desconhecido";
    throw invalido(
      `Não foi possível usar o certificado digital de ${escolhido.nome_titular} para assinar o documento: ${motivo} ` +
        `Corrija-o em Administração → Certificados digitais (ou desative-o para emitir com assinatura eletrônica avançada).`,
    );
  }
}

/** Assina o PDF com o certificado selecionado (erro claro se falhar – o documento não é emitido). */
export async function assinarComCertificado(pdf: Buffer, c: CertificadoEmissao, o: { motivo: string; local: string; contato: string; quando: Date }): Promise<Buffer> {
  try {
    return await assinarPdf(pdf, c.lido, { motivo: o.motivo, local: o.local, nome: c.lido.nome, contato: o.contato, quando: o.quando });
  } catch (e) {
    console.error("[assinatura] falha ao assinar PDF", e instanceof Error ? e.message : "erro");
    throw invalido(`Falha ao assinar digitalmente o documento com o certificado de ${c.registro.nome_titular}. Tente novamente ou verifique o certificado em Administração → Certificados digitais.`);
  }
}

export function tipoAssinatura(c: Pick<CertificadoDigital, "icp_brasil">): AssinaturaTipo {
  return c.icp_brasil ? "ICP_BRASIL" : "CERTIFICADO_TESTE";
}

export function registroAssinaturaDigital(c: CertificadoEmissao, quando: Date): RegistroAssinatura {
  return {
    tipo: tipoAssinatura(c.registro),
    titular: c.registro.titular,
    tipo_certificado: c.rotulo,
    nome: c.lido.nome,
    documento_mascarado: c.lido.documento ? mascararCpfCnpj(c.lido.documento) : null,
    emissor: c.lido.emissor,
    serial: c.lido.serial,
    valido_ate: c.lido.valido_ate.toISOString(),
    icp_brasil: c.lido.icp_brasil,
    assinado_em: quando.toISOString(),
  };
}

// ───────────── Cadastro (admin e servidor) ─────────────

/** O servidor pode ter e-CPF próprio? (interno que emite documentos; nunca somente leitura/requerente) */
export function podeTerCertificadoProprio(u: UsuarioSessao | null): boolean {
  if (!u || !u.organizacao_id || isSomenteLeitura(u)) return false;
  const interno: UsuarioSessao = { ...u, papeis: u.papeis.filter((p) => p.papel !== "REQUERENTE") };
  return can(interno, "emitir_documento", "documento");
}

export type NovoCertificado = {
  arquivo: File | Buffer | null;
  nomeArquivo?: string | null;
  senha: string;
  titular: TitularCertificado;
  municipio_id?: string | null;
  usuario_id?: string | null;
};

async function bytesArquivo(a: File | Buffer | null): Promise<Buffer> {
  if (!a) return Buffer.alloc(0);
  if (Buffer.isBuffer(a)) return a;
  if (a.size > TAMANHO_MAXIMO_PFX) throw invalido("Arquivo muito grande para um certificado A1 (máximo de 50 KB).", { campo: "arquivo" });
  return Buffer.from(await a.arrayBuffer());
}

/** Campos seguros para auditoria/listagem (sem .pfx, senha nem documento completo). */
function publico(c: CertificadoDigital) {
  return {
    titular: c.titular,
    municipio_id: c.municipio_id,
    usuario_id: c.usuario_id,
    nome_titular: c.nome_titular,
    emissor: c.emissor,
    serial: c.serial,
    thumbprint_sha1: c.thumbprint_sha1,
    valido_de: c.valido_de,
    valido_ate: c.valido_ate,
    icp_brasil: c.icp_brasil,
    ativo: c.ativo,
  };
}

/**
 * Valida (abre com a senha) e grava o certificado cifrado. Um ativo por titular: o anterior do mesmo órgão/servidor é
 * desativado. `u` já autorizado pelo chamador (admin → qualquer titular da SUA organização; servidor → só o próprio e-CPF).
 */
export async function salvarCertificado(u: UsuarioSessao, n: NovoCertificado): Promise<CertificadoDigital> {
  const org = u.organizacao_id;
  if (!org) throw proibido("Seu usuário não está vinculado a uma organização.");
  const nome = (n.nomeArquivo ?? (n.arquivo && !Buffer.isBuffer(n.arquivo) ? n.arquivo.name : "")) || "";
  if (nome && !/\.(pfx|p12)$/i.test(nome)) throw invalido("Envie o arquivo do certificado A1 (.pfx ou .p12).", { campo: "arquivo" });
  if (!n.senha) throw invalido("Informe a senha do certificado.", { campo: "senha" });
  const buf = await bytesArquivo(n.arquivo);

  let municipio_id: string | null = null;
  let usuario_id: string | null = null;
  if (n.titular === "ORGAO") {
    municipio_id = n.municipio_id || null;
    if (municipio_id && !(await prisma.municipio.count({ where: { id: municipio_id, organizacao_id: org } }))) throw naoEncontrado("Município não encontrado.");
  } else if (n.titular === "USUARIO") {
    usuario_id = n.usuario_id || null;
    if (!usuario_id) throw invalido("Selecione o servidor titular do e-CPF.", { campo: "usuario_id" });
    const dono = await prisma.usuario.findFirst({ where: { id: usuario_id, organizacao_id: org, ativo: true }, select: { id: true } });
    if (!dono) throw naoEncontrado("Servidor não encontrado nesta organização.");
  } else throw invalido("Tipo de titular inválido.", { campo: "titular" });

  let lido: CertificadoLido;
  try {
    lido = lerCertificado(buf, n.senha);
  } catch (e) {
    throw erroCertificadoApi(e);
  }
  if (n.titular === "ORGAO" && lido.tipo_documento === "CPF") throw invalido("Este é um e-CPF (pessoa física). Para o órgão use o e-CNPJ da prefeitura/secretaria, ou cadastre-o como certificado de servidor.", { campo: "titular" });
  if (n.titular === "USUARIO" && lido.tipo_documento === "CNPJ") throw invalido("Este é um e-CNPJ (pessoa jurídica). Cadastre-o como certificado do órgão.", { campo: "titular" });

  return prisma.$transaction(async (tx) => {
    const anteriores = await tx.certificadoDigital.findMany({ where: { organizacao_id: org, titular: n.titular, ativo: true, municipio_id, usuario_id } });
    for (const a of anteriores) {
      await tx.certificadoDigital.update({ where: { id: a.id }, data: { ativo: false } });
      await auditar({ usuario_id: u.id, acao: "DESATIVAR_CERTIFICADO", entidade: "certificado_digital", entidade_id: a.id, antes: { ativo: true }, depois: { ativo: false, motivo: "substituído por novo certificado" } }, tx);
    }
    const novo = await tx.certificadoDigital.create({
      data: {
        organizacao_id: org,
        municipio_id,
        usuario_id,
        titular: n.titular,
        pfx_cifrado: cifrar(buf.toString("base64")),
        senha_cifrada: cifrar(n.senha),
        nome_titular: lido.nome,
        documento_titular: lido.documento ? cifrar(lido.documento) : null,
        emissor: lido.emissor,
        serial: lido.serial,
        thumbprint_sha1: lido.thumbprint_sha1,
        valido_de: lido.valido_de,
        valido_ate: lido.valido_ate,
        icp_brasil: lido.icp_brasil,
        ativo: true,
        created_by: u.id,
      },
    });
    await auditar({ usuario_id: u.id, acao: "CADASTRAR_CERTIFICADO", entidade: "certificado_digital", entidade_id: novo.id, depois: { ...publico(novo), documento: lido.documento ? mascararCpfCnpj(lido.documento) : null } }, tx);
    return novo;
  });
}

/** Certificado da organização do usuário (404 fora dela). `proprio`: exige que seja o e-CPF do próprio usuário. */
export async function certificadoDoEscopo(u: UsuarioSessao, id: string, opts: { proprio?: boolean } = {}): Promise<CertificadoDigital> {
  if (!u.organizacao_id || !/^[0-9a-f-]{36}$/i.test(id)) throw naoEncontrado("Certificado não encontrado.");
  const c = await prisma.certificadoDigital.findFirst({ where: { id, organizacao_id: u.organizacao_id, ...(opts.proprio ? { titular: "USUARIO" as const, usuario_id: u.id } : {}) } });
  if (!c) throw naoEncontrado("Certificado não encontrado.");
  return c;
}

export async function desativarCertificado(u: UsuarioSessao, id: string, opts: { proprio?: boolean } = {}): Promise<void> {
  const c = await certificadoDoEscopo(u, id, opts);
  if (!c.ativo) throw invalido("O certificado já está desativado.");
  await prisma.$transaction(async (tx) => {
    await tx.certificadoDigital.update({ where: { id }, data: { ativo: false } });
    await auditar({ usuario_id: u.id, acao: "DESATIVAR_CERTIFICADO", entidade: "certificado_digital", entidade_id: id, antes: { ativo: true }, depois: { ativo: false } }, tx);
  });
}

/** Gera um PDF de amostra assinado com o certificado (para abrir no Adobe/validar.iti.gov.br). Não é documento oficial. */
export async function pdfTesteAssinado(u: UsuarioSessao, c: CertificadoDigital): Promise<Buffer> {
  let lido: CertificadoLido;
  try {
    lido = abrirCertificado(c);
  } catch (e) {
    throw erroCertificadoApi(e);
  }
  const agora = new Date();
  const amostra = await pdfDeTeste(`${lido.nome} (${rotuloTipoCertificado(lido.tipo_documento, c.titular)}${lido.icp_brasil ? ", ICP-Brasil" : ", certificado de teste"})`, agora, [
    `Emissor: ${lido.emissor}`,
    `Válido até: ${lido.valido_ate.toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}`,
    `Solicitado por: ${u.nome}`,
  ]);
  const pdf = await assinarPdf(amostra, lido, { motivo: "Teste de assinatura digital (sem valor legal)", local: "LicenciaGov", nome: lido.nome, quando: agora });
  await auditar({ usuario_id: u.id, acao: "TESTAR_CERTIFICADO", entidade: "certificado_digital", entidade_id: c.id, depois: { thumbprint_sha1: c.thumbprint_sha1 } });
  return pdf;
}

