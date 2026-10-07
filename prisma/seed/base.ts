// Seed de configuração (idempotente): organização de demonstração, 6 municípios fictícios, tipos de ato, tipologias,
// checklists, prazos, feriados e usuários de demonstração. Executar: npm run seed:base
import { PrismaClient, type Papel } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { cifrar, hashBusca } from "../../lib/crypto";
import { aplicarCatalogo } from "./catalogo";

const prisma = new PrismaClient();
export const SENHA_DEMO = "Demo@2026licencia";

// Municípios FICTÍCIOS de demonstração/teste – não correspondem a municípios reais.
// Códigos "IBGE" começam com 99 (não colidem com códigos reais); coordenadas no interior da Bahia.
export const MUNICIPIOS = [
  { sigla: "LOR", nome: "Lagoa do Orvalho", codigo_ibge: "9900101", lat: -12.4012, lng: -40.1187 },
  { sigla: "SSR", nome: "Serra Serena", codigo_ibge: "9900202", lat: -12.0853, lng: -40.6241 },
  { sigla: "CSE", nome: "Campo das Seriemas", codigo_ibge: "9900303", lat: -12.8461, lng: -40.0527 },
  { sigla: "PCA", nome: "Pedra do Candeeiro", codigo_ibge: "9900404", lat: -12.6218, lng: -39.6235 },
  { sigla: "AUM", nome: "Alto do Umbuzeiro", codigo_ibge: "9900505", lat: -11.7236, lng: -40.5512 },
  { sigla: "VMA", nome: "Várzea do Mandacaru", codigo_ibge: "9900606", lat: -12.3027, lng: -40.8964 },
];

