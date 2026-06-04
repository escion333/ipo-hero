export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

/** Reads the persisted manual override, or "system" when unset. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable (private mode); fall through to system.
  }
  return "system";
}

/**
 * Applies a theme by toggling the .light/.dark class on <html>. "system" clears
 * the class so prefers-color-scheme governs (matches the inline no-flash script
 * in index.html and the CSS in styles.css).
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage write failed; the class change still applies for this session.
  }
}
