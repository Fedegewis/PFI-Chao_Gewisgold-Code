import { generateToken } from "../src/middleware/auth.js";

export function authHeaderFor(user) {
  return `Bearer ${generateToken(user)}`;
}
