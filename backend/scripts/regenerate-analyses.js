// Regeneración CONTROLADA de análisis IA históricos (auditoría 2026-11-04).
//
// Por defecto es un DRY-RUN de sólo lectura: lista, para cada sesión con
// análisis ok, la versión del prompt y si su texto cumple las reglas
// vigentes (contentSafety.reviewStoredAnalysis; en v3 sólo el summary, igual
// que la API: los aspects_to_review persistidos se descartan al leer). No
// muestra nombres, emails ni textos: sólo ids, versiones y reasons.
//
// Contra Neon, usar la conexión DIRECTA (no el pooler -pooler.): --apply
// toma un pg_advisory_lock de sesión, que PgBouncer en modo transacción no
// garantiza.
//
// Con --apply regenera ÚNICAMENTE las sesiones indicadas con --session-ids,
// de a una, usando Ollama local (AI_PROVIDER=ollama) y el prompt vigente.
// Cada regeneración AGREGA una fila nueva en session_analyses: los análisis
// anteriores no se borran ni se modifican. Si la regeneración falla, el
// análisis anterior sigue siendo el último ok (y la API lo sigue ocultando
// si no cumple las reglas).
//
// Salvaguardas:
//  - --apply exige --session-ids explícitos (sin modo "todas").
//  - --apply exige --confirm-database con el nombre real de la base a la que
//    apunta la conexión (SELECT current_database()).
//  - Máximo MAX_PER_RUN sesiones por ejecución.
//  - Sólo sesiones con status=completed.
//
// Uso:
//   node scripts/regenerate-analyses.js                       (dry-run)
//   node scripts/regenerate-analyses.js --only-noncompliant   (dry-run filtrado)
//   node scripts/regenerate-analyses.js --apply --session-ids 13,10 --confirm-database neondb
//
// Requiere autorización explícita antes de ejecutarse con --apply contra
// producción.

import "dotenv/config";

const MAX_PER_RUN = 20;

function parseArgs(argv) {
  const args = { apply: false, onlyNoncompliant: false, sessionIds: [], confirmDatabase: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--only-noncompliant") args.onlyNoncompliant = true;
    else if (a === "--session-ids") {
      args.sessionIds = String(argv[i + 1] || "")
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      i += 1;
    } else if (a === "--confirm-database") {
      args.confirmDatabase = argv[i + 1] || null;
      i += 1;
    } else {
      throw new Error(`Argumento desconocido: ${a}`);
    }
  }
  return args;
}

export async function listAnalysesForReview(db, { reviewStoredAnalysis }) {
  // Último ok por sesión (DISTINCT ON). Sólo columnas técnicas.
  const rows = await db.raw(`
    SELECT DISTINCT ON (sa.session_id)
      sa.id, sa.session_id, sa.prompt_version, sa.schema_version, sa.model,
      sa.created_at, sa.analysis
    FROM session_analyses sa
    JOIN sessions s ON s.id = sa.session_id AND s.status = 'completed'
    WHERE sa.status = 'ok'
    ORDER BY sa.session_id, sa.created_at DESC, sa.id DESC
  `);
  return rows.rows.map((r) => {
    const review = reviewStoredAnalysis(r.analysis);
    return {
      analysis_id: r.id,
      session_id: r.session_id,
      prompt_version: r.prompt_version,
      schema_version: r.schema_version,
      model: r.model,
      compliant: review.compliant,
      reasons: review.reasons,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply) {
    if (args.sessionIds.length === 0) {
      throw new Error("--apply exige --session-ids explícitos (ej: --session-ids 13,10).");
    }
    if (args.sessionIds.length > MAX_PER_RUN) {
      throw new Error(`Máximo ${MAX_PER_RUN} sesiones por ejecución.`);
    }
    // La inferencia corre en este proceso contra Ollama local.
    process.env.AI_PROVIDER = "ollama";
    process.env.AI_ENABLED = "true";
  }

  const { default: db } = await import("../src/db/connection.js");
  const { reviewStoredAnalysis } = await import("../src/services/ai/contentSafety.js");
  const { PROMPT_BUILDER_VERSION } = await import("../src/services/ai/promptBuilder.js");

  try {
    const dbName = (await db.raw("SELECT current_database() AS name")).rows[0].name;
    console.log(`Base de datos: ${dbName} · prompt vigente: ${PROMPT_BUILDER_VERSION}`);

    const list = await listAnalysesForReview(db, { reviewStoredAnalysis });
    const shown = args.onlyNoncompliant ? list.filter((r) => !r.compliant) : list;
    console.table(shown.map((r) => ({
      session_id: r.session_id,
      analysis_id: r.analysis_id,
      prompt: r.prompt_version,
      cumple: r.compliant ? "sí" : "no",
      reasons: r.reasons.join(", "),
    })));
    console.log(`${list.filter((r) => !r.compliant).length} de ${list.length} análisis no cumplen las reglas vigentes.`);

    if (!args.apply) {
      console.log("Dry-run: no se modificó nada. Usá --apply --session-ids … --confirm-database … para regenerar.");
      return;
    }

    if (args.confirmDatabase !== dbName) {
      throw new Error(`--confirm-database debe ser exactamente '${dbName}'. No se regeneró nada.`);
    }

    const completed = await db("sessions").whereIn("id", args.sessionIds).andWhere("status", "completed").pluck("id");
    const missing = args.sessionIds.filter((id) => !completed.includes(id));
    if (missing.length > 0) {
      throw new Error(`Sesiones inexistentes o no completadas: ${missing.join(", ")}. No se regeneró nada.`);
    }

    const { generateSessionAnalysis } = await import("../src/services/ai/analysisService.js");
    for (const sessionId of args.sessionIds) {
      try {
        const result = await generateSessionAnalysis({ sessionId, force: true });
        console.log(`sesión ${sessionId}: ok (análisis ${result.analysis.id}, prompt ${result.analysis.prompt_version})`);
      } catch (err) {
        // Sólo el código y la reason: el mensaje puede contener texto del modelo.
        console.log(`sesión ${sessionId}: falló (${err?.code || err?.name}${err?.info?.reason ? `/${err.info.reason}` : ""}); se conserva el análisis anterior.`);
      }
    }
  } finally {
    await db.destroy();
  }
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
