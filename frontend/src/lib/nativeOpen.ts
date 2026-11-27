/**
 * The browser's own window.open, captured before the in-app browser wraps it
 * (see browser/open.ts), so "open in system browser" never loops back in.
 */
export const nativeOpen: typeof window.open =
  typeof window !== "undefined" && typeof window.open === "function" ? window.open.bind(window) : () => null;
