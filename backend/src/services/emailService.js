// 6F: envío de invitaciones por email vía Resend.
//
// Se expone un singleton `emailService` con los métodos `isConfigured()` y
// `sendInvitationEmail(...)`. En tests, esos métodos se pueden sobreescribir
// porque los ES modules comparten la misma referencia entre imports.
//
// El SDK de Resend se carga de forma lazy: si `RESEND_API_KEY` no está
// definida, nunca lo importamos y el server puede arrancar sin la dependencia
// productiva funcionando. `POST /api/invitations` (crear + copiar link)
// funciona sin email configurado.

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatExpiresAt(expiresAt) {
  if (!expiresAt) return "";
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString("es-AR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString();
  }
}

export function buildInvitationEmail({ patientName, professionalName, inviteUrl, expiresAt }) {
  const safeName = escapeHtml(patientName || "");
  const safePro = escapeHtml(professionalName || "");
  const safeUrl = escapeHtml(inviteUrl);
  const safeDate = escapeHtml(formatExpiresAt(expiresAt));

  const subject = "Invitación a MenteActiva";
  const text = [
    `Hola ${patientName || ""},`,
    "",
    `${professionalName || "Tu profesional"} te invitó a utilizar MenteActiva.`,
    "",
    "Para crear tu cuenta y acceder a tus actividades, utilizá el siguiente enlace:",
    inviteUrl,
    "",
    safeDate ? `Este enlace vence el ${formatExpiresAt(expiresAt)}.` : "",
    "",
    "Si no esperabas esta invitación, podés ignorar este mensaje.",
  ].filter(Boolean).join("\n");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hola ${safeName},</p>
  <p>${safePro} te invitó a utilizar <strong>MenteActiva</strong>.</p>
  <p>Para crear tu cuenta y acceder a tus actividades, hacé clic en el siguiente enlace:</p>
  <p style="margin: 24px 0;">
    <a href="${safeUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 20px; border-radius: 6px; text-decoration: none;">Acceder a MenteActiva</a>
  </p>
  ${safeDate ? `<p style="color: #6b7280; font-size: 14px;">Este enlace vence el ${safeDate}.</p>` : ""}
  <p style="color: #6b7280; font-size: 14px;">Si no esperabas esta invitación, podés ignorar este mensaje.</p>
</body></html>`;

  return { subject, html, text };
}

async function realSend({ to, patientName, professionalName, inviteUrl, expiresAt }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const replyTo = process.env.EMAIL_REPLY_TO;
  if (!apiKey || !from) {
    const err = new Error("Email service not configured");
    err.code = "email_not_configured";
    throw err;
  }
  const { Resend } = await import("resend");
  const client = new Resend(apiKey);
  const { subject, html, text } = buildInvitationEmail({
    patientName,
    professionalName,
    inviteUrl,
    expiresAt,
  });
  const payload = { from, to, subject, html, text };
  if (replyTo) payload.replyTo = replyTo;
  const result = await client.emails.send(payload);
  // Resend SDK devuelve { data, error }. Un error del provider viene como campo `error`.
  if (result && result.error) {
    const err = new Error("Email provider error");
    err.code = "email_provider_error";
    err.providerError = result.error;
    throw err;
  }
  return result && result.data ? { id: result.data.id } : { id: null };
}

const emailService = {
  isConfigured() {
    return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  },
  async sendInvitationEmail(payload) {
    return realSend(payload);
  },
};

export default emailService;
