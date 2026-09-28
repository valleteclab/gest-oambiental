# Mapas – camadas, chaves e licenças

Componente: `components/mapa` (`<Mapa>`, `<CompararImagens>`). Catálogo único das camadas: `lib/geo/camadas.ts`.
Rotas: `GET /api/v1/mapas/config`, `GET /api/v1/mapas/car?lat=&lng=[&uf=]`, `GET /api/v1/mapas/limite/{codigo_ibge}`.

## Camadas

| Camada | Tipo | Endereço | Teste 28/09/2026 |
|---|---|---|---|
| Satélite (Esri) – **padrão** | XYZ | `server.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}` (nativo até z17; z18+ no oeste baiano devolve "Map data not yet available") | OK |
| Mapa (OpenStreetMap) | XYZ | `tile.openstreetmap.org/{z}/{x}/{y}.png` | OK |
| Rótulos (Esri) | XYZ (sobreposição) | `.../Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}` | OK |
| Google Satélite / Híbrido / Ruas | Maps JavaScript API + `leaflet.gridlayer.googlemutant` | só com `GOOGLE_MAPS_KEY` | – |
| CAR – imóveis rurais | WMS | `https://geoserver.car.gov.br/geoserver/sicar/wms`, `sicar:sicar_imoveis_{uf}`, estilo `line` (contornos), zoom ≥ 11 | OK (WMS, WFS e GetFeatureInfo) |
| SIGEF – parcelas certificadas | WMS (i3Geo) | `https://acervofundiario.incra.gov.br/i3geo/ogc.php?tema=certificada_sigef_particular_{uf}` | **Falhou** (conexão recusada) – marcada `instavel`, a legenda mostra "Serviço do INCRA indisponível" |
| Limite do município | GeoJSON | API de malhas IBGE v3 (`servicodados.ibge.gov.br/api/v3/malhas/municipios/{codigo}`), via `/api/v1/mapas/limite/{codigo}` com cache em memória 24 h. Só para códigos IBGE reais (os da demonstração, `99…`, não existem) | OK |
| Divisas municipais | WMS | `https://geoservicos.ibge.gov.br/geoserver/ows`, `CCAR:BC250_2025_lml_municipio_a` | OK |
| Hidrografia | WMS | idem, `CCAR:BC250_2025_hid_massa_dagua_a,CCAR:BC250_2025_hid_trecho_drenagem_l` | OK |
| PRODES Cerrado | WMS | `https://terrabrasilis.dpi.inpe.br/geoserver/ows`, `prodes-cerrado-nb:yearly_deforestation` | OK |
| DETER Cerrado | WMS | idem, `deter-cerrado-nb:deter_cerrado` (camada pública/anônima) | OK |
| Unidades de Conservação | WMS | `https://geoservicos.inde.gov.br/geoserver/MMA/ows`, `MMA:cnuc_26_07_31` (CNUC jul/2026 – o MMA publica novas versões com outro nome; conferir no GetCapabilities) | OK |
| Áreas embargadas ICMBio | WMS | `https://geoservicos.inde.gov.br/geoserver/ICMBio/ows`, `ICMBio:embargos_icmbio` | OK |
| ANA – hidrografia | – | `metadados.snirh.gov.br/geoserver` → 404; ArcGIS `portal1.snirh.gov.br/server/services/Hidrografia/MapServer/WMSServer` → 400. **Não incluída** (a hidrografia IBGE BC250 cobre o uso). | Falhou |

Sobreposições só são requisitadas quando ligadas pelo usuário e acima do `minZoom`; WMS usam tiles de 512 px (¼ das requisições).
A UF das camadas estaduais vem do código IBGE do município do órgão ativo (`lib/geo/uf.ts`); com código fictício, usa `MAPAS_UF_PADRAO` (padrão `BA`).

