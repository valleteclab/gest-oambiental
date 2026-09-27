import Link from "next/link";

export default function Inicio() {
  const atalhos = [
    { href: "/consulta", t: "Consultar processo", d: "Acompanhe a situação pelo número do processo." },
    { href: "/licencas", t: "Licenças emitidas", d: "Transparência: licenças e autorizações concedidas." },
    { href: "/validar", t: "Validar documento", d: "Confira a autenticidade pelo código ou QR Code." },
    { href: "/denuncia", t: "Denúncia ambiental", d: "Informe uma irregularidade (anônima, se preferir)." },
    { href: "/login", t: "Área do requerente", d: "Solicite licenças e acompanhe seus processos." },
  ];
  return (
    <div>
      <h1 className="text-3xl font-bold text-primaria-800">Licenciamento e Fiscalização Ambiental</h1>
      <p className="mt-2 max-w-2xl text-slate-600">Portal dos municípios do CDS Piemonte do Paraguaçu: Iaçu, Ibiquera, Itaberaba, Itatim, Mundo Novo, Rafael Jambeiro, Ruy Barbosa e Tapiramutá.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {atalhos.map((a) => (
          <Link key={a.href} href={a.href} className="card p-5 transition hover:border-primaria-600 hover:shadow">
            <h2 className="font-semibold text-primaria-700">{a.t}</h2>
            <p className="mt-1 text-sm text-slate-600">{a.d}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
