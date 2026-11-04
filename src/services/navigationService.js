import { SCREEN_NAMES } from "../constants/appConfig.js";
import { getActivityById } from "../data/activities.js";

// F2 — token del enlace de acceso (#/enlace/<token>).
//
// El token se lee UNA vez, se guarda sólo en memoria y se borra de la URL
// con history.replaceState antes de que se renderice nada: no queda en el
// historial del navegador, no lo ven scripts que se carguen después (p. ej.
// Google Identity Services en la pantalla de login) y, al estar en el
// fragmento, nunca viajó al servidor ni en el Referer.
const LOGIN_LINK_HASH = /^#\/?enlace\/([^/?#]+)/;
let capturedLoginLinkToken = null;

export function takeLoginLinkTokenFromUrl() {
  if (typeof window === "undefined") return capturedLoginLinkToken;
  const match = LOGIN_LINK_HASH.exec(window.location.hash);
  if (match) {
    capturedLoginLinkToken = match[1];
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/enlace`);
  }
  return capturedLoginLinkToken;
}

export function clearCapturedLoginLinkToken() {
  capturedLoginLinkToken = null;
}

export function readHashState() {
  if (typeof window === "undefined") {
    return { screen: SCREEN_NAMES.login, activityId: getActivityById().id, inviteToken: null };
  }
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw) return { screen: SCREEN_NAMES.login, activityId: getActivityById().id, inviteToken: null };
  const [screenPart, rest] = raw.split("/");
  if (screenPart === SCREEN_NAMES.activity) {
    return { screen: SCREEN_NAMES.activity, activityId: getActivityById(rest).id, inviteToken: null };
  }
  if (screenPart === SCREEN_NAMES.loginLink) {
    return { screen: SCREEN_NAMES.loginLink, activityId: getActivityById().id, inviteToken: null };
  }
  if (screenPart === SCREEN_NAMES.invite) {
    return { screen: SCREEN_NAMES.invite, activityId: getActivityById().id, inviteToken: rest || "" };
  }
  if (Object.values(SCREEN_NAMES).includes(screenPart)) {
    return { screen: screenPart, activityId: getActivityById().id, inviteToken: null };
  }
  return { screen: SCREEN_NAMES.login, activityId: getActivityById().id, inviteToken: null };
}

export function buildHash(screen, activityId) {
  return screen === SCREEN_NAMES.activity ? `#/activity/${getActivityById(activityId).id}` : `#/${screen}`;
}
