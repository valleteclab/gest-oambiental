import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { CAPACIDADES_POR_PAPEL, podeExcluirGed } from "@/lib/ged/papeis";
import {
  LIMITE_SINCRONO_DOCUMENTOS, LIMITE_SINCRONO_PASTAS, MOTIVOS_JURIDICOS, TAMANHO_BLOCO_DOCUMENTOS, ancestraisOuProprias, confirmacaoEsperada, confirmacaoValida, contarMotivos, decidirPlano, emBlocos,
  mensagemBloqueio, modoSincrono, motivosDeBloqueio, ordenarPastasFilhasPrimeiro, ordenarParaExclusao, pastasCriadasPeloLote, pastasRemoviveis, propagarDerivados, textoMotivos,
  type FatosDocumentoExclusao, type MotivoBloqueio,
} from "@/lib/ged/exclusao/regras";

const LIVRE: FatosDocumentoExclusao = {
  status: "PUBLICADO", codigo_verificador: null, tramites: 0, comentarios: 0, solicitacoes: 0, versoes_seladas: 0, versoes_sistema: 0, protocolo_anexos: 0, protocolo_comprovantes: 0, permitido: true,
};
const raiz = path.resolve(__dirname, "../..");

describe("exclusão controlada – impedimentos", () => {
  it("documento comum, sem registro jurídico, pode ser excluído", () => {
    expect(motivosDeBloqueio(LIVRE)).toEqual([]);
    expect(motivosDeBloqueio({ ...LIVRE, status: "RASCUNHO" })).toEqual([]);
    expect(motivosDeBloqueio({ ...LIVRE, status: "ARQUIVADO" })).toEqual([]);
    expect(motivosDeBloqueio({ ...LIVRE, status: "RECUSADO" })).toEqual([]);
  });

  it.each<[string, Partial<FatosDocumentoExclusao>, MotivoBloqueio]>([
    ["trâmite", { tramites: 1 }, "TRAMITE"],
    ["comentário", { comentarios: 2 }, "COMENTARIO"],
    ["solicitação de assinatura (qualquer situação)", { solicitacoes: 1 }, "ASSINATURA"],
    ["em assinatura", { status: "EM_ASSINATURA" }, "ASSINATURA"],
    ["assinado", { status: "ASSINADO" }, "SELADA"],
    ["código verificador", { codigo_verificador: "ABCD-EFGH-JKLM" }, "SELADA"],
    ["versão selada", { versoes_seladas: 1 }, "SELADA"],
    ["selo/comprovante do sistema", { versoes_sistema: 1 }, "SELADA"],
    ["anexo de protocolo", { protocolo_anexos: 1 }, "PROTOCOLO"],
    ["comprovante de protocolo", { protocolo_comprovantes: 1 }, "PROTOCOLO"],
    ["sem permissão", { permitido: false }, "SEM_PERMISSAO"],
  ])("bloqueia: %s", (_n, f, motivo) => {
    expect(motivosDeBloqueio({ ...LIVRE, ...f })).toContain(motivo);
  });

  it("lista todos os motivos juntos e a mensagem diz quantos de cada", () => {
    const m = motivosDeBloqueio({ ...LIVRE, tramites: 3, comentarios: 1, status: "ASSINADO", solicitacoes: 1 });
    expect(m).toEqual(expect.arrayContaining(["TRAMITE", "COMENTARIO", "SELADA", "ASSINATURA"]));
    const c = contarMotivos([{ motivos: m }, { motivos: ["COMENTARIO"] }]);
    expect(c.COMENTARIO).toBe(2);
    expect(c.TRAMITE).toBe(1);
    const msg = mensagemBloqueio(2, c);
    expect(msg).toMatch(/Nada foi excluído/);
    expect(msg).toMatch(/2 documentos não podem ser excluídos/);
    expect(msg).toMatch(/valor jurídico/);
    expect(textoMotivos(["TRAMITE", "TRAMITE"])).toBe("tem histórico de trâmite (registro imutável)");
  });

  it("os motivos jurídicos não incluem permissão nem derivado", () => {
    expect(MOTIVOS_JURIDICOS).toEqual(["ASSINATURA", "SELADA", "PROTOCOLO", "TRAMITE", "COMENTARIO"]);
  });
});

