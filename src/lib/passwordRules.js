// Mismas reglas que backend/src/services/passwordPolicy.js. El backend es la
// fuente de verdad; esto sólo anticipa el error en el formulario.
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 72;

export function newPasswordError(password, confirm) {
  if (!password) return "Escribí una contraseña.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) {
    return `La contraseña no puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  if (password !== confirm) return "Las contraseñas no coinciden.";
  return null;
}
