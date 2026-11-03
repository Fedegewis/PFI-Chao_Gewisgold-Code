// Casos borde de los helpers de formato del informe (v3): entradas inválidas,
// valores ausentes y formatos de comparación. Complementa analysisFormat.test.js.
import { describe, expect, test } from "vitest";
import {
  buildGlobalMetricTiles,
  collectActivityLabels,
  collectDomainLabels,
  findEvidenceValue,
  formatComparisonMetrics,
  formatDomainLabel,
  formatEvidenceEntry,
  formatMetricLabel,
  formatMetricValue,
  formatSectionLabel,
  resolveReportedMood
} from "./analysisFormat.js";

describe("etiquetas", () => {
  test("slugs vacíos o no string devuelven cadena vacía", () => {
    for (const fn of [formatDomainLabel, formatSectionLabel, formatMetricLabel]) {
      expect(fn("")).toBe("");
      expect(fn(null)).toBe("");
    }
  });

  test("slugs desconocidos se devuelven tal cual", () => {
    expect(formatDomainLabel("otro_dominio")).toBe("otro_dominio");
    expect(formatDomainLabel("memoria")).toBe("Memoria");
  });

  test("collectDomainLabels ignora entradas inválidas y ordena sin repetir", () => {
    expect(collectDomainLabels(null)).toEqual([]);
    expect(
      collectDomainLabels([
        { cognitive_domain_slugs: ["memoria", "atencion", ""] },
        { cognitive_domain_slugs: ["memoria"] },
        { cognitive_domain_slugs: "no-array" },
        null
      ])
    ).toEqual(["Atención", "Memoria"]);
  });

  test("collectActivityLabels usa name o resuelve por slug", () => {
    expect(collectActivityLabels(undefined)).toEqual([]);
    expect(collectActivityLabels([{ name: "Caras y nombres" }, { slug: "otra" }, { name: "" }, null])).toEqual([
      "Caras y nombres",
      "otra"
    ]);
  });
});

describe("evidencia", () => {
  const evidence = [
    null,
    "basura",
    { scope: "section", metric: "accuracy", section_slug: "atencion_visual", value: 0.5 },
    { scope: "global", metric: "accuracy", value: 0.75 },
    { scope: "global", metric: "mean_latency_ms", value: 2500 },
    { scope: "session", metric: "duration_seconds", value: 125 }
  ];

  test("findEvidenceValue filtra por scope, métrica y sección", () => {
    expect(findEvidenceValue("no-array", { metric: "accuracy" })).toBeUndefined();
    expect(findEvidenceValue(evidence, { scope: "global", metric: "accuracy" })).toBe(0.75);
    expect(findEvidenceValue(evidence, { metric: "accuracy", sectionSlug: "atencion_visual" })).toBe(0.5);
    expect(findEvidenceValue(evidence, { metric: "inexistente" })).toBeUndefined();
  });

  test("buildGlobalMetricTiles omite métricas ausentes e incluye duración", () => {
    expect(buildGlobalMetricTiles(null)).toEqual([]);
    const tiles = buildGlobalMetricTiles(evidence);
    expect(tiles.map((t) => t.metric)).toEqual(["accuracy", "mean_latency_ms", "duration_seconds"]);
    expect(tiles.find((t) => t.metric === "duration_seconds").value).toBe("2 min 5 s");
  });

  test("resolveReportedMood nunca inventa estado", () => {
    expect(resolveReportedMood([])).toEqual({ label: "No registrado", isRegistered: false });
    const mood = (value) => resolveReportedMood([{ scope: "session", metric: "patient_reported_mood", value }]);
    expect(mood(null).isRegistered).toBe(false);
    expect(mood("valor_desconocido").isRegistered).toBe(false);
  });

  test("formatEvidenceEntry con scope session o ausente cae en General", () => {
    expect(formatEvidenceEntry({ scope: "session", metric: "duration_seconds", value: 60 })).toMatchObject({
      scope: "session",
      group: "General",
      valueLabel: "1 min"
    });
    expect(formatEvidenceEntry(undefined)).toMatchObject({ scope: "global", sectionSlug: null, valueLabel: "—" });
    expect(formatEvidenceEntry({ scope: "section", metric: "accuracy", value: 1 })).toMatchObject({ sectionSlug: null });
  });
});

describe("formatMetricValue", () => {
  test("valores no numéricos o mood inválido → guion", () => {
    expect(formatMetricValue("patient_reported_mood", 3)).toBe("—");
    expect(formatMetricValue("duration_seconds", "abc")).toBe("—");
    expect(formatMetricValue("accuracy", "abc")).toBe("—");
  });

  test("duración, porcentajes con decimal y conteos no enteros", () => {
    expect(formatMetricValue("duration_seconds", 42)).toBe("42 s");
    expect(formatMetricValue("accuracy", 0.6667)).toBe("66,7 %");
    expect(formatMetricValue("min_latency_ms", 820.4)).toBe("820 ms");
    expect(formatMetricValue("total_questions", 2.5)).toBe("2,50");
  });
});

describe("formatComparisonMetrics", () => {
  test("entrada inválida → lista vacía", () => {
    expect(formatComparisonMetrics(null)).toEqual([]);
    expect(formatComparisonMetrics("x")).toEqual([]);
    expect(formatComparisonMetrics({ accuracy: { current: 1 } })).toEqual([]);
  });

  test("arma las tres filas con signo, unidades y dirección", () => {
    const rows = formatComparisonMetrics({
      accuracy: { current: 0.8, previous: 0.6, delta_percentage_points: 20, direction: "subió" },
      completion_rate: { current: 1, previous: 1, delta_percentage_points: 0, direction: "igual" },
      mean_latency_ms: { current: 2500, previous: 900, delta_ms: 1600, direction: "otra" }
    });
    expect(rows.map((r) => r.metric)).toEqual(["accuracy", "completion_rate", "mean_latency_ms"]);
    expect(rows[0].text).toBe("Actual 80,0 %, anterior 60,0 % — variación +20,0 pp (subió).");
    expect(rows[1].text).toMatch(/0,0 pp \(sin cambios\)/);
    expect(rows[2].text).toBe("Actual 2,50 s, anterior 900 ms — variación +1,60 s (otra).");
  });

  test("valores faltantes y deltas chicos o negativos", () => {
    const [acc, lat] = formatComparisonMetrics({
      accuracy: { current: undefined, previous: "x", delta_percentage_points: undefined, direction: "sin_datos" },
      mean_latency_ms: { current: 800, previous: undefined, delta_ms: -300, direction: "bajó" }
    });
    expect(acc.text).toBe("Actual —, anterior — — variación — (sin datos para comparar).");
    expect(lat.text).toBe("Actual 800 ms, anterior — — variación -300 ms (bajó).");
    const [onlyDeltaMissing] = formatComparisonMetrics({
      mean_latency_ms: { current: 800, previous: 900, delta_ms: "x", direction: "bajó" }
    });
    expect(onlyDeltaMissing.text).toMatch(/variación — \(bajó\)/);
  });
});
