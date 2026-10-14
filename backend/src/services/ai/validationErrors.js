// 7E: errores tipados para la validación del OUTPUT del modelo.
//
// Separados de OllamaClientError (transporte). Los errores de aquí describen
// que el modelo respondió, pero su respuesta no cumple el contrato v1.
// 7G decidirá cómo mapearlos a códigos de status persistidos y a status HTTP.

export const AnalysisValidationCodes = Object.freeze({
  INVALID_JSON: "INVALID_JSON",              // no parsea como JSON
  SCHEMA_INVALID: "SCHEMA_INVALID",          // shape/tipos/límites incumplidos
  UNEXPECTED_FIELD: "UNEXPECTED_FIELD",      // strict mode: campo extra
  SECTIONS_MISMATCH: "SECTIONS_MISMATCH",    // cobertura/orden/duplicados
  EVIDENCE_INVALID: "EVIDENCE_INVALID",      // métrica desconocida, valor inconsistente, etc.
});

export class AnalysisValidationError extends Error {
  constructor(code, message, { path, info } = {}) {
    super(message);
    this.name = "AnalysisValidationError";
    this.code = code;
    if (path !== undefined) this.path = path;
    // `info` es metadata estructurada opcional para que el orquestador
    // (analysisService) pueda decidir reintentos sin parsear mensajes.
    // Convención: { reason: "max_length_exceeded" } para fallos por tamaño.
    if (info !== undefined) this.info = info;
  }
}
