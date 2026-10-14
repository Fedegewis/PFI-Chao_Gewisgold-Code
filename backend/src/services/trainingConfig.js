// Configuración de entrenamiento por paciente.
//
// Fuente de verdad: columnas nullable en `users`:
//   - max_questions         smallint NULL  (CHECK 1..10 vía migración 013)
//   - active_domain_slugs   jsonb NULL     (subset de cognitive_domains.slug)
//   - active_section_slugs  jsonb NULL     (subset de sections.slug, migración 015)
//
// Fallback cuando el paciente aún no fue configurado:
//   - effective_max_questions          = 4
//   - effective_active_domain_slugs    = null  (sin filtro de dominios)
//   - effective_active_section_slugs   = null  (todas las secciones habilitadas)
//
// Un array vacío en cualquiera de los jsonb se normaliza a null (misma
// semántica: sin filtro / todas habilitadas). Un array no vacío = OR explícito
// entre valores (ver questionEligibility para dominios; routes/sessions para
// secciones).

export const DEFAULT_MAX_QUESTIONS = 4;
export const MIN_MAX_QUESTIONS = 1;
export const MAX_MAX_QUESTIONS = 10;

function parseStoredDomainSlugs(raw) {
  if (raw == null) return null;
  // Postgres jsonb devuelve directamente el valor parseado por node-pg.
  // Si por algún motivo llega como string, tratar de parsear.
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!Array.isArray(value) || value.length === 0) return null;
  const cleaned = value.filter((s) => typeof s === "string" && s.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

// A partir de una fila `users`, devuelve la config efectiva usada por la selección real.
export function resolveEffectiveConfig(userRow) {
  const rawMax = userRow?.max_questions;
  const rawDomainSlugs = parseStoredDomainSlugs(userRow?.active_domain_slugs);
  const rawSectionSlugs = parseStoredDomainSlugs(userRow?.active_section_slugs);
  const effectiveMax =
    Number.isInteger(rawMax) && rawMax >= MIN_MAX_QUESTIONS && rawMax <= MAX_MAX_QUESTIONS
      ? rawMax
      : DEFAULT_MAX_QUESTIONS;
  return {
    max_questions: effectiveMax,
    active_domain_slugs: rawDomainSlugs,
    active_section_slugs: rawSectionSlugs,
  };
}

// Payload que devuelven los endpoints GET/PUT.
export function serializeConfig(userRow) {
  const rawDomainSlugs = parseStoredDomainSlugs(userRow?.active_domain_slugs);
  const rawSectionSlugs = parseStoredDomainSlugs(userRow?.active_section_slugs);
  const effective = resolveEffectiveConfig(userRow);
  return {
    max_questions: userRow?.max_questions ?? null,
    active_domain_slugs: rawDomainSlugs,
    active_section_slugs: rawSectionSlugs,
    effective_max_questions: effective.max_questions,
    effective_active_domain_slugs: effective.active_domain_slugs,
    effective_active_section_slugs: effective.active_section_slugs,
  };
}

// Valida el payload de PUT. Devuelve { ok:true, patch } o { ok:false, error }.
// `patch` está listo para pasar directamente a knex.update().
// - validSlugs: slugs de cognitive_domains permitidos.
// - validSectionSlugs (opcional): slugs de sections activas permitidos. Si el
//   payload trae active_section_slugs y no se pasa este argumento, se omite la
//   validación de slugs de secciones (retrocompatibilidad con callers viejos).
export function validateAndBuildPatch(body, validSlugs, validSectionSlugs) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Body inválido" };
  }
  const patch = {};

  // max_questions
  if (Object.prototype.hasOwnProperty.call(body, "max_questions")) {
    const v = body.max_questions;
    if (v === null) {
      patch.max_questions = null;
    } else if (
      !Number.isInteger(v) ||
      v < MIN_MAX_QUESTIONS ||
      v > MAX_MAX_QUESTIONS
    ) {
      return {
        ok: false,
        error: `max_questions debe ser un entero entre ${MIN_MAX_QUESTIONS} y ${MAX_MAX_QUESTIONS}`,
      };
    } else {
      patch.max_questions = v;
    }
  }

  // active_domain_slugs
  if (Object.prototype.hasOwnProperty.call(body, "active_domain_slugs")) {
    const v = body.active_domain_slugs;
    if (v === null) {
      patch.active_domain_slugs = null;
    } else if (!Array.isArray(v)) {
      return { ok: false, error: "active_domain_slugs debe ser un array o null" };
    } else if (v.length === 0) {
      // Un array vacío se normaliza a null (misma semántica: sin filtro).
      patch.active_domain_slugs = null;
    } else {
      if (v.some((s) => typeof s !== "string")) {
        return { ok: false, error: "active_domain_slugs debe contener sólo strings" };
      }
      const dedup = Array.from(new Set(v));
      if (dedup.length !== v.length) {
        return { ok: false, error: "active_domain_slugs no puede contener duplicados" };
      }
      const validSet = new Set(validSlugs);
      const invalid = dedup.filter((s) => !validSet.has(s));
      if (invalid.length > 0) {
        return { ok: false, error: `Dominio(s) inexistente(s): ${invalid.join(", ")}` };
      }
      patch.active_domain_slugs = JSON.stringify(dedup);
    }
  }

  // active_section_slugs — misma semántica/forma que active_domain_slugs.
  if (Object.prototype.hasOwnProperty.call(body, "active_section_slugs")) {
    const v = body.active_section_slugs;
    if (v === null) {
      patch.active_section_slugs = null;
    } else if (!Array.isArray(v)) {
      return { ok: false, error: "active_section_slugs debe ser un array o null" };
    } else if (v.length === 0) {
      patch.active_section_slugs = null;
    } else {
      if (v.some((s) => typeof s !== "string")) {
        return { ok: false, error: "active_section_slugs debe contener sólo strings" };
      }
      const dedup = Array.from(new Set(v));
      if (dedup.length !== v.length) {
        return { ok: false, error: "active_section_slugs no puede contener duplicados" };
      }
      if (Array.isArray(validSectionSlugs)) {
        const validSet = new Set(validSectionSlugs);
        const invalid = dedup.filter((s) => !validSet.has(s));
        if (invalid.length > 0) {
          return { ok: false, error: `Sección(es) inexistente(s): ${invalid.join(", ")}` };
        }
      }
      patch.active_section_slugs = JSON.stringify(dedup);
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "El body no incluye campos configurables" };
  }
  return { ok: true, patch };
}
