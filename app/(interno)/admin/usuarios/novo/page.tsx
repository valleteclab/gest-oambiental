import Link from "next/link";
import { prisma } from "@/lib/db";
import { usuarioAdminPagina } from "@/lib/admin/guard";
import { PAPEIS, PAPEIS_SEM_MUNICIPIO } from "@/lib/admin/usuarios";
import { whereMunicipiosAdmin } from "@/lib/admin/escopo";
import { ROTULO_PAPEL } from "@/lib/rbac";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina, Card } from "@/components/ui";
import { FormAdmin } from "../../_comp/form-admin";
import { Selecao, Texto } from "../../_comp/campos";
import { acaoCriarUsuario } from "../actions";

export const metadata = { title: "Novo usuário – Administração" };

export default async function NovoUsuario() {
  const { u: admin, ok } = await usuarioAdminPagina();
  if (!ok) return <AcessoNegado />;
  const municipios = await prisma.municipio.findMany({ where: { ativo: true, ...whereMunicipiosAdmin(admin) }, orderBy: { nome: "asc" }, select: { id: true, nome: true } });
  return (
    <>
      <CabecalhoPagina titulo="Novo usuário" subtitulo={<Link href="/admin/usuarios" className="underline">Usuários</Link>} />
      <Card>
        <FormAdmin action={acaoCriarUsuario} botao="Criar usuário" limparAoSalvar>
          <div className="grid gap-3 sm:grid-cols-2">
            <Texto name="nome" label="Nome completo" required />
            <Texto name="email" type="email" label="E-mail (login)" required />
            <Texto name="cargo" label="Cargo" />
            <Texto name="cpf" label="CPF (opcional)" inputMode="numeric" dica="Armazenado criptografado." />
            <Selecao name="papel" label="Papel inicial" vazio="(nenhum)" opcoes={PAPEIS.map((p) => ({ valor: p, rotulo: ROTULO_PAPEL[p] }))} />
            <Selecao name="municipio_id" label="Município do papel" vazio="(organização)" opcoes={municipios.map((m) => ({ valor: m.id, rotulo: m.nome }))} />
          </div>
          <p className="text-xs text-slate-600">Papéis de escopo organização (sem município): {PAPEIS_SEM_MUNICIPIO.map((p) => ROTULO_PAPEL[p]).join(", ")}. Os demais exigem município. Uma senha temporária será gerada e a troca é obrigatória no primeiro acesso.</p>
        </FormAdmin>
      </Card>
    </>
  );
}
