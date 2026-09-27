import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacidadePage() {
  return (
    <article className="mx-auto max-w-3xl space-y-5 text-sm leading-relaxed text-slate-800 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
      <h1 className="titulo-pagina">Política de privacidade</h1>
      <p className="text-slate-600">Última atualização: 27/09/2026.</p>
      <p>
        Esta política explica como o sistema LicenciaGov, utilizado pelos órgãos ambientais municipais e, quando for o caso,
        pelo consórcio público que os reúne, trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 – LGPD)
        e com a Lei de Acesso à Informação (Lei nº 12.527/2011).
      </p>

      <h2>1. Quem é o controlador</h2>
      <p>
        Cada município é controlador dos dados dos processos de licenciamento e fiscalização de sua competência. O consórcio atua como operador e, quando presta o
        serviço de análise técnica, como co-controlador. O contato do encarregado (DPO) de cada município está disponível no próprio órgão ambiental municipal.
      </p>

      <h2>2. Quais dados tratamos</h2>
      <ul>
        <li>Identificação de requerentes, responsáveis técnicos e autuados: nome, CPF/CNPJ, endereço, e-mail e telefone.</li>
        <li>Dados de empreendimentos: localização (coordenadas), atividades, documentos e estudos ambientais apresentados.</li>
        <li>Registros de fiscalização: fotos, coordenadas, relatos, autos de infração e notificações.</li>
        <li>Denúncias: descrição e local; nome e contato apenas se o denunciante optar por se identificar.</li>
        <li>Registros de acesso e de auditoria (data, hora, endereço IP e ações realizadas), exigidos pelo Marco Civil da Internet (Lei nº 12.965/2014).</li>
      </ul>

      <h2>3. Para que usamos (finalidades e bases legais)</h2>
      <ul>
        <li>Executar o licenciamento e a fiscalização ambiental – cumprimento de obrigação legal e execução de políticas públicas (art. 7º, II e III, e art. 23 da LGPD).</li>
        <li>Garantir a autenticidade de documentos oficiais e a transparência ativa dos atos administrativos (Lei nº 10.650/2003 – acesso a informações ambientais).</li>
        <li>Segurança do sistema, prevenção a fraudes e auditoria.</li>
      </ul>

      <h2>4. O que é público no portal</h2>
      <p>
        O portal mostra somente o necessário para a transparência: número e situação do processo, linha do tempo sem despachos internos, e licenças emitidas. Nomes de pessoas
        físicas aparecem abreviados (ex.: “Maria S. O.”) e CPF/CNPJ aparecem mascarados (ex.: ***.456.789-**). E-mails, telefones e anexos nunca são publicados.
      </p>

      <h2>5. Compartilhamento</h2>
      <p>
        Os dados podem ser compartilhados com a SEMA/INEMA (órgãos estaduais do SISNAMA), órgãos de controle (Ministério Público, Tribunal de Contas) e o Poder Judiciário,
        quando exigido por lei. Não vendemos nem cedemos dados para fins comerciais.
      </p>

      <h2>6. Segurança e retenção</h2>
      <p>
        Adotamos criptografia em trânsito (HTTPS) e em repouso para CPF/CNPJ, e-mails e telefones de pessoas físicas; controle de acesso por perfil e por município; trilha
        de auditoria imutável; e backups diários. Os dados são mantidos pelo prazo exigido pelas tabelas de temporalidade de documentos públicos e pela legislação ambiental.
      </p>

      <h2>7. Seus direitos</h2>
      <p>
        Você pode solicitar confirmação de tratamento, acesso, correção de dados incompletos ou desatualizados e informações sobre compartilhamento (art. 18 da LGPD), junto ao
        órgão ambiental do município. Alguns dados não podem ser excluídos por serem necessários ao cumprimento de obrigação legal (ex.: processos e autos de infração).
      </p>

      <h2>8. Cookies</h2>
      <p>Usamos apenas cookies estritamente necessários para manter a sessão de usuários autenticados. Não usamos cookies de publicidade ou rastreamento.</p>

      <p className="pt-4"><Link href="/termos" className="text-primaria-700 underline">Leia também o Termo de uso</Link></p>
    </article>
  );
}
