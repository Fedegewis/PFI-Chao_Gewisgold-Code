// Tests unitarios puros de errorMapping (no requieren Postgres).
// La suite completa de session_analyses también cubre el loop general
// sobre OllamaErrorCodes, pero este archivo permite verificar el mapeo
// sin levantar la base de datos.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  toPersistedErrorCode,
  PERSISTED_ERROR_CODES,
} from "../src/services/ai/errorMapping.js";
import { OllamaErrorCodes } from "../src/services/ai/errors.js";
import { AnalysisValidationCodes } from "../src/services/ai/validationErrors.js";

describe("errorMapping", () => {
  describe("Ollama family", () => {
    it("mapea OLLAMA_CONFIG_INVALID a 'OLLAMA_CONFIG_INVALID' persistible", () => {
      assert.equal(
        toPersistedErrorCode("ollama", OllamaErrorCodes.OLLAMA_CONFIG_INVALID),
        "OLLAMA_CONFIG_INVALID"
      );
      assert.ok(PERSISTED_ERROR_CODES.has("OLLAMA_CONFIG_INVALID"));
    });

    it("cada OllamaErrorCode tiene un persistible distinto", () => {
      const seen = new Set();
      for (const v of Object.values(OllamaErrorCodes)) {
        const persisted = toPersistedErrorCode("ollama", v);
        assert.ok(
          PERSISTED_ERROR_CODES.has(persisted),
          `código ${v} → ${persisted} no está en la whitelist`
        );
        assert.equal(
          seen.has(persisted),
          false,
          `código persistible duplicado: ${persisted}`
        );
        seen.add(persisted);
      }
    });
  });

  describe("Analysis family", () => {
    it("cada AnalysisValidationCode tiene un persistible", () => {
      for (const v of Object.values(AnalysisValidationCodes)) {
        const persisted = toPersistedErrorCode("analysis", v);
        assert.ok(PERSISTED_ERROR_CODES.has(persisted));
      }
    });
  });

  describe("errores de la propia API", () => {
    it("code interno desconocido lanza TypeError", () => {
      assert.throws(
        () => toPersistedErrorCode("ollama", "DESCONOCIDO"),
        TypeError
      );
    });
    it("family desconocida lanza TypeError", () => {
      assert.throws(() => toPersistedErrorCode("alien", "x"), TypeError);
    });
  });
});
