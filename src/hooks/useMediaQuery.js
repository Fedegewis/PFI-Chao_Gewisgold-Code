import { useSyncExternalStore } from "react";

// Debe coincidir con el breakpoint mobile de styles.css (@media (max-width: 760px)).
export const MOBILE_LAYOUT_QUERY = "(max-width: 760px)";

function getMediaQueryList(query) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(query);
}

// Devuelve true mientras la media query coincide. Sin matchMedia (jsdom, SSR)
// devuelve false: se conserva el layout de escritorio.
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const mql = getMediaQueryList(query);
      if (!mql) return () => {};
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => getMediaQueryList(query)?.matches ?? false,
    () => false
  );
}

export function useIsMobileLayout() {
  return useMediaQuery(MOBILE_LAYOUT_QUERY);
}
