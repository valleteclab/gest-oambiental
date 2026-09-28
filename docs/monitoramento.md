# Monitoramento por satélite – alertas de desmatamento

Tela `/monitoramento` (menu "Monitoramento"; todos os perfis internos com acesso à fiscalização, SEMA/INEMA somente leitura) e ficha
`/monitoramento/{id}`. Código: `lib/monitoramento/*` (fontes, geo, cruzar e regras são puros e testados em `tests/unit/monitoramento.test.ts`;
provedores, sync e servico acessam rede/banco). Tabelas `alerta_desmatamento` e `monitoramento_sync` (migração `20260928230000_monitoramento_satelite`).

## Fontes (testadas em 28/09/2026)

| Fonte | Serviço | Consulta usada | Atributos | Resultado do teste |
|---|---|---|---|---|
| **DETER Cerrado** (INPE) | WFS `https://terrabrasilis.dpi.inpe.br/geoserver/ows`, camada `deter-cerrado-nb:deter_cerrado` (anônima) | `CQL_FILTER=municipality='RIACHÃO DAS NEVES' AND uf='BA' AND view_date>='AAAA-MM-DD'` (nome em MAIÚSCULAS com acento, como o INPE grava). Se o nome não retornar nada: `BBOX(st_multi,…)` do limite do IBGE + filtro pelo município/centroide | `gid` (id; sufixo `_curr` = tabela corrente, `_hist` = histórica), `classname` (`DESMATAMENTO_CR`), `view_date`, `created_date`, `publish_month`, `areatotalkm`, `areamunkm` (parte no município – usada ×100 = ha), `municipality`, `uf`, `satellite`/`sensor`, geometria MultiPolygon (`st_multi`). **Não há geocódigo IBGE** | OK – 841 alertas em Riachão das Neves (2018–2026); 276 nos últimos 24 meses |
| **PRODES Cerrado** (INPE) | mesmo WFS, camada `prodes-cerrado-nb:yearly_deforestation` | `BBOX(geom,oeste,sul,leste,norte) AND year>=AAAA AND main_class='DESMATAMENTO'`, depois centroide dentro do limite do município (não há atributo de município) | `uuid` (id), `main_class`, `class_name` (`d2025`…), `year`, `image_date`, `area_km`, `state`, `satellite`, `pub_date` | OK – 1.310 polígonos no retângulo (2022–2025) → 293 dentro do município (2024–2025) |
| **Limite do município** (IBGE) | `https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{codigo}?formato=application/vnd.geo%2Bjson` | via `lib/geo/ibge.ts` (cache 24 h) | Polygon | OK (2926202) |
| **CAR** (SICAR) | WFS `https://geoserver.car.gov.br/geoserver/sicar/ows`, `sicar:sicar_imoveis_{uf}` | `INTERSECTS(geo_area_imovel, POLYGON(retângulo do alerta))` (2 tentativas) → senão `POINT(centroide)` | `cod_imovel`, `area`, `status_imovel`, `condicao`, `tipo_imovel`, geometria | OK – ~1 s por alerta |
| **MapBiomas Alerta** (opcional) | GraphQL `https://plataforma.alerta.mapbiomas.org/api/v2/graphql` | `alerts(boundingBox, startDate, endDate, page, limit)` com `Authorization: Bearer $MAPBIOMAS_ALERTA_TOKEN` | `alertCode`, `areaHa`, `detectedAt`, `coordinates`, `boundingBox` (o tipo `Alert` público não traz o polígono → retângulo aproximado) | Sem token: "Token de acesso inválido" (esquema conferido por introspecção). **Não validado com token real** |

Coordenadas: pedimos `srsName=EPSG:4326` (lon/lat). Dados do INPE: CC BY-SA 4.0 (citar INPE/TerraBrasilis). CAR é autodeclaratório.

## Sincronização

- Worker (`jobs/worker.ts`): fila **`monitoramento-sync`**, diária às **06:30** (`JOBS_CRON_MONITORAMENTO`, fuso `JOBS_TZ`, padrão America/Bahia);
  `MONITORAMENTO_DESATIVADO=true` desliga. Avulso: `npm run monitoramento:sync [-- SIGLA|codigo_ibge]`.
- Botão **"Sincronizar agora"** (ADMIN, TEC_CONSORCIO, TEC_MUNICIPAL) – roda em segundo plano no processo web; a tela mostra a última execução
  (`monitoramento_sync`). Uma execução "EXECUTANDO" há < 45 min bloqueia outra no mesmo município.
