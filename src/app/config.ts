// Runtime configuration. The nginx image writes /ui/config.json from environment variables at
// container start (docker/40-lajstrom-ui.sh), so one image serves every environment; the dev
// server reads public/config.json.

export type UiConfig = {
  /** Base URL of the Lajstrom API; empty means the same origin (Ingress routes /api to it). */
  apiBaseUrl: string;
  /** The demo only: generated data from a service worker, no server (src/app/demo.ts). */
  mock: boolean;
  /** Offer the demo next to the server: "Open the demo" and ?demo=1. */
  demo: boolean;
  /** Instance name shown in the header and the page title. */
  title: string;
};

const defaults: UiConfig = { apiBaseUrl: "", mock: false, demo: true, title: "Lajstrom" };

let current: UiConfig = defaults;

export async function loadConfig(): Promise<UiConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as Partial<UiConfig>;
      current = {
        apiBaseUrl: typeof body.apiBaseUrl === "string" ? body.apiBaseUrl.replace(/\/+$/, "") : "",
        mock: body.mock === true || (body.mock as unknown) === "true",
        demo: body.demo !== false && (body.demo as unknown) !== "false",
        title: typeof body.title === "string" && body.title ? body.title : defaults.title,
      };
    }
  } catch {
    // No config.json: same-origin API, no mock.
  }
  return current;
}

export function config(): UiConfig {
  return current;
}
