import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

// SPEC 5.8 – numeração sequencial por município/tipo/ano com lock de linha (SELECT ... FOR UPDATE).
type Cliente = Prisma.TransactionClient;

export async function proximoNumero(tx: Cliente, municipioId: string, tipo: string, ano: number): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO sequencia (id, municipio_id, tipo, ano, ultimo)
    VALUES (gen_random_uuid(), ${municipioId}::uuid, ${tipo}, ${ano}, 0)
    ON CONFLICT (municipio_id, tipo, ano) DO NOTHING`;
  const [linha] = await tx.$queryRaw<{ ultimo: number }[]>`
    SELECT ultimo FROM sequencia WHERE municipio_id = ${municipioId}::uuid AND tipo = ${tipo} AND ano = ${ano} FOR UPDATE`;
  const proximo = linha.ultimo + 1;
  await tx.$executeRaw`UPDATE sequencia SET ultimo = ${proximo} WHERE municipio_id = ${municipioId}::uuid AND tipo = ${tipo} AND ano = ${ano}`;
  return proximo;
}

const pad = (n: number, t: number) => String(n).padStart(t, "0");

/** Processo: {SIGLA_MUN}-{ANO}-{000000} */
export async function numeroProcesso(tx: Cliente, municipio: { id: string; sigla: string }, ano = new Date().getFullYear()) {
  return `${municipio.sigla}-${ano}-${pad(await proximoNumero(tx, municipio.id, "PROCESSO", ano), 6)}`;
}

/** Licença/autorização/certidão: {SIGLA_ATO}-{SIGLA_MUN}-{000}/{ANO} */
export async function numeroAto(tx: Cliente, municipio: { id: string; sigla: string }, siglaAto: string, ano = new Date().getFullYear()) {
  return `${siglaAto}-${municipio.sigla}-${pad(await proximoNumero(tx, municipio.id, `ATO_${siglaAto}`, ano), 3)}/${ano}`;
}

/** Auto de infração (AI), notificação (NOT), parecer (PAR), ofício (OF), recibo (REC), denúncia (DEN) */
export async function numeroDocumento(tx: Cliente, municipio: { id: string; sigla: string }, prefixo: "AI" | "NOT" | "PAR" | "OF" | "REC" | "DEN", ano = new Date().getFullYear()) {
  return `${prefixo}-${municipio.sigla}-${pad(await proximoNumero(tx, municipio.id, prefixo, ano), 3)}/${ano}`;
}

export { prisma };