- Só municípios com **código IBGE real**; os fictícios (`99…`) são ignorados. A demonstração usa alertas FICTÍCIOS de
  `prisma/seed/monitoramento-demo.ts` (chamado por `seed:demo`; avulso `npm run seed:monitoramento-demo`), sem aviso no sino.
- Upsert idempotente por `(fonte, id_externo)`; a situação e o tratamento nunca são sobrescritos. Se a fonte revisar área/data, os dados da fonte são
  atualizados e o cruzamento refeito. DETER que muda de `…_curr` para `…_hist` (mesmo município, data, área ±1% e centroide ~50 m) é reconhecido como o
  mesmo alerta (`dados_fonte.ids_anteriores`).
- Geometria: normalizada (5 casas ≈ 1 m) e simplificada até ≤ 300 KB; centroide em `latitude/longitude`.
- Variáveis: `MONITORAMENTO_DETER_MESES` (24), `MONITORAMENTO_PRODES_ANOS` (2 → anos PRODES ≥ ano atual − 2), `MONITORAMENTO_MAX_CRUZAMENTOS` (800 por
  execução), `MONITORAMENTO_CONCORRENCIA_CAR` (4), `MONITORAMENTO_TIMEOUT_MS` (120000), `MONITORAMENTO_AREA_MINIMA_HA` (1), `MAPBIOMAS_ALERTA_TOKEN`.
- **Proxy**: o `fetch` do Node só usa `HTTPS_PROXY` com `NODE_USE_ENV_PROXY=1` (ver docs/mapas.md).

## Cruzamento e sugestão

Para cada alerta novo/revisado (ou com CAR indisponível): imóveis do CAR com **sobreposição real** (turf `intersect`, ha e % da área do alerta);
empreendimentos do município com o **mesmo nº do CAR** ou cujo polígono/ponto está dentro do alerta; processos e licenças/autorizações deles.
Nas sincronizações seguintes, os alertas NOVO/EM_ANALISE recalculam só a parte local (licenças novas mudam a sugestão sem nova consulta ao SICAR).

Sugestão (`status_sugerido`, nunca aplicada automaticamente – `lib/monitoramento/regras.ts#sugerirStatus`):
`AUTORIZADO` (ASV/AA/LI/LU/LAC/LS/LO/RLO **VÁLIDA**, emitida até a data da detecção e vigente nela – ASV tem prioridade) ·
`POSSIVEL_IRREGULAR` (em imóvel do CAR ou empreendimento local sem autorização) · `SEM_CAR` · `INDETERMINADO` (SICAR fora do ar).
**Autorizações estaduais (INEMA/SEIA) não estão no sistema** – "possível irregularidade" exige conferência.

Aviso no sino (tipo `DESMATAMENTO`): técnicos municipais e fiscais do município + técnicos do consórcio da organização, para alertas NOVOS com área ≥
`MONITORAMENTO_AREA_MINIMA_HA`; um aviso por alerta, ou um resumo por sincronização quando houver vários.

## Tratamento (ficha)

Situações: NOVO → EM_ANALISE → AUTORIZADO (exige vincular licença/ASV válida do município) | IRREGULAR (exige constatação) | DESCARTADO (exige motivo);
finalizados podem ser reabertos (EM_ANALISE). "Abrir fiscalização" cria a vistoria **AGENDADA**, origem ROTINA, no centroide, vinculada ao alerta e ao
empreendimento relacionado pelo CAR (o alerta NOVO passa a EM_ANÁLISE). Tudo auditado (`MONITORAMENTO_*`, `CRIAR fiscalizacao`).
Escopo: `whereMunicipio()`/`podeVerMunicipio()` – URL de alerta fora do escopo → 403. Exportação por organização: regra por `municipio_id` nas duas tabelas.

## Resultado real – Riachão das Neves (2926202), 28/09/2026

DETER: 276 alertas (últimos 24 meses) · PRODES: 293 polígonos (2024–2025) · 569 cruzados com o SICAR em ~40 s (0 falhas), **539 com imóvel do CAR**
(272 DETER + 267 PRODES → possível irregularidade), 30 fora do CAR. Nenhum autorizado: as licenças do cliente de demonstração têm CAR fictício.
Segunda execução: 0 novos, 0 atualizados (idempotente).