describe("exclusão controlada – derivados (anonimizados)", () => {
  it("original com derivada fora do conjunto fica bloqueado", () => {
    const b = new Map<string, MotivoBloqueio[]>([["o", []]]);
    propagarDerivados(["o"], new Map([["o", ["d"]]]), b);
    expect(b.get("o")).toEqual(["DERIVADO"]);
  });
  it("original e derivada no conjunto: ambas saem", () => {
    const b = new Map<string, MotivoBloqueio[]>([["o", []], ["d", []]]);
    propagarDerivados(["o", "d"], new Map([["o", ["d"]]]), b);
    expect(b.get("o")).toEqual([]);
  });
  it("derivada bloqueada bloqueia a original (em cadeia)", () => {
    const b = new Map<string, MotivoBloqueio[]>([["a", []], ["b", []], ["c", ["COMENTARIO"]]]);
    propagarDerivados(["a", "b", "c"], new Map([["a", ["b"]], ["b", ["c"]]]), b);
    expect(b.get("b")).toEqual(["DERIVADO"]);
    expect(b.get("a")).toEqual(["DERIVADO"]);
  });
  it("derivadas são excluídas antes dos originais", () => {
    const l = ordenarParaExclusao([{ id: "o", documento_original_id: null }, { id: "d", documento_original_id: "o" }, { id: "x", documento_original_id: null }]);
    expect(l.map((x) => x.id)).toEqual(["d", "o", "x"]);
  });
});

describe("exclusão controlada – decisão e confirmação", () => {
  it("tudo-ou-nada recusa qualquer impedimento", () => {
    expect(decidirPlano({ excluiveis: 10, bloqueados: 1, pastas_removiveis: 2 }, false)).toEqual({ ok: false, motivo: "BLOQUEADO" });
    expect(decidirPlano({ excluiveis: 10, bloqueados: 0, pastas_removiveis: 2 }, false)).toEqual({ ok: true });
  });
  it("apenas os que podem: segue se sobrar algo a excluir", () => {
    expect(decidirPlano({ excluiveis: 3, bloqueados: 5, pastas_removiveis: 0 }, true)).toEqual({ ok: true });
    expect(decidirPlano({ excluiveis: 0, bloqueados: 5, pastas_removiveis: 0 }, true)).toEqual({ ok: false, motivo: "NADA_A_EXCLUIR" });
    expect(decidirPlano({ excluiveis: 0, bloqueados: 0, pastas_removiveis: 0 }, false)).toEqual({ ok: false, motivo: "NADA_A_EXCLUIR" });
  });
  it("confirmação: nome da pasta ou EXCLUIR, exata", () => {
    expect(confirmacaoEsperada("PASTA", "Contratos 2026")).toBe("Contratos 2026");
    expect(confirmacaoEsperada("DOCUMENTO", null)).toBe("EXCLUIR");
    expect(confirmacaoEsperada("IMPORTACAO", null)).toBe("EXCLUIR");
    expect(confirmacaoValida("Contratos 2026", " Contratos 2026 ")).toBe(true);
    expect(confirmacaoValida("Contratos 2026", "contratos 2026")).toBe(false);
    expect(confirmacaoValida("EXCLUIR", "")).toBe(false);
    expect(confirmacaoValida("EXCLUIR", undefined)).toBe(false);
    expect(confirmacaoValida("EXCLUIR", 123)).toBe(false);
    expect(confirmacaoValida("", "")).toBe(false);
  });
});

