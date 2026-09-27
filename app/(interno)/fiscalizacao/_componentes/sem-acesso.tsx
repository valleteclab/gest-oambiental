import { forbidden } from "next/navigation";

/** Acesso negado (403 real) – registro fora do escopo do usuário. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SemAcesso(_props: { mensagem?: string }): never {
  forbidden();
}
