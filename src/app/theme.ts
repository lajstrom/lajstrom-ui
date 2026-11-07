import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const KEY = "lajstrom.theme";
const listeners = new Set<() => void>();
const media = window.matchMedia("(prefers-color-scheme: dark)");

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

media.addEventListener("change", () => {
  if (stored() === "system") apply("system");
  listeners.forEach((l) => l());
});

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage disabled: the theme lasts until reload.
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export function useTheme(): { theme: Theme; resolved: "light" | "dark" } {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stored,
  );
  const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
  return { theme, resolved };
}