`GET /api/v1/mapas/car?lat=&lng=` consulta o WFS do SICAR (`INTERSECTS(geo_area_imovel, POINT(lng lat))`, 1 nova tentativa, depois WMS GetFeatureInfo),
cache em memória de 1 h, tempo limite 12 s → `{uf, imoveis:[{cod_imovel, area_ha, situacao, condicao, tipo, municipio, uf, geometria}]}`; falha → 502 `SERVICO_EXTERNO`.

**Proxy de saída**: o `fetch` do Node não lê `HTTPS_PROXY`. Em ambientes com proxy obrigatório (ex.: container de desenvolvimento), rode o servidor com
`NODE_USE_ENV_PROXY=1` (Node ≥ 22.21); sem isso o SICAR responde 503 via proxy transparente.

## Google Maps (opcional)

- Variável **`GOOGLE_MAPS_KEY`** lida **em tempo de execução** pelo servidor e entregue ao navegador por `/api/v1/mapas/config` (somente a usuários autenticados).
  Não usar `NEXT_PUBLIC_*`: a imagem Docker é construída sem variáveis de ambiente.
- A Maps JavaScript API é carregada só quando há chave e o mapa é interno; se o Google recusar a chave (`gm_authFailure`), as bases Google são removidas e o mapa volta ao Esri.
- A última base escolhida fica no `localStorage` (`lg_mapa_base`).
- **Restrinja a chave**: referenciadores HTTP (`https://seu-dominio/*`) e somente a API "Maps JavaScript API". O Google Maps Platform cobra por carga de mapa
  (há crédito mensal gratuito); configure alertas e cotas no Google Cloud. Os Termos do Google proíbem baixar/armazenar os tiles – o GoogleMutant usa a API oficial.

## Licenças e termos

- **Esri World Imagery / Wayback / Rótulos**: uso sujeito aos Termos de Uso da Esri e atribuição obrigatória ("Esri, Maxar, Earthstar Geographics…").
  Uso **comercial/produção** (sistema contratado por prefeituras) exige conta ArcGIS (ArcGIS Location Platform/Online) e respeito às cotas; verificar o licenciamento antes da implantação.
- **OpenStreetMap**: dados ODbL; os tiles de `tile.openstreetmap.org` seguem a política de uso da OSMF (sem uso intensivo, atribuição, User-Agent/Referer válidos). Para volume alto, usar provedor próprio.
- **Google Maps Platform**: somente com chave própria do contratante, faturamento no projeto Google Cloud dele.
- **Dados governamentais** (CAR/SICAR – SFB; SIGEF – INCRA; IBGE; INPE PRODES/DETER – CC BY-SA 4.0; MMA/CNUC; ICMBio): dados públicos, uso livre com citação da fonte (exibida na legenda e na atribuição).
  O CAR é autodeclaratório – a camada não substitui a análise do técnico.
- **Sentinel-2 cloudless (EOX)**: licença CC BY-NC-SA 4.0 (não comercial) – **não utilizado** (o sistema de referência usava; aqui a comparação antes/depois usa apenas Esri Wayback).

## Comparação antes/depois (ficha da vistoria)

`<CompararImagens lat lng zoom>`: dois mapas sincronizados (lado a lado; empilhados no celular), cada um com a imagem atual ou uma versão do
Esri World Imagery Wayback (`WAYBACK_RELEASES` em `lib/geo/camadas.ts`, conferidas no oeste baiano). A data é a da versão do mosaico, não necessariamente a da captura.
Para atualizar a lista: https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json.

## Desenho e importação de polígonos

`<Mapa editavelPoligono onPoligono={(geojson, areaM2) => …}>`: ferramentas Leaflet-Geoman (polígono/retângulo, editar, apagar) e botão de importação de
KML, KMZ, GeoJSON e Shapefile (.zip) – tudo no navegador (`@tmcw/togeojson`, `jszip`, `shpjs`). Área geodésica com `@turf/area`.
Validação (cliente e servidor): `lib/geo/validar.ts` – Polygon/MultiPolygon, anéis fechados, coordenadas válidas, ≤ 300 KB; Feature/FeatureCollection são convertidos.
