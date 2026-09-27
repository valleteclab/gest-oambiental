import { transicionar } from "@/lib/processo/transicionar";
import { carregarUsuario } from "@/lib/auth";
(async () => {
  const u = (await carregarUsuario("9627fc0a-31d2-451e-a7cb-ef56e5afcbae"))!;
  const r = await transicionar("43e2ff83-4ae1-4cac-bb86-99cec7911dc7", "deferir", { despacho: "Defiro (teste de falha)" }, u);
  console.log(JSON.stringify(r));
  process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
  process.exit(0);
})();
