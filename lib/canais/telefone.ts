// Normalização de telefones brasileiros para E.164 (somente dígitos, com DDI 55).
// Tolerância ao 9º dígito: números móveis antigos chegam com 8 dígitos (ex.: JIDs do WhatsApp "557599998888");
// a forma CANÔNICA sempre tem o 9 (5575999998888), para que o mesmo cidadão gere o mesmo hash.

const DDD_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * "+55 (75) 99999-8888", "075999998888", "5575999998888@s.whatsapp.net", "7599998888" → "5575999998888".
 * Números estrangeiros (DDI ≠ 55, com "+") são mantidos só com dígitos. Retorna null se não parecer telefone.
 */
export function normalizarTelefone(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  const bruto = String(entrada).split("@")[0].split(":")[0].trim();
  const internacional = bruto.startsWith("+");
  let d = bruto.replace(/\D/g, "");
  if (!d) return null;
  if (internacional && !d.startsWith("55")) return d.length >= 8 && d.length <= 15 ? d : null;
  // prefixo de discagem nacional 0 (+ operadora de 2 dígitos: 0 XX DD NNNN…)
  if (d.startsWith("0")) {
    d = d.replace(/^0+/, "");
    if (d.length === 12 || d.length === 13) {
      // 0 + operadora + DDD + número: remove a operadora
      const semOp = d.slice(2);
      if (DDD_VALIDOS.has(Number(semOp.slice(0, 2))) && (semOp.length === 10 || semOp.length === 11)) d = semOp;
    }
  }
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55") || (d.length !== 12 && d.length !== 13)) return d.length >= 8 && d.length <= 15 && !d.startsWith("55") ? d : null;
  const ddd = Number(d.slice(2, 4));
  if (!DDD_VALIDOS.has(ddd)) return null;
  let numero = d.slice(4);
  // Celular sem o 9º dígito (8 dígitos começando por 6–9) → acrescenta o 9
  if (numero.length === 8 && /^[6-9]/.test(numero)) numero = `9${numero}`;
  if (numero.length === 9 && !numero.startsWith("9")) return null;
  return `55${d.slice(2, 4)}${numero}`;
}

/** Variantes aceitas para o mesmo número (com e sem o 9º dígito) – útil para casar JIDs antigos. */
export function variantesTelefone(e164: string): string[] {
  const n = normalizarTelefone(e164);
  if (!n) return [];
  if (n.startsWith("55") && n.length === 13) return [n, n.slice(0, 4) + n.slice(5)];
  return [n];
}

/** Máscara para exibição: 5575999998888 → (75) 9****-8888. */
export function mascararTelefone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const n = e164.replace(/\D/g, "");
  if (n.startsWith("55") && n.length >= 12) return `(${n.slice(2, 4)}) ${n.slice(4, 5)}****-${n.slice(-4)}`;
  return `***${n.slice(-4)}`;
}

/** Formatação completa (uso interno, atendente com permissão): 5575999998888 → (75) 99999-8888. */
export function formatarTelefone(e164: string | null | undefined): string {
  if (!e164) return "—";
  const n = e164.replace(/\D/g, "");
  if (n.startsWith("55") && n.length === 13) return `(${n.slice(2, 4)}) ${n.slice(4, 9)}-${n.slice(9)}`;
  if (n.startsWith("55") && n.length === 12) return `(${n.slice(2, 4)}) ${n.slice(4, 8)}-${n.slice(8)}`;
  return `+${n}`;
}
