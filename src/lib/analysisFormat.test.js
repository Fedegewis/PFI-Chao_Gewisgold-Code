// 7J.3 — tests focalizados de la capa presentacional del análisis IA.
import { describe, expect, test } from "vitest";
import {
  formatMetricLabel,
  formatMetricValue,
  formatSectionLabel,
  formatEvidenceEntry,
  groupEvidenceForRender,
  SECTION_LABELS,
  METRIC_LABELS,
} from "./analysisFormat.js";

describe("formatSectionLabel", () => {
  test("traduce las 10 secciones conocidas del banco", () => {
    expect(SECTION_LABELS.orientacion_temporal).toBe("Orientación temporal");
    expect(SECTION_LABELS.memoria_de_trabajo).toBe("Memoria de trabajo");
    expect(SECTION_LABELS.funciones_ejecutivas).toBe("Funciones ejecutivas");
    expect(SECTION_LABELS.atencion_y_calculo).toBe("Atención y cálculo");
    expect(SECTION_LABELS.memoria_asociativa).toBe("Memoria asociativa");
    expect(SECTION_LABELS.metacognicion).toBe("Metacognición");
    expect(SECTION_LABELS.memoria_prospectiva).toBe("Memoria prospectiva");
    expect(SECTION_LABELS.atencion_visual).toBe("Atención visual");
    expect(SECTION_LABELS.comprension_funcional).toBe("Comprensión funcional");
    expect(SECTION_LABELS.orientacion_espacial).toBe("Orientación espacial");
  });
  test("slug desconocido: fallback al slug crudo (no rompe UI)", () => {
    expect(formatSectionLabel("seccion_inexistente")).toBe("seccion_inexistente");
  });
  test("input vacío", () => {
    expect(formatSectionLabel("")).toBe("");
    expect(formatSectionLabel(undefined)).toBe("");
    expect(formatSectionLabel(null)).toBe("");
  });
});

describe("formatMetricLabel", () => {
  test("traduce las 11 métricas del schema v1", () => {
    for (const k of [
      "total_questions","answered_questions","correct_count","incorrect_count","unanswered_count",
      "accuracy","completion_rate","mean_latency_ms","min_latency_ms","max_latency_ms","latency_std_ms",
    ]) {
      expect(METRIC_LABELS[k]).toBeTruthy();
      expect(METRIC_LABELS[k]).not.toBe(k);
    }
  });
  test("labels específicos", () => {
    expect(formatMetricLabel("accuracy")).toBe("Precisión");
    expect(formatMetricLabel("completion_rate")).toBe("Completitud");
    expect(formatMetricLabel("mean_latency_ms")).toBe("Tiempo medio de respuesta");
    expect(formatMetricLabel("latency_std_ms")).toBe("Variación del tiempo de respuesta");
    expect(formatMetricLabel("correct_count")).toBe("Respuestas correctas");
  });
});

describe("formatMetricValue — porcentajes", () => {
  test("accuracy 0.5 → 50 %", () => {
    expect(formatMetricValue("accuracy", 0.5)).toBe("50 %");
  });
  test("completion_rate 1 → 100 %", () => {
    expect(formatMetricValue("completion_rate", 1)).toBe("100 %");
  });
  test("accuracy 0.753 → 75,3 %", () => {
    expect(formatMetricValue("accuracy", 0.753)).toBe("75,3 %");
  });
  test("accuracy null → —", () => {
    expect(formatMetricValue("accuracy", null)).toBe("—");
  });
});

describe("formatMetricValue — latencias ms → s", () => {
  test("< 1000 ms se muestra en ms", () => {
    expect(formatMetricValue("mean_latency_ms", 820)).toBe("820 ms");
    expect(formatMetricValue("min_latency_ms", 999)).toBe("999 ms");
  });
  test(">= 1000 ms se muestra en segundos con coma decimal", () => {
    expect(formatMetricValue("mean_latency_ms", 1000)).toBe("1,00 s");
    expect(formatMetricValue("mean_latency_ms", 3233.25)).toBe("3,23 s");
    expect(formatMetricValue("latency_std_ms", 1129.76)).toBe("1,13 s");
    expect(formatMetricValue("max_latency_ms", 5072)).toBe("5,07 s");
  });
});

