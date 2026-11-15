// The instance's branding from config.json: its title, and its primary colour in place of
// Lajstrom's blue, with the shades the theme derives from it (src/styles.css). The logo and the
// support link are shown where they belong (shell, about dialog, error pages).

import type { Branding } from "./config";

/** CSS for the brand colours: :root for the light theme, .dark for the dark one. Empty without
 * colours. The values are checked colours (src/app/config.ts), so nothing else gets in. */
export function brandingCss(colors: Branding["colors"]): string {
  const light = colors.primary;
  const dark = colors.primaryDark || colors.primary;
  if (!light && !dark) return "";
  const rules: string[] = [];
  if (light) {
    rules.push(
      `:root{--primary:${light};--ring:${light};--primary-hover:color-mix(in oklab,${light} 85%,black);` +
        `--primary-soft:color-mix(in oklab,${light} 10%,white);--primary-soft-foreground:color-mix(in oklab,${light} 80%,black)}`,
    );
  }
  if (dark) {
    rules.push(
      `.dark{--primary:${dark};--ring:${dark};--primary-hover:color-mix(in oklab,${dark} 80%,white);` +
        `--primary-soft:color-mix(in oklab,${dark} 20%,#0d1117);--primary-soft-foreground:color-mix(in oklab,${dark} 65%,white)}`,
    );
  }
  return rules.join("\n");
}

/** Puts the branding on the page: the title, and the colours as a stylesheet after the app's. */
export function applyBranding(branding: Branding): void {
  document.title = branding.title;
  const css = brandingCss(branding.colors);
  if (!css) return;
  const style = document.createElement("style");
  style.id = "lajstrom-branding";
  style.textContent = css;
  document.head.append(style);
}
