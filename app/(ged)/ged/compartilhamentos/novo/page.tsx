import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { Aviso, CabecalhoPagina, Card } from "@/components/ui";
import { FormCompartilhar } from "@/components/ged/compartilhamento/form-compartilhar";
import { ErroApi } from "@/lib/http";
import { exigirGed } from "@/lib/ged/escopo";
import { podeCompartilhar } from "@/lib/ged/papeis";
import { prepararCompartilhamento } from "@/lib/ged/compartilhamento/servico";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compartilhar – Gestão de Documentos" };

export default async function PaginaNovoCompartilhamento({ searchParams }: { searchParams: Promise<{ documento?: string; pasta?: string }> }) {
  const ctx = await exigirGed();
  if (!podeCompartilhar(ctx)) forbidden();
  const sp = await searchParams;
  const alvo = sp.documento ? ({ tipo: "documento", id: sp.documento } as const) : sp.pasta ? ({ tipo: "pasta", id: sp.pasta } as const) : null;
  if (!alvo || !/^[0-9a-f-]{36}$/i.test(alvo.id)) notFound();
  let p;
  try {
    p = await prepararCompartilhamento(ctx, alvo);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 403) forbidden();
    if (e instanceof ErroApi) notFound();
    throw e;
  }
  const voltar = alvo.tipo === "documento" ? `/ged/documentos/${alvo.id}` : `/ged/pastas?pasta=${alvo.id}`;
  return (
    <>
      <CabecalhoPagina
        titulo={`Compartilhar ${alvo.tipo === "documento" ? "documento" : "pasta"}`}
        subtitulo={<><Link href={voltar} prefetch={false} className="underline">Voltar</Link> · link público protegido por código no WhatsApp</>}
        acoes={<Link href={`/ged/compartilhamentos?recurso_id=${alvo.id}`} prefetch={false} className="btn-secundario">Links deste {alvo.tipo === "documento" ? "documento" : "pasta"}</Link>}
      />
      <Card className="max-w-3xl" titulo={<span className="break-words" data-testid="compartilhar-rotulo">{p.rotulo}</span>}>
        <div className="mb-4 space-y-2 text-sm text-slate-600">
          <p>Quem receber o link abre a página, mas só vê os arquivos depois de digitar um <strong>código de 6 dígitos enviado ao WhatsApp que você informar aqui</strong>. Todo acesso é registrado e você acompanha tudo em Compartilhamentos.</p>
          {alvo.tipo === "pasta" && <p>O destinatário vê só o que <strong>você pode ver</strong> na hora do acesso, nesta pasta e subpastas, sem documentos sigilosos nem com dados pessoais{p.documentos_agora !== null ? ` (hoje: ${p.documentos_agora} documento(s))` : ""}.</p>}
        </div>
        {p.bloqueio && <Aviso tipo="erro">{p.bloqueio}</Aviso>}
        {!p.bloqueio && !p.canal.ok && <Aviso tipo="alerta">Não é possível criar o link: {p.canal.motivo}</Aviso>}
        {!p.bloqueio && p.canal.ok && (
          <FormCompartilhar tipo={alvo.tipo} id={alvo.id} exigeConfirmacao={p.exige_confirmacao} validadePadrao={p.config.validade_padrao_dias} validadeMax={p.config.validade_max_dias} notificarPadrao={p.config.notificar_acesso} />
        )}
      </Card>
    </>
  );
}
