import { Router } from "express";
import db from "../db/connection.js";

const router = Router();

router.get("/health", async (_req, res, next) => {
  try {
    await db.raw("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

export default router;
