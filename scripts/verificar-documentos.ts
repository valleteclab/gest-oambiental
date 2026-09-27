// Verificação manual do módulo de documentos (não faz parte do app): emite LICENÇA de teste, valida e cancela.
// Uso: npx tsx --conditions=react-server scripts/verificar-documentos.ts [--limpar]
import "dotenv/config";
import { prisma } from "@/lib/db";
import { cifrar, hashBusca } from "@/lib/crypto";
import { emitirDocumento, cancelarDocumento } from "@/lib/documentos";
import { lerArquivo } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";

const DOC = "39053344705"; // CPF de teste válido
const TAG = "[TESTE-DOCUMENTOS]";

async function main() {
  const itb = await prisma.municipio.findUniqueOrThrow({ where: { sigla: "ITB" } });
  const gestorU = await prisma.usuario.findUniqueOrThrow({ where: { email: "gestor.itb@licenciagov.demo" }, include: { papeis: true } });
  const gestor = { id: gestorU.id, nome: gestorU.nome, email: gestorU.email, cargo: gestorU.cargo, pessoa_id: null, trocar_senha: false, papeis: gestorU.papeis.map((p) => ({ papel: p.papel, municipio_id: p.municipio_id })) };
  const tipologia = await prisma.tipologia.findFirstOrThrow();
  const lo = await prisma.tipoAto.findFirstOrThrow({ where: { sigla: "LO" } });
  const h = hashBusca(DOC);
  const pessoa = (await prisma.pessoa.findUnique({ where: { cpf_cnpj_hash: h } })) ?? (await prisma.pessoa.create({
    data: { tipo: "PF", cpf_cnpj_cifrado: cifrar(DOC), cpf_cnpj_hash: h, cpf_cnpj_mascara: "***.533.447-**", nome: `José da Silva Teste ${TAG}`, municipio_id: itb.id, organizacao_id: itb.organizacao_id, endereco: { logradouro: "Rua Teste", numero: "1", cidade: "Itaberaba", uf: "BA" } },
  }));
  const emp = (await prisma.empreendimento.findFirst({ where: { nome: { contains: TAG } } })) ?? (await prisma.empreendimento.create({
    data: { organizacao_id: itb.organizacao_id, municipio_id: itb.id, requerente_id: pessoa.id, nome: `Laticínio Teste ${TAG}`, tipologia_id: tipologia.id, porte: "PEQUENO", potencial_poluidor: "MEDIO", latitude: -12.5275, longitude: -40.3067, endereco: { logradouro: "Rodovia BA-046", numero: "km 3", cidade: "Itaberaba", uf: "BA" } },
  }));
  const numero = `ITB-2026-9${String(Date.now()).slice(-5)}`;
  const proc = await prisma.processo.create({
    data: { organizacao_id: itb.organizacao_id, municipio_id: itb.id, numero, empreendimento_id: emp.id, requerente_id: pessoa.id, tipo_ato_id: lo.id, status: "DEFERIDO", data_protocolo: new Date(), descricao_atividade: `Beneficiamento de leite ${TAG}` },
  });
  await prisma.condicionante.createMany({ data: [
    { processo_id: proc.id, descricao: "Apresentar relatório semestral de monitoramento de efluentes <script>x</script>", periodicidade: "Semestral" },
    { processo_id: proc.id, descricao: "Manter sistema de tratamento de efluentes em operação" },
  ] });
  await prisma.tramitacao.create({ data: { processo_id: proc.id, acao: "protocolar", para_status: "PROTOCOLADO", despacho: "DESPACHO INTERNO SECRETO" } });
  await prisma.tramitacao.create({ data: { processo_id: proc.id, acao: "deferir", de_status: "AGUARDANDO_DECISAO", para_status: "DEFERIDO", despacho: "deferido interno" } });

  console.time("emitir");
  const doc = await emitirDocumento({ tipo: "LICENCA", municipio_id: itb.id, processo_id: proc.id, sigla_ato: "LO", dados: { observacoes: "Teste <b>escape</b>" }, usuario: gestor });
  console.timeEnd("emitir");
  const pdf = await lerArquivo(doc.storage_key);
  console.log({ numero: doc.numero, codigo: doc.codigo_verificador, validade: doc.validade_ate, pdfHead: pdf.subarray(0, 5).toString(), tamanho: pdf.length, hashOk: sha256(pdf) === doc.sha256_pdf, processo: numero });
  const conds = await prisma.condicionante.count({ where: { documento_id: doc.id } });
  console.log("condicionantes vinculadas:", conds);
  const ai = await emitirDocumento({ tipo: "AUTO_INFRACAO", municipio_id: itb.id, titular_id: pessoa.id, dados: { descricao_infracao: "Lançamento de efluentes", enquadramento_legal: "Art. 62 Dec. 6.514/2008", penalidade: "MULTA", valor_multa: 5000 }, usuario: gestor });
  console.log("auto:", ai.numero, ai.codigo_verificador);
  const rec = await emitirDocumento({ tipo: "RECIBO", municipio_id: itb.id, processo_id: proc.id, dados: {}, usuario: gestor });
  console.log("recibo:", rec.numero);
  for (const t of ["CERTIDAO", "PARECER", "NOTIFICACAO", "OFICIO", "AUTORIZACAO"] as const) {
    const d = await emitirDocumento({ tipo: t, municipio_id: itb.id, processo_id: proc.id, sigla_ato: t === "AUTORIZACAO" ? "AA" : t === "CERTIDAO" ? "CERT_DISP" : null, dados: { texto: "Texto livre", exigencia: "Apresentar outorga", prazo_dias: 30, motivo: "Documentação insuficiente" }, usuario: gestor });
    console.log(t, d.numero, d.codigo_verificador);
    if (process.argv.includes("--salvar")) require("node:fs").writeFileSync(`${process.env.SCRATCH ?? "/tmp"}/${t}.pdf`, await lerArquivo(d.storage_key));
  }
  if (process.argv.includes("--salvar")) require("node:fs").writeFileSync(`${process.env.SCRATCH ?? "/tmp"}/LICENCA.pdf`, pdf);
  if (process.argv.includes("--cancelar")) {
    const c = await cancelarDocumento(doc.id, "Teste de cancelamento", gestor);
    console.log("cancelado:", c.status);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
