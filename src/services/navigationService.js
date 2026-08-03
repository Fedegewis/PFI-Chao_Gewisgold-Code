import { SCREEN_NAMES } from "../constants/appConfig.js";
import { getActivityById } from "../data/activities.js";

export function readHashState() {
  if (typeof window === "undefined") {
    return { screen: SCREEN_NAMES.login, activityId: getActivityById().id };
  }
  const raw = window.location.hash.replace(/^#\/?/, "");
  if (!raw) return { screen: SCREEN_NAMES.login, activityId: getActivityById().id };
  const [screenPart, activityId] = raw.split("/");
  if (screenPart === SCREEN_NAMES.activity) {
    return { screen: SCREEN_NAMES.activity, activityId: getActivityById(activityId).id };
  }
  if (Object.values(SCREEN_NAMES).includes(screenPart)) {
    return { screen: screenPart, activityId: getActivityById().id };
  }
  return { screen: SCREEN_NAMES.login, activityId: getActivityById().id };
}

export function buildHash(screen, activityId) {
  return screen === SCREEN_NAMES.activity ? `#/activity/${getActivityById(activityId).id}` : `#/${screen}`;
}
