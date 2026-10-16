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

// Diseño del email de invitación.
// Reglas: tablas para estructura (compat Outlook), estilos inline,
// paleta tomada del frontend (src/styles.css), sin JS, sin imágenes externas
// ni base64. El "logo" es un badge tipográfico — funciona en todos los
// clientes y evita problemas de carga de imágenes/alt rotos.
// Si `EMAIL_LOGO_URL` apunta a una URL HTTPS pública (p. ej. el PNG
// hosteado en el frontend desplegado), el correo usa esa imagen —
// mejor compatibilidad con Gmail/Outlook. En caso contrario, se cae
// al SVG inline, que funciona en Apple Mail, iOS Mail, Thunderbird y
// webmails modernos. Nunca se referencia una URL inventada ni local.
function resolveLogoUrl() {
  const raw = process.env.EMAIL_LOGO_URL;
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https:\/\//i.test(trimmed)) return null;
  return trimmed;
}

const BRAND = {
  primary: "#617a58",
  primaryDark: "#30442a",
  text: "#172114",
  muted: "#52624d",
  cream: "#f7f1e7",
  sage: "#e4ecdf",
  border: "rgba(97, 122, 88, 0.34)",
  containerBorder: "#d5decf",
};

export function buildInvitationEmail({ patientName, professionalName, inviteUrl, expiresAt }) {
  const safeName = escapeHtml(patientName || "");
  const safePro = escapeHtml(professionalName || "Tu profesional");
  const safeUrl = escapeHtml(inviteUrl);
  const formattedDate = formatExpiresAt(expiresAt);
  const safeDate = escapeHtml(formattedDate);

  const logoUrl = resolveLogoUrl();
  const safeLogoUrl = logoUrl ? escapeHtml(logoUrl) : null;

  const subject = "Invitación a MenteActiva";

  const text = [
    `Hola ${patientName || ""},`,
    "",
    `¡Te damos la bienvenida a MenteActiva!`,
    "",
    `${professionalName || "Tu profesional"} te invitó a formar parte de MenteActiva.`,
    "",
    "MenteActiva es un espacio de entrenamiento cognitivo donde podrás realizar actividades diseñadas para estimular diferentes capacidades cognitivas.",
    "",
    "Para comenzar, creá tu cuenta ingresando al siguiente enlace:",
    inviteUrl,
    "",
    formattedDate ? `Este enlace estará disponible hasta: ${formattedDate}.` : "",
    "",
    "Si no esperabas esta invitación, podés ignorar este mensaje.",
    "",
    "— MenteActiva · Entrenamiento cognitivo",
  ].filter(Boolean).join("\n");

  const greeting = safeName
    ? `¡Hola, ${safeName}!`
    : "¡Hola!";

  // Estructura con tablas anidadas para máxima compatibilidad (Outlook/Gmail).
  // Ancho 600px, contenedor blanco centrado sobre fondo crema.
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .ma-container { width: 100% !important; }
    .ma-pad { padding-left: 24px !important; padding-right: 24px !important; }
    .ma-title { font-size: 24px !important; line-height: 32px !important; }
    .ma-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.cream};color:${BRAND.text};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${safePro} te invitó a MenteActiva. Creá tu cuenta para comenzar.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" class="ma-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border:1px solid ${BRAND.containerBorder};border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">

          <!-- Header / Logo -->
          <tr>
            <td class="ma-pad" align="center" style="padding:40px 40px 24px 40px;background-color:#ffffff;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom:16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" valign="middle" width="72" height="72" style="width:72px;height:72px;background-color:${BRAND.primary};border-radius:16px;text-align:center;line-height:72px;" aria-label="MenteActiva">
                          ${safeLogoUrl ? `
                          <!-- Logo oficial MenteActiva como PNG hosteado (compatible con Gmail/Outlook). -->
                          <img src="${safeLogoUrl}" width="72" height="72" alt="MenteActiva" style="display:block;width:72px;height:72px;border:0;outline:none;border-radius:16px;" />
                          ` : `
                          <!-- Fallback: SVG inline del ícono Brain (idéntico a favicon.svg y al header de la app). -->
                          <!-- Se usa cuando EMAIL_LOGO_URL no está configurada. Funciona en Apple Mail, iOS Mail, -->
                          <!-- Thunderbird y la mayoría de webmails modernos. En Gmail/Outlook queda el badge verde -->
                          <!-- + el wordmark "MenteActiva" debajo, preservando la identidad visual. -->
                          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="MenteActiva" style="vertical-align:middle;">
                            <title>MenteActiva</title>
                            <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
                            <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
                            <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
                            <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
                            <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
                            <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
                            <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
                            <path d="M6 18a4 4 0 0 1-1.967-.516"/>
                            <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
                            <path d="M12 18v4"/>
                          </svg>
                          `}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="color:${BRAND.primaryDark};font-size:14px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding-bottom:8px;">
                    MenteActiva
                  </td>
                </tr>
                <tr>
                  <td align="center" class="ma-title" style="color:${BRAND.primaryDark};font-size:28px;line-height:36px;font-weight:800;padding:4px 0 0 0;">
                    ¡Te damos la bienvenida a MenteActiva!
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Separator -->
          <tr>
            <td class="ma-pad" style="padding:0 40px;">
              <div style="height:1px;background-color:${BRAND.containerBorder};line-height:1px;font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="ma-pad" style="padding:32px 40px 8px 40px;color:${BRAND.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:16px;line-height:24px;">
              <p style="margin:0 0 16px 0;font-size:17px;font-weight:600;color:${BRAND.text};">
                ${greeting}
              </p>
              <p style="margin:0 0 16px 0;color:${BRAND.text};">
                <strong style="color:${BRAND.primaryDark};">${safePro}</strong> te invitó a formar parte de MenteActiva.
              </p>
              <p style="margin:0 0 16px 0;color:${BRAND.muted};">
                MenteActiva es un espacio de entrenamiento cognitivo donde podrás realizar actividades diseñadas para estimular diferentes capacidades cognitivas.
              </p>
              <p style="margin:0 0 8px 0;color:${BRAND.muted};">
                Para comenzar, creá tu cuenta utilizando el siguiente botón.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="ma-pad" align="center" style="padding:16px 40px 32px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="border-radius:10px;background-color:${BRAND.primary};">
                    <a href="${safeUrl}" class="ma-cta" style="display:inline-block;padding:16px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;border:1px solid ${BRAND.primary};mso-padding-alt:16px 32px;">
                      Crear mi cuenta
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0 0;font-size:13px;color:${BRAND.muted};line-height:20px;">
                Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br>
                <a href="${safeUrl}" style="color:${BRAND.primary};word-break:break-all;">${safeUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Info box -->
          <tr>
            <td class="ma-pad" style="padding:0 40px 32px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.sage};border-radius:10px;">
                <tr>
                  <td style="padding:20px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${BRAND.primaryDark};font-size:14px;line-height:22px;">
                    <p style="margin:0 0 8px 0;font-weight:800;color:${BRAND.primaryDark};">
                      Información importante
                    </p>
                    ${safeDate ? `<p style="margin:0 0 8px 0;color:${BRAND.primaryDark};">
                      Este enlace estará disponible hasta <strong>${safeDate}</strong>.
                    </p>` : ""}
                    <p style="margin:0;color:${BRAND.primaryDark};">
                      Si no esperabas esta invitación, podés ignorar este mensaje.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="ma-pad" align="center" style="padding:24px 40px 32px 40px;background-color:#ffffff;border-top:1px solid ${BRAND.containerBorder};">
              <p style="margin:0 0 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:800;color:${BRAND.primaryDark};">
                MenteActiva
              </p>
              <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:13px;color:${BRAND.muted};">
                Entrenamiento cognitivo
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
