// Regresión del bug detectado en pruebas pre-tesis:
// la UI del paciente mostraba "Sección X tiene N preguntas disponibles,
// pero se solicitaron M" cuando el profesional aplicaba filtro de dominios
// cognitivos. Causa raíz: las preguntas legacy (source=legacy_seed_v1) habían
// sido insertadas sin asociaciones en question_cognitive_domains, por lo que
// cualquier filtro con WHERE EXISTS cd.slug IN (...) las excluía.
//
// Este test asegura que ninguna pregunta validada y activa quede sin al menos
// una asociación N:M en question_cognitive_domains tras correr el seed.

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db/connection.js";

describe("Seed domain coverage — preguntas validadas", () => {
  after(async () => {
    await db.destroy();
  });

  it("ninguna pregunta is_active=true AND is_validated=true queda sin dominio", async () => {
    const orphans = await db("questions as q")
      .leftJoin(
        "question_cognitive_domains as qcd",
        "qcd.question_id",
        "q.id"
      )
      .join("sections as s", "s.id", "q.section_id")
      .where({ "q.is_active": true, "q.is_validated": true })
      .whereNull("qcd.question_id")
      .select("q.id", "q.source", "s.slug as section_slug");

    assert.equal(
      orphans.length,
      0,
      `Hay ${orphans.length} preguntas validadas sin dominio: ${JSON.stringify(orphans.slice(0, 5))}`
    );
  });
});