async function main() {
  const org =
    (await prisma.organizacao.findFirst({ where: { sigla: "CID-DEMO" } })) ??
    (await prisma.organizacao.create({ data: { nome: "Consórcio Intermunicipal de Demonstração", sigla: "CID-DEMO", cnpj: "00.000.000/0001-00", logo_url: "/brasao-generico.svg" } }));

  const mun: Record<string, string> = {};
  for (const m of MUNICIPIOS) {
    const r = await prisma.municipio.upsert({
      where: { sigla: m.sigla },
      update: {},
      create: {
        organizacao_id: org.id, sigla: m.sigla, nome: m.nome, codigo_ibge: m.codigo_ibge,
        orgao_ambiental_nome: `Secretaria Municipal de Meio Ambiente de ${m.nome}`, brasao_url: "/brasao-generico.svg",
        endereco: `Praça Central, s/n – ${m.nome}/BA`, email: `meioambiente.${m.sigla.toLowerCase()}@demo.licenciagov.app`, telefone: "(75) 3000-0000",
        latitude: m.lat, longitude: m.lng,
      },
    });
    mun[m.sigla] = r.id;
  }

  // Catálogo-base (tipos de ato, documentos, tipologias, checklist, prazos, feriados nacionais) – ver catalogo.ts
  await aplicarCatalogo(prisma, org.id);

  // Usuários de demonstração (senha: SENHA_DEMO). Nunca rodar em produção de cliente.
  const senha_hash = await hash(SENHA_DEMO, { algorithm: 2 });
  const usuarios: { email: string; nome: string; cargo: string; papeis: [Papel, string | null][] }[] = [
    { email: "admin@licenciagov.demo", nome: "Ana Administradora", cargo: "Coordenadora do Consórcio", papeis: [["ADMIN", null]] },
    { email: "tec.consorcio1@licenciagov.demo", nome: "Bruno Técnico Consórcio", cargo: "Analista Ambiental", papeis: [["TEC_CONSORCIO", null]] },
    { email: "tec.consorcio2@licenciagov.demo", nome: "Carla Técnica Consórcio", cargo: "Analista Ambiental", papeis: [["TEC_CONSORCIO", null]] },
    { email: "sema@licenciagov.demo", nome: "Sérgio SEMA/INEMA", cargo: "Gestor Estadual", papeis: [["SEMA_INEMA", null]] },
  ];
  const nomesMun: Record<string, string> = { LOR: "Lagoa do Orvalho", SSR: "Serra Serena", CSE: "Campo das Seriemas" };
  for (const [sig, nomeMun] of Object.entries(nomesMun)) {
    const s = sig.toLowerCase();
    usuarios.push(
      { email: `tecnico.${s}@licenciagov.demo`, nome: `Técnico(a) de ${nomeMun}`, cargo: "Técnico Ambiental Municipal", papeis: [["TEC_MUNICIPAL", mun[sig]]] },
      { email: `gestor.${s}@licenciagov.demo`, nome: `Gestor(a) de ${nomeMun}`, cargo: "Secretário(a) Municipal de Meio Ambiente", papeis: [["GESTOR_MUNICIPAL", mun[sig]]] },
      { email: `fiscal.${s}@licenciagov.demo`, nome: `Fiscal de ${nomeMun}`, cargo: "Fiscal Ambiental", papeis: [["FISCAL", mun[sig]]] },
    );
  }
  for (const u of usuarios) {
    const reg = await prisma.usuario.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, nome: u.nome, cargo: u.cargo, senha_hash, trocar_senha: false, organizacao_id: org.id },
    });
    // Usuários internos pertencem à organização de demonstração (isolamento por organização).
    if (!reg.organizacao_id) await prisma.usuario.update({ where: { id: reg.id }, data: { organizacao_id: org.id } });
    for (const [papel, municipio_id] of u.papeis) {
      const existe = await prisma.usuarioPapel.findFirst({ where: { usuario_id: reg.id, papel, municipio_id } });
      if (!existe) await prisma.usuarioPapel.create({ data: { usuario_id: reg.id, papel, municipio_id } });
    }
  }

  // 5 requerentes (PF/PJ) com login
  const requerentes = [
    { email: "laticinio@licenciagov.demo", nome: "Laticínio Boa Vista Ltda", tipo: "PJ", doc: "11222333000181", mun: "LOR" },
    { email: "posto@licenciagov.demo", nome: "Posto Estrela Comércio de Combustíveis Ltda", tipo: "PJ", doc: "45723174000110", mun: "SSR" },
    { email: "joao@licenciagov.demo", nome: "João Pereira dos Santos", tipo: "PF", doc: "52998224725", mun: "CSE" },
    { email: "maria@licenciagov.demo", nome: "Maria de Lourdes Oliveira", tipo: "PF", doc: "11144477735", mun: "LOR" },
    { email: "ceramica@licenciagov.demo", nome: "Cerâmica Candeeiro Ltda", tipo: "PJ", doc: "04252011000110", mun: "PCA" },
  ] as const;
  for (const r of requerentes) {
    const h = hashBusca(r.doc);
    const pessoa =
      (await prisma.pessoa.findUnique({ where: { cpf_cnpj_hash: h } })) ??
      (await prisma.pessoa.create({
        data: {
          organizacao_id: org.id, tipo: r.tipo, cpf_cnpj_cifrado: cifrar(r.doc), cpf_cnpj_hash: h,
          cpf_cnpj_mascara: r.tipo === "PF" ? `***.${r.doc.slice(3, 6)}.${r.doc.slice(6, 9)}-**` : `${r.doc.slice(0, 2)}.${r.doc.slice(2, 5)}.${r.doc.slice(5, 8)}/****-**`,
          nome: r.nome, email: r.tipo === "PF" ? cifrar(r.email) : r.email, telefone: r.tipo === "PF" ? cifrar("(75) 99999-0000") : "(75) 3333-0000",
          endereco: { logradouro: "Rua Principal", numero: "100", bairro: "Centro", cidade: MUNICIPIOS.find((m) => m.sigla === r.mun)!.nome, uf: "BA", cep: "46880-000" },
          municipio_id: mun[r.mun],
        },
      }));
    const u = await prisma.usuario.upsert({ where: { email: r.email }, update: {}, create: { email: r.email, nome: r.nome, senha_hash, trocar_senha: false, pessoa_id: pessoa.id } });
    if (!(await prisma.usuarioPapel.findFirst({ where: { usuario_id: u.id, papel: "REQUERENTE" } }))) await prisma.usuarioPapel.create({ data: { usuario_id: u.id, papel: "REQUERENTE" } });
  }

  console.log(`Seed base OK – organização ${org.sigla}, ${MUNICIPIOS.length} municípios, ${usuarios.length + requerentes.length} usuários. Senha demo: ${SENHA_DEMO}`);
}

main().finally(() => prisma.$disconnect());
