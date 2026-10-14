import { Router } from "express";
import db from "../db/connection.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { countEligibleQuestions } from "../services/questionEligibility.js";
import {
  resolveEffectiveConfig,
  serializeConfig,
  validateAndBuildPatch,
} from "../services/trainingConfig.js";

const router = Router();

async function loadValidDomainSlugs() {
  const rows = await db("cognitive_domains").select("slug");
  return rows.map((r) => r.slug);
}

async function loadValidSectionSlugs() {
  const rows = await db("sections").where("is_active", true).select("slug");
  return rows.map((r) => r.slug);
}

// GET /api/cognitive-domains — catálogo real desde PostgreSQL.
router.get("/cognitive-domains", requireAuth, async (_req, res, next) => {
  try {
    const rows = await db("cognitive_domains")
      .orderBy("id")
      .select("id", "slug", "name");
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Utilidad interna: valida ownership profesional ↔ paciente y devuelve la fila users.
// Cualquier fallo devuelve 404 uniforme (no revela existencia cross-profesional).
async function loadOwnedPatient(professionalId, patientIdParam) {
  const patientId = Number(patientIdParam);
  if (!Number.isInteger(patientId) || patientId < 1) return null;
  return db("users")
    .where({ id: patientId, role: "patient", professional_id: professionalId })
    .first();
}

// GET /api/patients/:id/training-config — profesional lee config de su paciente.
router.get(
  "/patients/:id/training-config",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      res.json(serializeConfig(patient));
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/patients/:id/training-config — profesional actualiza config de su paciente.
router.put(
  "/patients/:id/training-config",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      const [validSlugs, validSectionSlugs] = await Promise.all([
        loadValidDomainSlugs(),
        loadValidSectionSlugs(),
      ]);
      const validation = validateAndBuildPatch(req.body, validSlugs, validSectionSlugs);
      if (!validation.ok) {
        return res.status(400).json({ error: validation.error });
      }

      await db("users").where("id", patient.id).update({
        ...validation.patch,
        updated_at: db.fn.now(),
      });

      const updated = await db("users").where("id", patient.id).first();
      res.json(serializeConfig(updated));
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/patient/training-config — paciente lee su propia config efectiva.
router.get(
  "/patient/training-config",
  requireAuth,
  requireRole("patient"),
  async (req, res, next) => {
    try {
      const patient = await db("users").where({ id: req.user.id, role: "patient" }).first();
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }
      res.json(serializeConfig(patient));
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/patient/available-sections — paciente consulta qué actividades
// puede iniciar en este momento según su configuración. Fuente única de verdad
// para la pantalla "Actividades disponibles": si una sección no aparece en el
// payload o aparece con startable=false, el frontend no debería permitir iniciarla.
// El guard final sigue viviendo en POST /patient/sessions.
router.get(
  "/patient/available-sections",
  requireAuth,
  requireRole("patient"),
  async (req, res, next) => {
    try {
      const patient = await db("users").where({ id: req.user.id, role: "patient" }).first();
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      const effective = resolveEffectiveConfig(patient);
      const enabledSet = Array.isArray(effective.active_section_slugs)
        ? new Set(effective.active_section_slugs)
        : null;

      const sections = await db("sections")
        .where("is_active", true)
        .orderBy("display_order")
        .select("id", "slug", "name");

      const payload = [];
      for (const s of sections) {
        const enabled = enabledSet ? enabledSet.has(s.slug) : true;
        const available = await countEligibleQuestions(db, s.id, effective.active_domain_slugs);
        const sufficient = available >= effective.max_questions;
        payload.push({
          section_slug: s.slug,
          section_name: s.name,
          enabled,
          available,
          sufficient,
          startable: enabled && sufficient,
        });
      }

      res.json({
        requested: effective.max_questions,
        active_domain_slugs: effective.active_domain_slugs,
        active_section_slugs: effective.active_section_slugs,
        sections: payload,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/patients/:id/training-availability — profesional ve, para cada sección,
// cuántas preguntas hay disponibles con la configuración actual del paciente.
// Útil para prevenir configuraciones imposibles en la UI.
router.get(
  "/patients/:id/training-availability",
  requireAuth,
  requireRole("professional"),
  async (req, res, next) => {
    try {
      const patient = await loadOwnedPatient(req.user.id, req.params.id);
      if (!patient) {
        return res.status(404).json({ error: "Paciente no encontrado" });
      }

      const effective = resolveEffectiveConfig(patient);
      const sections = await db("sections")
        .where("is_active", true)
        .orderBy("display_order")
        .select("id", "slug", "name");

      // F2: cuando el paciente tiene active_section_slugs definido, cada
      // sección trae `enabled` indicando si está habilitada en su config.
      // El cálculo de `available` y `sufficient` NO depende de enabled —
      // siempre reporta el real para que la UI muestre información completa.
      const enabledSet = Array.isArray(effective.active_section_slugs)
        ? new Set(effective.active_section_slugs)
        : null;

      const payload = [];
      for (const s of sections) {
        const available = await countEligibleQuestions(db, s.id, effective.active_domain_slugs);
        payload.push({
          section_id: s.id,
          section_slug: s.slug,
          section_name: s.name,
          available,
          sufficient: available >= effective.max_questions,
          enabled: enabledSet ? enabledSet.has(s.slug) : true,
        });
      }

      // Semántica de "configuración viable": arquitectónicamente una sesión
      // pertenece a UNA sola section (la actividad que el paciente elige al
      // iniciar). La configuración es viable si AL MENOS UNA section
      // HABILITADA puede cumplir max_questions con los dominios activos. Si
      // ninguna cumple, la config es efectivamente imposible en toda la app.
      const anySufficient = payload.some((s) => s.enabled && s.sufficient);

      res.json({
        requested: effective.max_questions,
        active_domain_slugs: effective.active_domain_slugs,
        active_section_slugs: effective.active_section_slugs,
        any_sufficient: anySufficient,
        sections: payload,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
