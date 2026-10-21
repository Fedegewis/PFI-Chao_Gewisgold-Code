// 7F: normalización de error_code para persistencia.
//
// Motivo: OllamaErrorCodes.INVALID_JSON y AnalysisValidationCodes.INVALID_JSON
// colisionan nominalmente. Persistimos con prefijo de familia para que
// consultas y métricas no confundan errores de transporte con errores de
// output del modelo.

import { OllamaErrorCodes } from "./errors.js";
import { AnalysisValidationCodes } from "./validationErrors.js";

const OLLAMA_MAP = Object.freeze({
  [OllamaErrorCodes.OLLAMA_DISABLED]:   "OLLAMA_DISABLED",
  [OllamaErrorCodes.OLLAMA_OFFLINE]:    "OLLAMA_OFFLINE",
  [OllamaErrorCodes.OLLAMA_TIMEOUT]:    "OLLAMA_TIMEOUT",
  [OllamaErrorCodes.MODEL_NOT_FOUND]:   "OLLAMA_MODEL_NOT_FOUND",
  [OllamaErrorCodes.OLLAMA_HTTP_ERROR]: "OLLAMA_HTTP_ERROR",
  [OllamaErrorCodes.EMPTY_RESPONSE]:    "OLLAMA_EMPTY_RESPONSE",
  [OllamaErrorCodes.INVALID_JSON]:      "OLLAMA_INVALID_JSON",
  [OllamaErrorCodes.OLLAMA_CONFIG_INVALID]: "OLLAMA_CONFIG_INVALID",
});

const ANALYSIS_MAP = Object.freeze({
  [AnalysisValidationCodes.INVALID_JSON]:      "ANALYSIS_INVALID_JSON",
  [AnalysisValidationCodes.SCHEMA_INVALID]:    "ANALYSIS_SCHEMA_INVALID",
  [AnalysisValidationCodes.UNEXPECTED_FIELD]:  "ANALYSIS_UNEXPECTED_FIELD",
  [AnalysisValidationCodes.SECTIONS_MISMATCH]: "ANALYSIS_SECTIONS_MISMATCH",
  [AnalysisValidationCodes.EVIDENCE_INVALID]:  "ANALYSIS_EVIDENCE_INVALID",
});

// Códigos operacionales de la cola del worker local (W-2+). No provienen
// del validator ni del cliente Ollama: los emite analysisQueue cuando un
// lease vence sin reporte del worker, por ejemplo tras un crash de la PC.
const QUEUE_MAP = Object.freeze({
  LEASE_EXPIRED: "ANALYSIS_LEASE_EXPIRED",
});

// Set de todos los códigos persistibles, para validación en el repository.
export const PERSISTED_ERROR_CODES = Object.freeze(
  new Set([
    ...Object.values(OLLAMA_MAP),
    ...Object.values(ANALYSIS_MAP),
    ...Object.values(QUEUE_MAP),
  ])
);

/**
 * Normaliza un código interno a su forma persistible con prefijo de familia.
 * @param {"ollama"|"analysis"} family
 * @param {string} internalCode
 * @returns {string}
 */
export function toPersistedErrorCode(family, internalCode) {
  if (family === "ollama") {
    const mapped = OLLAMA_MAP[internalCode];
    if (!mapped) throw new TypeError(`código Ollama desconocido: ${internalCode}`);
    return mapped;
  }
  if (family === "analysis") {
    const mapped = ANALYSIS_MAP[internalCode];
    if (!mapped) throw new TypeError(`código Analysis desconocido: ${internalCode}`);
    return mapped;
  }
  throw new TypeError(`family desconocida: ${family}`);
}