describe("formatMetricValue — conteos", () => {
  test("enteros como enteros", () => {
    expect(formatMetricValue("correct_count", 2)).toBe("2");
    expect(formatMetricValue("total_questions", 4)).toBe("4");
    expect(formatMetricValue("incorrect_count", 0)).toBe("0");
  });
});

describe("formatEvidenceEntry", () => {
  test("global accuracy: group=General, labels humanos, valor porcentual", () => {
    const out = formatEvidenceEntry({ scope: "global", metric: "accuracy", value: 0.5 });
    expect(out.group).toBe("General");
    expect(out.scope).toBe("global");
    expect(out.sectionSlug).toBeNull();
    expect(out.metricLabel).toBe("Precisión");
    expect(out.valueLabel).toBe("50 %");
  });
  test("section correct_count: group=Orientación temporal, valor entero", () => {
    const out = formatEvidenceEntry({
      scope: "section", metric: "correct_count", value: 2, section_slug: "orientacion_temporal",
    });
    expect(out.group).toBe("Orientación temporal");
    expect(out.scope).toBe("section");
    expect(out.sectionSlug).toBe("orientacion_temporal");
    expect(out.metricLabel).toBe("Respuestas correctas");
    expect(out.valueLabel).toBe("2");
  });
  test("section latency_std_ms: valor en segundos", () => {
    const out = formatEvidenceEntry({
      scope: "section", metric: "latency_std_ms", value: 1129.76, section_slug: "orientacion_temporal",
    });
    expect(out.metricLabel).toBe("Variación del tiempo de respuesta");
    expect(out.valueLabel).toBe("1,13 s");
  });
});

describe("groupEvidenceForRender", () => {
  test("agrupa por scope/sección preservando orden", () => {
    const groups = groupEvidenceForRender([
      { scope: "global", metric: "accuracy", value: 0.5 },
      { scope: "section", metric: "correct_count", value: 2, section_slug: "orientacion_temporal" },
      { scope: "section", metric: "latency_std_ms", value: 1129.76, section_slug: "orientacion_temporal" },
      { scope: "global", metric: "total_questions", value: 4 },
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0].group).toBe("General");
    expect(groups[0].items.length).toBe(2);
    expect(groups[0].items[0].metricLabel).toBe("Precisión");
    expect(groups[0].items[0].valueLabel).toBe("50 %");
    expect(groups[0].items[1].metricLabel).toBe("Preguntas totales");
    expect(groups[0].items[1].valueLabel).toBe("4");
    expect(groups[1].group).toBe("Orientación temporal");
    expect(groups[1].items.length).toBe(2);
    expect(groups[1].items[0].metricLabel).toBe("Respuestas correctas");
    expect(groups[1].items[1].valueLabel).toBe("1,13 s");
  });

  test("evidence null / no-array retorna array vacío", () => {
    expect(groupEvidenceForRender(null)).toEqual([]);
    expect(groupEvidenceForRender(undefined)).toEqual([]);
    expect(groupEvidenceForRender("nope")).toEqual([]);
  });

  test("cada entrada expone únicamente etiquetas humanas: sin metric raw ni section_slug", () => {
    const groups = groupEvidenceForRender([
      { scope: "global", metric: "accuracy", value: 0.5 },
      { scope: "section", metric: "correct_count", value: 2, section_slug: "orientacion_temporal" },
    ]);
    for (const g of groups) {
      // group es "General" o un nombre humano — nunca un slug crudo.
      expect(g.group === "General" || Object.values(SECTION_LABELS).includes(g.group)).toBe(true);
      for (const item of g.items) {
        // metricLabel debe ser la etiqueta humana, no la métrica cruda.
        expect(Object.values(METRIC_LABELS)).toContain(item.metricLabel);
        // valueLabel nunca es el número crudo con muchos decimales sin formato.
        expect(typeof item.valueLabel).toBe("string");
      }
    }
  });
});
