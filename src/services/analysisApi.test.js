import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getAnalysis, generateAnalysis } from "./analysisApi.js";
import * as authService from "./authService.js";

beforeEach(() => {
  vi.spyOn(authService, "getToken").mockReturnValue("fake-jwt-token");
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("analysisApi", () => {
  test("getAnalysis hace GET al endpoint correcto con Bearer token", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ source: "stored", analysis: { id: 1 } }));
    vi.stubGlobal("fetch", fetchStub);
    const out = await getAnalysis(4333);
    expect(out.source).toBe("stored");
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchStub.mock.calls[0];
    expect(String(url)).toMatch(/\/sessions\/4333\/analysis$/);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer fake-jwt-token");
  });

  test("getAnalysis propaga 404 no_analysis en err.data", async () => {
    vi.stubGlobal("fetch", vi.fn(() => jsonResponse({ error: "No hay análisis", status: "no_analysis" }, 404)));
    await expect(getAnalysis(1)).rejects.toMatchObject({
      status: 404,
      data: { status: "no_analysis" },
    });
  });

  test("generateAnalysis por defecto no incluye ?force", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ source: "generated", analysis: { id: 2 } }, 201));
    vi.stubGlobal("fetch", fetchStub);
    await generateAnalysis(4333);
    const [url, opts] = fetchStub.mock.calls[0];
    expect(String(url)).toMatch(/\/sessions\/4333\/analysis$/);
    expect(String(url)).not.toContain("force");
    expect(opts.method).toBe("POST");
  });

  test("generateAnalysis con force=true agrega la query", async () => {
    const fetchStub = vi.fn(() => jsonResponse({ source: "generated", analysis: { id: 3 } }, 201));
    vi.stubGlobal("fetch", fetchStub);
    await generateAnalysis(4333, { force: true });
    const [url] = fetchStub.mock.calls[0];
    expect(String(url)).toMatch(/\/sessions\/4333\/analysis\?force=true$/);
  });

  test("generateAnalysis 502 ai_unavailable propaga err.data.status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => jsonResponse({ error: "No se pudo generar", status: "ai_unavailable" }, 502)),
    );
    await expect(generateAnalysis(1)).rejects.toMatchObject({
      status: 502,
      data: { status: "ai_unavailable" },
    });
  });

  test("sin token lanza 401 sin llamar a fetch", async () => {
    vi.spyOn(authService, "getToken").mockReturnValue(null);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    await expect(getAnalysis(1)).rejects.toMatchObject({ status: 401 });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
