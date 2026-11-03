// 6F: tests unitarios de emailService (armado del email + configuración).
// Puro: no toca la base ni llama a Resend. El envío real sólo se prueba en
// la rama "no configurado", que corta antes de importar el SDK.
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import emailService, { buildInvitationEmail } from "../src/services/emailService.js";

const ENV_KEYS = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO", "EMAIL_LOGO_URL"];

const BASE = {
  patientName: "Ana López",
  professionalName: "Dra. Pérez",
  inviteUrl: "https://menteactiva.test/invite?token=abc",
  expiresAt: new Date("2026-11-10T15:30:00Z"),
};

describe("emailService.buildInvitationEmail", () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("devuelve subject, html y text con los datos de la invitación", () => {
    const { subject, html, text } = buildInvitationEmail(BASE);
    assert.equal(subject, "Invitación a MenteActiva");
    assert.match(text, /Hola Ana López,/);
    assert.match(text, /Dra\. Pérez te invitó/);
    assert.ok(text.includes(BASE.inviteUrl));
    assert.match(text, /Este enlace estará disponible hasta:/);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /¡Hola, Ana López!/);
    assert.ok(html.includes("https://menteactiva.test/invite?token=abc"));
  });

  it("escapa HTML en nombre, profesional y URL", () => {
    const { html } = buildInvitationEmail({
      ...BASE,
      patientName: `<script>alert("x")</script>`,
      professionalName: "O'Brien & Co",
      inviteUrl: `https://x.test/?a=1&b="2"`,
    });
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
    assert.ok(html.includes("O&#39;Brien &amp; Co"));
    assert.ok(html.includes("https://x.test/?a=1&amp;b=&quot;2&quot;"));
  });

  it("sin nombres usa saludos genéricos", () => {
    const { html, text } = buildInvitationEmail({ ...BASE, patientName: "", professionalName: "" });
    assert.match(html, /¡Hola!/);
    assert.match(html, /Tu profesional/);
    assert.match(text, /Tu profesional te invitó/);
  });

  it("sin expiresAt o con fecha inválida omite la línea de vencimiento", () => {
    for (const expiresAt of [null, "no-es-fecha"]) {
      const { text } = buildInvitationEmail({ ...BASE, expiresAt });
      assert.doesNotMatch(text, /disponible hasta/);
    }
  });

  it("acepta expiresAt como string ISO", () => {
    const { text } = buildInvitationEmail({ ...BASE, expiresAt: "2026-11-10T15:30:00Z" });
    assert.match(text, /disponible hasta: .*2026/);
  });

  it("usa EMAIL_LOGO_URL sólo si es HTTPS", () => {
    process.env.EMAIL_LOGO_URL = "  https://cdn.test/logo.png  ";
    assert.ok(buildInvitationEmail(BASE).html.includes(`<img src="https://cdn.test/logo.png"`));

    for (const value of ["http://cdn.test/logo.png", "   ", "/logo.png"]) {
      process.env.EMAIL_LOGO_URL = value;
      const { html } = buildInvitationEmail(BASE);
      assert.ok(!html.includes("<img"), `no debería usar <img> con ${JSON.stringify(value)}`);
      assert.ok(html.includes("<svg"));
    }
  });
});

describe("emailService (configuración)", () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("isConfigured exige RESEND_API_KEY y EMAIL_FROM", () => {
    assert.equal(emailService.isConfigured(), false);
    process.env.RESEND_API_KEY = "re_test_dummy";
    assert.equal(emailService.isConfigured(), false);
    process.env.EMAIL_FROM = "MenteActiva <no-reply@menteactiva.test>";
    assert.equal(emailService.isConfigured(), true);
  });

  it("sendInvitationEmail sin configuración falla con email_not_configured", async () => {
    await assert.rejects(
      emailService.sendInvitationEmail({ to: "ana@menteactiva.test", ...BASE }),
      (err) => err.code === "email_not_configured"
    );
  });
});
