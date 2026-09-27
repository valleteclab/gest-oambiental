import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Termo de uso" };

export default function TermosPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed text-slate-800 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
      <h1 className="titulo-pagina">Termo de uso</h1>
      <p className="text-slate-600">Última atualização: 27/09/2026.</p>

      <h2>1. Objeto</h2>
      <p>
        O LicenciaGov é o sistema oficial de licenciamento e fiscalização ambiental dos municípios do CDS Piemonte do Paraguaçu. Permite requerer licenças, acompanhar
        processos, consultar licenças emitidas, validar documentos e registrar denúncias ambientais.
      </p>

      <h2>2. Cadastro e responsabilidade</h2>
      <ul>
        <li>O usuário é responsável pela veracidade das informações e documentos enviados, sob as penas da lei (art. 299 do Código Penal e art. 69-A da Lei nº 9.605/1998).</li>
        <li>Login e senha são pessoais e intransferíveis. Ações realizadas com suas credenciais são registradas em seu nome e valem como assinatura eletrônica simples (Lei nº 14.063/2020).</li>
        <li>Comunique imediatamente ao órgão ambiental qualquer uso indevido da sua conta.</li>
      </ul>

      <h2>3. Documentos oficiais</h2>
      <p>
        Licenças, certidões, autos, notificações e demais documentos emitidos pelo sistema possuem código verificador e QR Code. A autenticidade pode ser conferida a qualquer
        momento em <Link href="/validar" className="text-primaria-700 underline">/validar</Link>. Documentos emitidos não são alterados: correções são feitas por cancelamento
        motivado e emissão de documento substituto.
      </p>

      <h2>4. Uso adequado</h2>
      <ul>
        <li>É proibido tentar acessar dados de terceiros, realizar varreduras automatizadas no portal público ou sobrecarregar o serviço.</li>
        <li>Denúncias devem ser feitas de boa-fé. Denunciação caluniosa é crime (art. 339 do Código Penal).</li>
        <li>Arquivos enviados devem estar nos formatos aceitos e livres de códigos maliciosos.</li>
      </ul>

      <h2>5. Prazos e comunicações</h2>
      <p>
        As comunicações oficiais (pendências, decisões, notificações) são feitas pelo sistema e por e-mail cadastrado. Os prazos são contados conforme a legislação e
        indicados em cada ato. Mantenha seu e-mail atualizado e acompanhe seus processos.
      </p>

      <h2>6. Disponibilidade</h2>
      <p>O serviço busca disponibilidade mínima de 99% ao mês. Indisponibilidades programadas serão informadas previamente sempre que possível.</p>

      <h2>7. Privacidade</h2>
      <p>O tratamento de dados pessoais segue a <Link href="/privacidade" className="text-primaria-700 underline">Política de privacidade</Link> e a LGPD.</p>

      <h2>8. Foro</h2>
      <p>Fica eleito o foro da comarca do município responsável pelo processo para dirimir questões relativas a este termo.</p>
    </article>
  );
}
