// Helpers compartidos para elegibilidad de preguntas.
// Centralizados aquí para garantizar que UI (available_count) y selector
// (POST /sessions y POST /patient/sessions) usen EXACTAMENTE los mismos filtros.
//
// Reglas de elegibilidad:
//   - question.section_id = section
//   - question.is_active  = true
//   - question.is_validated = true  O  question.validation_level IS NOT NULL
//     (migración 015 introdujo validation_level ∈ {technical, clinical}.
//     Las preguntas elevadas vía revisión técnica aportan al banco utilizable
//     sin modificar la bandera histórica is_validated.)
//   - Si hay filtro de dominios: la pregunta pertenece a AL MENOS UNO
//     de los slugs indicados (OR). Cada pregunta cuenta una sola vez (DISTINCT).
//   - Sin filtro de dominios: comportamiento previo (sin JOIN).
//
// domainSlugs = null | undefined | [] → sin filtro
// domainSlugs = [...slugs] → OR entre slugs, con DISTINCT.

function hasDomainFilter(domainSlugs) {
  return Array.isArray(domainSlugs) && domainSlugs.length > 0;
}

function baseEligibleQuery(qb, sectionId, domainSlugs) {
  qb.from("questions as q")
    .where("q.section_id", sectionId)
    .where("q.is_active", true)
    .where((inner) => {
      inner.where("q.is_validated", true).orWhereNotNull("q.validation_level");
    });
  if (hasDomainFilter(domainSlugs)) {
    qb.join("question_cognitive_domains as qcd", "qcd.question_id", "q.id")
      .join("cognitive_domains as cd", "cd.id", "qcd.cognitive_domain_id")
      .whereIn("cd.slug", domainSlugs);
  }
}

export async function countEligibleQuestions(dbOrTrx, sectionId, domainSlugs) {
  const query = dbOrTrx.queryBuilder();
  baseEligibleQuery(query, sectionId, domainSlugs);
  if (hasDomainFilter(domainSlugs)) {
    query.countDistinct({ count: "q.id" });
  } else {
    query.count({ count: "q.id" });
  }
  const row = await query.first();
  return Number(row?.count ?? 0);
}

export async function listEligibleQuestions(dbOrTrx, sectionId, domainSlugs) {
  const query = dbOrTrx.queryBuilder();
  baseEligibleQuery(query, sectionId, domainSlugs);
  const cols = ["q.id", "q.prompt", "q.stimulus", "q.response_type", "q.options", "q.correct_answer", "q.difficulty"];
  if (hasDomainFilter(domainSlugs)) {
    query.distinct(cols);
  } else {
    query.select(cols);
  }
  return query;
}
