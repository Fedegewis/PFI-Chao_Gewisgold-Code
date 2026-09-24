import { SCREEN_NAMES } from "../constants/appConfig.js";
import { getActivityById } from "../data/activities.js";

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
