// Lista de certificados digitais (A1) – usada em /admin/certificados e /minha-conta/certificado.
// Recebe só campos públicos (nunca .pfx/senha/documento).
import { Badge, PontoSemaforo, Vazio } from "@/components/ui";
import { fmtData } from "@/lib/format";
import { diasParaVencer, situacaoCertificado, type SituacaoCertificado } from "@/lib/assinatura/certificado";
import { FormAdmin, type EstadoForm } from "@/app/(interno)/admin/_comp/form-admin";

export type CertificadoLista = {
  id: string;
  titular: "ORGAO" | "USUARIO";
  nome_titular: string;
  emissor: string;
  serial: string;
  thumbprint_sha1: string;
  valido_de: Date;
  valido_ate: Date;
  icp_brasil: boolean;
  ativo: boolean;
  municipio: { nome: string } | null;
  usuario: { nome: string } | null;
};

const SEMAFORO: Record<SituacaoCertificado, "verde" | "amarelo" | "vermelho" | "cinza"> = { VALIDO: "verde", VENCENDO: "amarelo", VENCIDO: "vermelho", FUTURO: "cinza", INATIVO: "cinza" };

export function textoValidade(c: { valido_de: Date; valido_ate: Date; ativo: boolean }, agora = new Date()): string {
  const s = situacaoCertificado(c, agora);
  const d = diasParaVencer(c.valido_ate, agora);
  if (s === "VENCIDO") return `vencido em ${fmtData(c.valido_ate)}`;
  if (s === "FUTURO") return `válido a partir de ${fmtData(c.valido_de)}`;
  return `até ${fmtData(c.valido_ate)} – ${d <= 0 ? "vence hoje" : `vence em ${d} dia(s)`}`;
}

export function ListaCertificados({ itens, desativar, testar = true }: { itens: CertificadoLista[]; desativar?: (e: EstadoForm, f: FormData) => Promise<EstadoForm>; testar?: boolean }) {
  if (itens.length === 0) return <Vazio>Nenhum certificado cadastrado. Sem certificado, os documentos saem com assinatura eletrônica avançada (Lei 14.063/2020).</Vazio>;
  const agora = new Date();
  return (
    <ul className="divide-y divide-slate-100" data-testid="lista-certificados">
      {itens.map((c) => {
        const s = situacaoCertificado(c, agora);
        return (
          <li key={c.id} className="flex flex-col gap-3 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2">
                <PontoSemaforo s={c.ativo ? SEMAFORO[s] : "cinza"} titulo={c.ativo ? textoValidade(c, agora) : "Inativo"} />
                <span className="break-words font-semibold text-slate-900">{c.nome_titular}</span>
                {c.icp_brasil ? <Badge cor="verde">ICP-Brasil</Badge> : <Badge cor="amarelo">Certificado de teste</Badge>}
                <Badge cor="azul">{c.titular === "ORGAO" ? "e-CNPJ do órgão" : "e-CPF do servidor"}</Badge>
                {!c.ativo && <Badge cor="cinza">Inativo</Badge>}
                {c.ativo && s === "VENCIDO" && <Badge cor="vermelho">Vencido – não é usado</Badge>}
                {c.ativo && s === "VENCENDO" && <Badge cor="amarelo">Vence em breve</Badge>}
              </p>
              <p className="text-slate-600">
                {c.titular === "ORGAO" ? (c.municipio ? `Órgão: ${c.municipio.nome}` : "Todos os órgãos da organização") : `Servidor: ${c.usuario?.nome ?? "—"}`}
                {" · "}Validade: {textoValidade(c, agora)}
              </p>
              <p className="break-all text-xs text-slate-500">
                Emissor: {c.emissor} · Série: {c.serial} · SHA-1: {c.thumbprint_sha1}
              </p>
            </div>
            {c.ativo && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {testar && s !== "VENCIDO" && (
                  <a className="btn-secundario btn-sm" href={`/api/v1/certificados/${c.id}/teste`} download>
                    Testar assinatura
                  </a>
                )}
                {desativar && (
                  <FormAdmin action={desativar} inline botao="Desativar" classeBotao="btn-perigo" confirmar={`Desativar o certificado de ${c.nome_titular}? Os próximos documentos não serão assinados com ele.`} rotuloAcessivel={`Desativar certificado de ${c.nome_titular}`}>
                    <input type="hidden" name="id" value={c.id} />
                  </FormAdmin>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