describe("exclusão controlada – pastas, ordem e limites", () => {
  const P = (id: string, parent_id: string | null, profundidade: number) => ({ id, parent_id, profundidade });
  const arvore = [P("r", null, 1), P("a", "r", 2), P("b", "r", 2), P("a1", "a", 3)];

  it("filhas antes das mães", () => {
    const o = ordenarPastasFilhasPrimeiro(arvore).map((p) => p.id);
    expect(o.indexOf("a1")).toBeLessThan(o.indexOf("a"));
    expect(o.indexOf("a")).toBeLessThan(o.indexOf("r"));
    expect(o.indexOf("b")).toBeLessThan(o.indexOf("r"));
  });
  it("pasta ocupada segura as mães, mas não as irmãs", () => {
    const rem = pastasRemoviveis(arvore, new Set(["a1"])).map((p) => p.id);
    expect(rem).toEqual(["b"]);
  });
  it("tudo livre: todas saem, na ordem certa", () => {
    const rem = pastasRemoviveis(arvore, new Set()).map((p) => p.id);
    expect(rem).toHaveLength(4);
    expect(rem[rem.length - 1]).toBe("r");
  });
  it("lote só recolhe pastas criadas a partir do início, abaixo do destino", () => {
    const t0 = new Date("2026-10-11T10:00:00Z");
    const antes = new Date("2026-10-01T10:00:00Z");
    const depois = new Date("2026-10-11T10:05:00Z");
    const pastas = [
      { id: "dest", caminho_ids: ["dest"], created_at: antes },
      { id: "velha", caminho_ids: ["dest", "velha"], created_at: antes }, // já existia: nunca entra
      { id: "nova", caminho_ids: ["dest", "velha", "nova"], created_at: depois },
      { id: "nova2", caminho_ids: ["dest", "nova2"], created_at: depois },
      { id: "fora", caminho_ids: ["fora"], created_at: depois }, // fora do destino
    ];
    expect(pastasCriadasPeloLote(pastas, { id: "dest", caminho_ids: ["dest"] }, t0).sort()).toEqual(["nova", "nova2"]);
    // destino na raiz: qualquer pasta nova entra, mas nunca as anteriores
    expect(pastasCriadasPeloLote(pastas, { id: null, caminho_ids: [] }, t0).sort()).toEqual(["fora", "nova", "nova2"]);
    // nunca o próprio destino nem seus ancestrais, mesmo criados depois
    const novas = [{ id: "pai", caminho_ids: ["pai"], created_at: depois }, { id: "dest2", caminho_ids: ["pai", "dest2"], created_at: depois }, { id: "x", caminho_ids: ["pai", "dest2", "x"], created_at: depois }];
    expect(pastasCriadasPeloLote(novas, { id: "dest2", caminho_ids: ["pai", "dest2"] }, t0)).toEqual(["x"]);
    expect(ancestraisOuProprias([{ caminho_ids: ["a", "b"] }, { caminho_ids: ["a", "c"] }]).sort()).toEqual(["a", "b", "c"]);
  });
  it("blocos e limite síncrono", () => {
    expect(emBlocos([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(emBlocos([], 3)).toEqual([]);
    expect(() => emBlocos([1], 0)).toThrow();
    expect(TAMANHO_BLOCO_DOCUMENTOS).toBeGreaterThan(0);
    expect(modoSincrono(LIMITE_SINCRONO_DOCUMENTOS, LIMITE_SINCRONO_PASTAS)).toBe(true);
    expect(modoSincrono(LIMITE_SINCRONO_DOCUMENTOS + 1, 0)).toBe(false);
    expect(modoSincrono(0, LIMITE_SINCRONO_PASTAS + 1)).toBe(false);
  });
});

describe("exclusão controlada – papel e salvaguardas no código/banco", () => {
  it("capacidade excluir: só Admin e Gestor", () => {
    expect(CAPACIDADES_POR_PAPEL.excluir).toEqual(["GED_ADMIN", "GED_GESTOR"]);
    for (const papel of ["GED_ADMIN", "GED_GESTOR"] as const) expect(podeExcluirGed({ membro: { papel } })).toBe(true);
    for (const papel of ["GED_USUARIO", "GED_LEITOR", "GED_AUDITOR"] as const) expect(podeExcluirGed({ membro: { papel } })).toBe(false);
  });

  it("o código da exclusão não desliga trigger nem usa SQL cru", () => {
    const arquivos = [...readdirSync(path.join(raiz, "lib/ged/exclusao")).map((f) => path.join(raiz, "lib/ged/exclusao", f)), path.join(raiz, "jobs/ged-excluir.ts")];
    expect(arquivos.length).toBeGreaterThanOrEqual(5);
    for (const f of arquivos) {
      const fonte = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      expect(fonte, f).not.toMatch(/session_replication_role|DISABLE\s+TRIGGER|\$queryRaw|\$executeRaw|ALTER\s+TABLE/i);
      expect(fonte, f).not.toMatch(/from "@\/lib\/db"/);
    }
  });

  it("a migração mantém versão selada, selo/comprovante e protocolo indeletáveis e protege o documento", () => {
    const sql = readFileSync(path.join(raiz, "prisma/migrations/20261011120000_ged_exclusao/migration.sql"), "utf8");
    expect(sql).not.toMatch(/DROP\s+TRIGGER\s+ged_(tramite|comentario|assinante)_imutavel/i);
    expect(sql).not.toMatch(/session_replication_role|DISABLE\s+TRIGGER/i);
    expect(sql).toMatch(/IF OLD\.selada OR OLD\.origem IN \('SELO', 'COMPROVANTE'\)/);
    expect(sql).toMatch(/ged_protocolo_documento WHERE versao_id = OLD\.id/);
    expect(sql).toMatch(/CREATE TRIGGER ged_documento_protegido BEFORE DELETE ON ged_documento/);
    expect(sql).toMatch(/OLD\.status = 'ASSINADO' OR OLD\.codigo_verificador IS NOT NULL/);
    expect(sql).toMatch(/ged_exclusao_tenant/);
  });

  it("schema: item de importação REMOVIDO e GedExclusao com organizacao_id", () => {
    const itens = Prisma.dmmf.datamodel.enums.find((e) => e.name === "GedStatusItemImportacao")!.values.map((v) => v.name);
    expect(itens).toContain("REMOVIDO");
    expect(Prisma.dmmf.datamodel.models.some((m) => m.name === "GedExclusao")).toBe(true);
  });
});
