import Link from "next/link";
import { exigirUsuario } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { AcessoNegado } from "@/components/acesso-negado";
import { CabecalhoPagina } from "@/components/ui";

export const metadata = { title: "Administração – LicenciaGov" };

const SECOES = [
  { href: "/admin/municipios", titulo: "Municípios", desc: "Dados, brasão, distribuição automática, delegação de decisão, ativação." },
  { href: "/admin/usuarios", titulo: "Usuários e papéis", desc: "Criar usuários, papéis por município, ativar/desativar, redefinir senha." },
  { href: "/admin/tipos-ato", titulo: "Tipos de ato", desc: "Licenças, autorizações, certidões: validade, vistoria, parecer, prazos." },
  { href: "/admin/tipologias", titulo: "Tipologias", desc: "Atividades, faixas de porte e potencial poluidor; importação CSV." },
  { href: "/admin/documentos-exigidos", titulo: "Documentos exigidos", desc: "Lista de documentos por tipo de ato (e tipologia)." },
  { href: "/admin/checklists", titulo: "Checklists", desc: "Modelos de checklist de análise." },
  { href: "/admin/prazos", titulo: "Prazos", desc: "Prazos por etapa, alertas e dias úteis; exceções por município." },
  { href: "/admin/feriados", titulo: "Feriados", desc: "Feriados nacionais/estaduais e municipais para contagem de dias úteis." },
  { href: "/admin/modelos", titulo: "Modelos de documento", desc: "Modelos HTML de licença, certidão, auto, notificação – com versões." },
  { href: "/admin/auditoria", titulo: "Log de auditoria", desc: "Quem fez o quê e quando, com dados antes/depois." },
  { href: "/admin/emails", titulo: "Caixa de e-mails", desc: "E-mails enviados pelo sistema (caixa de teste)." },
  { href: "/admin/canais", titulo: "Canais de atendimento", desc: "WhatsApp, chat do site e e-mail do assistente de denúncias; webhooks, QR Code e consumo de IA." },
  { href: "/admin/backup", titulo: "Backup", desc: "Último backup e último teste de restauração." },
];

export default async function PaginaAdmin() {
  const u = await exigirUsuario({ interno: true });
  const admin = can(u, "configurar", "admin");
  const exporta = can(u, "exportar", "exportacao");
  if (!admin && !exporta) return <AcessoNegado mensagem="A administração é restrita ao administrador do consórcio." />;
  const itens = [...(admin ? SECOES : []), ...(exporta ? [{ href: "/admin/exportar", titulo: "Exportação completa", desc: "ZIP com CSV/JSON por tabela, anexos e manifest (formato aberto)." }] : [])];
  return (
    <>
      <CabecalhoPagina titulo="Administração" subtitulo={admin ? "Configurações do consórcio e dos municípios" : "Portabilidade de dados"} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {itens.map((s) => (
          <li key={s.href}>
            <Link href={s.href} className="card block h-full p-4 transition hover:border-primaria-600 hover:shadow focus-visible:outline-2 focus-visible:outline-primaria-600">
              <h2 className="font-semibold text-primaria-700">{s.titulo}</h2>
              <p className="mt-1 text-sm text-slate-600">{s.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
