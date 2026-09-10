import express from "express";
import healthRouter from "./routes/health.js";
import sectionsRouter from "./routes/sections.js";
import usersRouter from "./routes/users.js";
import sessionsRouter from "./routes/sessions.js";

const app = express();

app.use(express.json());

app.use("/api", healthRouter);
app.use("/api", sectionsRouter);
app.use("/api", usersRouter);
app.use("/api", sessionsRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Error interno del servidor" });
});

export default app;
