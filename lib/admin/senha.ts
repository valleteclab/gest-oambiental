import { randomInt } from "node:crypto";

// Senha temporária (política mínima: 10 caracteres – SPEC 4.3). Sem caracteres ambíguos.
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const DIGITOS = "23456789";
const SIMBOLOS = "@#$%&*!";

export function gerarSenhaTemporaria(tamanho = 12): string {
  const todos = LETRAS + DIGITOS + SIMBOLOS;
  const c = [LETRAS[randomInt(LETRAS.length)], DIGITOS[randomInt(DIGITOS.length)], SIMBOLOS[randomInt(SIMBOLOS.length)]];
  while (c.length < Math.max(10, tamanho)) c.push(todos[randomInt(todos.length)]);
  for (let i = c.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c.join("");
}
