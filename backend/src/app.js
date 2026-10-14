import "dotenv/config";
import express from "express";
import cors from "cors";
import healthRouter from "./routes/health.js";
import sectionsRouter from "./routes/sections.js";
import usersRouter from "./routes/users.js";
import sessionsRouter from "./routes/sessions.js";
import authRouter from "./routes/auth.js";
import googleAuthRouter from "./routes/google-auth.js";
import invitationsRouter from "./routes/invitations.js";
import analysisRouter from "./routes/analysis.js";
import trainingConfigRouter from "./routes/training-config.js";

const app = express();

// 6E.1 (H3): CORS con allowlist explícita.
// - CORS_ORIGINS: lista separada por comas (allowlist multi-origen, recomendado en prod).
// - CORS_ORIGIN: single origin (compatibilidad hacia atrás, sigue funcionando).
// - Default de desarrollo: http://localhost:5173 y http://localhost:5179.
// NO se usan wildcards ni origin:true. Cada origen productivo o preview debe agregarse
// explícitamente a CORS_ORIGINS. Requests sin Origin (curl, health checks) se aceptan.
const corsOriginsRaw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN;
const corsAllowlist = corsOriginsRaw
  ? corsOriginsRaw.split(",").map((o) => o.trim()).filter(Boolean)
  : ["http://localhost:5173", "http://localhost:5179"];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsAllowlist.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
}));
app.use(express.json());

app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", googleAuthRouter);
app.use("/api", sectionsRouter);
app.use("/api", usersRouter);
app.use("/api", sessionsRouter);
app.use("/api", invitationsRouter);
app.use("/api", analysisRouter);
app.use("/api", trainingConfigRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Error interno del servidor" });
});

export default app;
