// Política de contraseñas compartida por los endpoints que fijan o cambian la
// contraseña de un paciente (profesional dueño y el propio paciente).
// Mismo mínimo que /auth/register e invitaciones.
import bcrypt from "bcrypt";

export const MIN_PASSWORD_LENGTH = 6;
// bcrypt ignora lo que supere los 72 bytes; un tope evita hashear cuerpos
// enormes y que dos contraseñas distintas coincidan sin que se note.
export const MAX_PASSWORD_LENGTH = 72;
const SALT_ROUNDS = 10;

// Devuelve el mensaje de error, o null si la contraseña es válida.
export function validateNewPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    return "Escribí una contraseña.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_LENGTH) {
    return `La contraseña no puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}
