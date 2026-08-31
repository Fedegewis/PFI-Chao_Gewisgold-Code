export async function up(knex) {
  // Update cognitive_domain on all existing sections to match frontend COGNITIVE_DOMAINS strings
  await knex("sections").where("slug", "memoria_de_trabajo").update({
    cognitive_domain: "Memoria",
    display_order: 1,
  });
  await knex("sections").where("slug", "memoria_asociativa").update({
    cognitive_domain: "Memoria",
    display_order: 2,
  });
  await knex("sections").where("slug", "memoria_prospectiva").update({
    cognitive_domain: "Memoria",
    display_order: 3,
  });
  await knex("sections").where("slug", "atencion_y_calculo").update({
    cognitive_domain: "Atención",
    display_order: 4,
  });
  await knex("sections").where("slug", "orientacion_temporal").update({
    cognitive_domain: "Orientación",
    display_order: 8,
  });
  await knex("sections").where("slug", "orientacion_espacial").update({
    cognitive_domain: "Orientación",
    display_order: 9,
  });
  await knex("sections").where("slug", "comprension_funcional").update({
    cognitive_domain: "Comprensión y lenguaje",
    display_order: 10,
  });

  // Rename funciones_ejecutivas → planificacion_y_secuenciacion
  await knex("sections").where("slug", "funciones_ejecutivas").update({
    slug: "planificacion_y_secuenciacion",
    name: "Planificación y secuenciación",
    description:
      "Planificación de pasos, secuenciación temporal, organización de tareas cotidianas y resolución de problemas.",
    cognitive_domain: "Funciones ejecutivas",
    display_order: 6,
  });

  // Rename metacognicion → autorreporte (outside the 5 cognitive domains)
  await knex("sections").where("slug", "metacognicion").update({
    slug: "autorreporte",
    name: "Autorreporte y bienestar",
    description:
      "Autorreporte subjetivo, autorregulación, reconocimiento de fatiga y estado emocional.",
    cognitive_domain: null,
    display_order: 11,
  });

  // Deactivate atencion_visual (historical, questions stay attached)
  await knex("sections").where("slug", "atencion_visual").update({
    is_active: false,
    cognitive_domain: "Atención",
    display_order: 99,
  });

  // Create new sections
  await knex("sections").insert({
    slug: "atencion_selectiva",
    name: "Atención selectiva y sostenida",
    description:
      "Focalización, sostenimiento de la atención, filtrado de distractores en contextos cotidianos.",
    cognitive_domain: "Atención",
    is_active: true,
    display_order: 5,
  });

  await knex("sections").insert({
    slug: "razonamiento_practico",
    name: "Razonamiento práctico y juicio",
    description:
      "Juicio práctico, evaluación de riesgo, toma de decisiones y flexibilidad cognitiva en situaciones cotidianas.",
    cognitive_domain: "Funciones ejecutivas",
    is_active: true,
    display_order: 7,
  });
}

export async function down(knex) {
  // Remove new sections (no questions attached, RESTRICT won't block)
  await knex("sections").where("slug", "atencion_selectiva").del();
  await knex("sections").where("slug", "razonamiento_practico").del();

  // Reactivate atencion_visual
  await knex("sections").where("slug", "atencion_visual").update({
    is_active: true,
    cognitive_domain: "Atención visual",
    display_order: 8,
  });

  // Rename autorreporte back to metacognicion
  await knex("sections").where("slug", "autorreporte").update({
    slug: "metacognicion",
    name: "Metacognición",
    description:
      "Autorreporte subjetivo, autorregulación, reconocimiento de fatiga y adherencia.",
    cognitive_domain: "Metacognición y autorreporte",
    display_order: 6,
  });

  // Rename planificacion_y_secuenciacion back to funciones_ejecutivas
  await knex("sections").where("slug", "planificacion_y_secuenciacion").update({
    slug: "funciones_ejecutivas",
    name: "Funciones ejecutivas",
    description:
      "Planificación, secuenciación, flexibilidad cognitiva y resolución de problemas.",
    cognitive_domain: "Funciones ejecutivas",
    display_order: 3,
  });

  // Restore original cognitive_domain values and display_order
  await knex("sections").where("slug", "memoria_de_trabajo").update({
    cognitive_domain: "Memoria de trabajo",
    display_order: 1,
  });
  await knex("sections").where("slug", "memoria_asociativa").update({
    cognitive_domain: "Memoria asociativa",
    display_order: 5,
  });
  await knex("sections").where("slug", "memoria_prospectiva").update({
    cognitive_domain: "Memoria prospectiva",
    display_order: 7,
  });
  await knex("sections").where("slug", "atencion_y_calculo").update({
    cognitive_domain: "Atención y cálculo",
    display_order: 2,
  });
  await knex("sections").where("slug", "orientacion_temporal").update({
    cognitive_domain: "Orientación temporal",
    display_order: 4,
  });
  await knex("sections").where("slug", "orientacion_espacial").update({
    cognitive_domain: "Orientación espacial",
    display_order: 10,
  });
  await knex("sections").where("slug", "comprension_funcional").update({
    cognitive_domain: "Comprensión funcional",
    display_order: 9,
  });
}
