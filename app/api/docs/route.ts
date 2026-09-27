export const dynamic = "force-static";

// Visualizador da documentação (Swagger UI via cdn.jsdelivr.net) – SPEC 12
const SWAGGER = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LicenciaGov – API v1</title>
  <link rel="stylesheet" href="${SWAGGER}/swagger-ui.css" />
  <style>body{margin:0;background:#fff}.topbar{display:none}header{padding:12px 16px;background:#14532d;color:#fff;font:600 16px system-ui,sans-serif}header a{color:#bbf7d0}</style>
</head>
<body>
  <header>LicenciaGov – API REST <code>/api/v1</code> · <a href="/api/docs/openapi.json">openapi.json</a></header>
  <div id="swagger-ui"></div>
  <noscript><p style="padding:16px">Ative o JavaScript ou baixe o documento em <a href="/api/docs/openapi.json">/api/docs/openapi.json</a>.</p></noscript>
  <script src="${SWAGGER}/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/docs/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      persistAuthorization: true,
      docExpansion: "none",
      tryItOutEnabled: false,
    });
  </script>
</body>
</html>`;

export function GET() {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
