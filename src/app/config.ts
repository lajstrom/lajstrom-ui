// Runtime configuration: config.json next to index.html, wherever the bundle is served. The nginx
// image writes it from environment variables at container start, or serves a mounted one
// (docker/40-lajstrom-ui.sh), so one image serves every environment; the dev server reads
// public/config.json. README.md, Configuration, describes the file.
//
// The file has a version, "schema": 1. A missing file means the defaults. A file that is not
// JSON, has another schema, or a value of the wrong kind stops the start-up on a page that names
// the problem (src/app/startup.tsx): a guess would be worse, such as talking to the wrong API.

import { baseUrl } from "./base";

/** White label: what the UI shows as the instance's own. The Lajstrom and UI versions stay in
 * the about dialog. */
export type Branding = {
  /** Instance name in the header and the page title. */
  title: string;
  /** The header's logo: a URL relative to the bundle (branding/logo.svg), an http(s) URL or a
   * data:image URL; empty for Lajstrom's mark. */
  logo: string;
  /** The primary colour, #rgb or #rrggbb, of the light theme and of the dark one; empty for
   * Lajstrom's blue. The dark theme takes the light one's colour when it has none of its own. */
  colors: { primary: string; primaryDark: string };
  /** Where to get help: http(s) or mailto; shown in the about dialog and on the error pages. */
  supportUrl: string;
};

export type UiConfig = {
  schema: 1;
  /** Base URL of the Lajstrom API; empty means the same origin (Ingress routes /api to it). */
  apiBaseUrl: string;
  /** The demo only: generated data from a service worker, no server (src/app/demo.ts). */
  mock: boolean;
  /** Offer the demo next to the server: "Open the demo" and ?demo=1. */
  demo: boolean;
  branding: Branding;
};

export const defaultConfig: UiConfig = {
  schema: 1,
  apiBaseUrl: "",
  mock: false,
  demo: true,
  branding: { title: "Lajstrom", logo: "", colors: { primary: "", primaryDark: "" }, supportUrl: "" },
};

/** What reading config.json gave: the configuration, with warnings about keys this UI does not
 * know, or the problem that stops the start-up. */
export type ConfigResult = { ok: true; config: UiConfig; warnings: string[] } | { ok: false; problem: string };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

class Invalid extends Error {}

/** Reads one object of the file: its known keys with their checks, a warning for any other. */
function fields(obj: Json, path: string, known: string[], warnings: string[]) {
  for (const key of Object.keys(obj)) {
    if (!known.includes(key)) warnings.push(`config.json: ${path}${key} is not a setting of schema 1; it is ignored`);
  }
  const named = (key: string) => `"${path}${key}"`;
  return {
    string(key: string, fallback: string, check?: (v: string) => string | null): string {
      const v = obj[key];
      if (v === undefined || v === null) return fallback;
      if (typeof v !== "string") throw new Invalid(`${named(key)} must be a string, not ${JSON.stringify(v)}`);
      const wrong = v === "" ? null : check?.(v);
      if (wrong) throw new Invalid(`${named(key)} ${wrong}, not ${JSON.stringify(v)}`);
      return v;
    },
    boolean(key: string, fallback: boolean): boolean {
      const v = obj[key];
      if (v === undefined || v === null) return fallback;
      if (typeof v !== "boolean") throw new Invalid(`${named(key)} must be true or false, not ${JSON.stringify(v)}`);
      return v;
    },
    object(key: string): Json {
      const v = obj[key];
      if (v === undefined || v === null) return {};
      if (!isObject(v)) throw new Invalid(`${named(key)} must be an object, not ${JSON.stringify(v)}`);
      return v;
    },
  };
}

const httpUrl = (v: string) => (/^https?:\/\/[^/\s]+/i.test(v) ? null : "must be an http(s) URL");
const color = (v: string) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? null : "must be a colour as #rgb or #rrggbb");
const supportUrl = (v: string) => (/^(?:https?:\/\/[^/\s]+|mailto:\S+)/i.test(v) ? null : "must be an http(s) or mailto: URL");
/** A logo: relative to the bundle, http(s), or an image as a data: URL; no other scheme. */
const logoUrl = (v: string) =>
  /^(?:https?:\/\/[^/\s]+|data:image\/)/i.test(v) || (!/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith("//"))
    ? null
    : "must be a path relative to the bundle, an http(s) URL or a data:image URL";

/** The configuration in the text of a config.json. */
export function parseConfig(text: string): ConfigResult {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (err) {
    return { ok: false, problem: `config.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!isObject(body)) return { ok: false, problem: "config.json must hold a JSON object, such as {\"schema\": 1}" };
  if (!("schema" in body)) return { ok: false, problem: "config.json has no \"schema\"; this UI reads \"schema\": 1" };
  if (body.schema !== 1) {
    return { ok: false, problem: `config.json has "schema": ${JSON.stringify(body.schema)}; this UI reads "schema": 1 only` };
  }

  const warnings: string[] = [];
  try {
    const top = fields(body, "", ["schema", "apiBaseUrl", "mock", "demo", "branding"], warnings);
    const b = fields(top.object("branding"), "branding.", ["title", "logo", "colors", "supportUrl"], warnings);
    const c = fields(b.object("colors"), "branding.colors.", ["primary", "primaryDark"], warnings);
    const d = defaultConfig;
    return {
      ok: true,
      warnings,
      config: {
        schema: 1,
        apiBaseUrl: top.string("apiBaseUrl", d.apiBaseUrl, httpUrl).replace(/\/+$/, ""),
        mock: top.boolean("mock", d.mock),
        demo: top.boolean("demo", d.demo),
        branding: {
          title: b.string("title", d.branding.title) || d.branding.title,
          logo: b.string("logo", d.branding.logo, logoUrl),
          colors: { primary: c.string("primary", "", color), primaryDark: c.string("primaryDark", "", color) },
          supportUrl: b.string("supportUrl", d.branding.supportUrl, supportUrl),
        },
      },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, problem: `config.json: ${err.message}` };
    throw err;
  }
}

/** The address of config.json: next to index.html. */
export function configUrl(): URL {
  return new URL("config.json", baseUrl());
}

let current: UiConfig = defaultConfig;

/** Reads config.json. Missing is the defaults: a 404, or the index.html that a static host
 * answers for a path it has no file for. */
export async function loadConfig(): Promise<ConfigResult> {
  const url = configUrl();
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch (err) {
    return { ok: false, problem: `config.json could not be read: ${err instanceof Error ? err.message : String(err)}` };
  }
  const text = res.ok ? await res.text() : "";
  const html = /\btext\/html\b/i.test(res.headers.get("content-type") ?? "") || /^\s*</.test(text);
  if (res.status === 404 || (res.ok && html)) {
    current = defaultConfig;
    return { ok: true, config: current, warnings: [] };
  }
  if (!res.ok) return { ok: false, problem: `config.json could not be read: the answer was ${res.status} ${res.statusText}`.trim() };
  const result = parseConfig(text);
  if (result.ok) current = result.config;
  return result;
}

export function config(): UiConfig {
  return current;
}

/** The logo's URL, resolved against the bundle; empty for Lajstrom's mark. */
export function logoSrc(): string {
  const logo = current.branding.logo;
  return logo ? new URL(logo, baseUrl()).href : "";
}
