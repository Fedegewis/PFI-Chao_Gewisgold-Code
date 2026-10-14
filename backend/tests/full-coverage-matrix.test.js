// Regresión: las 10 secciones × 5 dominios deben tener al menos 10 preguntas
// elegibles cada una (criterio del selector real, no conteo de registros).

import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import db from "../src/db/connection.js";
import { countEligibleQuestions } from "../src/services/questionEligibility.js";

describe("Matriz ACTIVIDAD × DOMINIO — cobertura mínima", () => {
  after(async () => {
    await db.destroy();
  });

  it("50/50: cada combinación tiene >=10 preguntas elegibles", async () => {
    const sections = await db("sections").where("is_active", true).select("id","slug","name");
    const domains = await db("cognitive_domains").select("slug","name");
    assert.equal(sections.length, 10, "Esperaba 10 secciones activas");
    assert.equal(domains.length, 5, "Esperaba 5 dominios");

    const gaps = [];
    for (const s of sections) {
      for (const d of domains) {
        const n = await countEligibleQuestions(db, s.id, [d.slug]);
        if (n < 10) gaps.push({ section: s.slug, domain: d.slug, have: n });
      }
    }
    assert.equal(gaps.length, 0, `Celdas por debajo de 10: ${JSON.stringify(gaps)}`);
  });

  it("multidominio: una pregunta con 2 tags cuenta UNA sola vez (DISTINCT)", async () => {
    // Elige una pregunta que tenga al menos 2 dominios y verifica que
    // countEligibleQuestions con esos 2 slugs no la cuenta dos veces.
    const q = await db("questions as q")
      .join("question_cognitive_domains as qcd", "qcd.question_id", "q.id")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .where("q.is_active", true)
      .andWhere(function(){this.where("q.is_validated",true).orWhereNotNull("q.validation_level");})
      .groupBy("q.id","q.section_id")
      .having(db.raw("count(cd.slug) >= 2"))
      .select("q.id","q.section_id")
      .first();
    assert.ok(q, "Debería haber al menos una pregunta multidominio en el banco");

    const tags = await db("question_cognitive_domains as qcd")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .where("qcd.question_id", q.id).pluck("cd.slug");

    const singleDomain = await countEligibleQuestions(db, q.section_id, [tags[0]]);
    const bothDomains = await countEligibleQuestions(db, q.section_id, [tags[0], tags[1]]);
    // bothDomains puede ser > singleDomain por preguntas con sólo tags[1],
    // pero no debería saltar por doble conteo de la que tiene ambos.
    const only2 = await countEligibleQuestions(db, q.section_id, [tags[1]]);
    const union = await db("questions as q")
      .join("question_cognitive_domains as qcd", "qcd.question_id", "q.id")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .where({ "q.section_id": q.section_id, "q.is_active": true })
      .andWhere(function(){this.where("q.is_validated",true).orWhereNotNull("q.validation_level");})
      .whereIn("cd.slug", [tags[0], tags[1]])
      .countDistinct("q.id as c").first();
    assert.equal(bothDomains, Number(union.c), "El selector debe aplicar DISTINCT en multidominio");
    assert.ok(bothDomains <= singleDomain + only2, "No puede exceder la suma, lo que indicaría doble conteo");
  });
});
