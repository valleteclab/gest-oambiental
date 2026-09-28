// PDF mínimo (pdf-lib, sem Chromium) usado no botão "Testar assinatura" do admin/servidor e nos testes unitários.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function pdfDeTeste(titular: string, quando: Date, linhasExtras: string[] = []): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle("Teste de assinatura digital – LicenciaGov");
  doc.setProducer("LicenciaGov");
  doc.setCreationDate(quando);
  const page = doc.addPage([595.28, 841.89]);
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const negrito = await doc.embedFont(StandardFonts.HelveticaBold);
  const quandoTxt = quando.toLocaleString("pt-BR", { timeZone: "America/Bahia", dateStyle: "short", timeStyle: "short" });
  // WinAnsi: sem caracteres fora do Latin-1 (travessão vira hífen)
  const latin1 = (s: string) => s.replace(/[–—]/g, "-").replace(/[^\x20-\xFF]/g, "?");
  page.drawText("DOCUMENTO DE TESTE DE ASSINATURA DIGITAL", { x: 56, y: 770, size: 15, font: negrito, color: rgb(0.02, 0.37, 0.27) });
  const linhas = [
    "Este arquivo foi gerado pelo LicenciaGov apenas para testar o certificado digital cadastrado.",
    "Não é documento oficial e não produz efeitos.",
    "",
    `Certificado: ${titular}`,
    `Gerado em: ${quandoTxt}`,
    ...linhasExtras,
    "",
    "Abra este PDF no Adobe Acrobat Reader (painel Assinaturas) ou envie-o para",
    "https://validar.iti.gov.br para conferir a assinatura.",
  ];
  linhas.forEach((l, i) => page.drawText(latin1(l), { x: 56, y: 730 - i * 18, size: 11, font: fonte, color: rgb(0.1, 0.1, 0.1) }));
  return Buffer.from(await doc.save());
}
