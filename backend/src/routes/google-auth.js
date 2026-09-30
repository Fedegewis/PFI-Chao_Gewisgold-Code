import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import db from "../db/connection.js";
import { generateToken } from "../middleware/auth.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

let defaultVerifier;
if (GOOGLE_CLIENT_ID) {
  const client = new OAuth2Client(GOOGLE_CLIENT_ID);
  defaultVerifier = async (credential) => {
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    return ticket.getPayload();
  };
}

export function createGoogleAuthRouter(verifyGoogleToken = defaultVerifier) {
  const router = Router();

  router.post("/auth/google", async (req, res, next) => {
    // [DEBUG-TEMP google-auth] Retirar cuando se cierre el bug.
    const tRoute0 = Date.now();
    // eslint-disable-next-line no-console
    console.debug(`[google-auth][route] POST enter t=${tRoute0} hasCred=${!!req.body?.credential}`);
    try {
      if (!verifyGoogleToken) {
        return res.status(501).json({ error: "Google Auth no está configurado en el servidor" });
      }

      const { credential } = req.body;
      if (!credential) {
        return res.status(400).json({ error: "credential es obligatorio" });
      }

      let payload;
      try {
        const tVerify0 = Date.now();
        payload = await verifyGoogleToken(credential);
        // eslint-disable-next-line no-console
        console.debug(`[google-auth][route] verifyIdToken OK in ${Date.now() - tVerify0}ms`);
      } catch (verifyErr) {
        // eslint-disable-next-line no-console
        console.debug(`[google-auth][route] verifyIdToken FAILED after ${Date.now() - tRoute0}ms name=${verifyErr?.name} message=${verifyErr?.message}`);
        return res.status(401).json({ error: "Token de Google inválido" });
      }

      if (!payload.email_verified) {
        return res.status(401).json({ error: "El email de Google no está verificado" });
      }

      const googleId = payload.sub;
      const email = payload.email.toLowerCase();
      const name = payload.name || email;

      const existingByGoogleId = await db("users").where("google_id", googleId).first();

      if (existingByGoogleId) {
        if (existingByGoogleId.role !== "professional") {
          return res.status(403).json({ error: "Google Auth está disponible solo para profesionales" });
        }
        if (!existingByGoogleId.is_active) {
          return res.status(401).json({ error: "Cuenta desactivada" });
        }

        const token = generateToken(existingByGoogleId);
        // eslint-disable-next-line no-console
        console.debug(`[google-auth][route] responding 200 existing-by-google_id total=${Date.now() - tRoute0}ms userId=${existingByGoogleId.id}`);
        return res.json({
          user: {
            id: existingByGoogleId.id,
            role: existingByGoogleId.role,
            name: existingByGoogleId.name,
            email: existingByGoogleId.email,
            is_active: existingByGoogleId.is_active,
            created_at: existingByGoogleId.created_at,
          },
          token,
        });
      }

      const existingByEmail = await db("users").where("email", email).first();

      if (existingByEmail) {
        if (existingByEmail.role !== "professional") {
          return res.status(403).json({ error: "Google Auth está disponible solo para profesionales" });
        }
        if (!existingByEmail.is_active) {
          return res.status(401).json({ error: "Cuenta desactivada" });
        }

        await db("users").where("id", existingByEmail.id).update({ google_id: googleId });

        const token = generateToken(existingByEmail);
        // eslint-disable-next-line no-console
        console.debug(`[google-auth][route] responding 200 linked-by-email total=${Date.now() - tRoute0}ms userId=${existingByEmail.id}`);
        return res.json({
          user: {
            id: existingByEmail.id,
            role: existingByEmail.role,
            name: existingByEmail.name,
            email: existingByEmail.email,
            is_active: existingByEmail.is_active,
            created_at: existingByEmail.created_at,
          },
          token,
        });
      }

      const [newUser] = await db("users")
        .insert({
          role: "professional",
          name,
          email,
          google_id: googleId,
          auth_provider: "google",
        })
        .returning(["id", "role", "name", "email", "is_active", "created_at"]);

      const token = generateToken(newUser);
      // eslint-disable-next-line no-console
      console.debug(`[google-auth][route] responding 201 new user total=${Date.now() - tRoute0}ms`);
      res.status(201).json({ user: newUser, token });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug(`[google-auth][route] ROUTE THREW after ${Date.now() - tRoute0}ms name=${err?.name} message=${err?.message}`);
      next(err);
    }
  });

  return router;
}

export default createGoogleAuthRouter();
