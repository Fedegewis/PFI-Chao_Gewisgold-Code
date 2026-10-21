import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../src/logger.js";

function capture() {
  const lines = [];
  return {
    sink: (line) => lines.push(line),
    get records() { return lines.map((l) => JSON.parse(l)); },
  };
}

describe("logger — redaction y truncado", () => {
  it("no imprime WORKER_TOKEN ni authorization", () => {
    const cap = capture();
    const log = createLogger({ sink: cap.sink });
    log.info("test", { token: "secret-token", authorization: "Bearer x", other: "ok" });
    assert.equal(cap.records[0].meta.token, "[REDACTED]");
    assert.equal(cap.records[0].meta.authorization, "[REDACTED]");
    assert.equal(cap.records[0].meta.other, "ok");
  });

  it("trunca prompts largos", () => {
    const cap = capture();
    const log = createLogger({ sink: cap.sink });
    const bigPrompt = "x".repeat(2000);
    log.info("test", { prompt: bigPrompt });
    const printed = cap.records[0].meta.prompt;
    assert.ok(printed.length < 100, "prompt debe truncarse");
    assert.ok(!printed.includes("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "no imprime el prompt completo");
  });

  it("filtra campos sensibles recursivamente", () => {
    const cap = capture();
    const log = createLogger({ sink: cap.sink });
    log.info("test", { nested: { api_key: "k", password: "p", clean: "ok" } });
    assert.equal(cap.records[0].meta.nested.api_key, "[REDACTED]");
    assert.equal(cap.records[0].meta.nested.password, "[REDACTED]");
    assert.equal(cap.records[0].meta.nested.clean, "ok");
  });

  it("respeta nivel configurado", () => {
    const cap = capture();
    const log = createLogger({ level: "warn", sink: cap.sink });
    log.debug("skip");
    log.info("skip");
    log.warn("yes");
    log.error("yes2");
    assert.equal(cap.records.length, 2);
    assert.equal(cap.records[0].level, "warn");
  });

  it("no explota si el meta contiene algo serializable raro", () => {
    const cap = capture();
    const log = createLogger({ sink: cap.sink });
    log.info("x", { n: 1, b: true, s: "ok", a: [1, 2], o: { k: "v" } });
    assert.equal(cap.records[0].meta.n, 1);
  });
});
