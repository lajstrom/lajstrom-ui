// Where the bundle is served from. A release is one bundle with relative asset paths
// (vite.config.ts), served below /ui/ by the image and at the root of a static origin, or
// anywhere else; its files are always in <base>assets/, so each module of it knows the base from
// its own URL. The router, config.json, the mock's service worker and the demo's openapi.yaml
// all hang below it. The dev server serves below import.meta.env.BASE_URL, /ui/.

/** The base for the URL of a module of the build: the directory that holds assets/. */
export function baseOf(moduleUrl: string): URL | null {
  const at = moduleUrl.lastIndexOf("/assets/");
  return at < 0 ? null : new URL(moduleUrl.slice(0, at + 1));
}

let base: URL | undefined;

/** The absolute URL of the bundle's directory, with a trailing slash. */
export function baseUrl(): URL {
  base ??=
    (import.meta.env.DEV ? null : baseOf(import.meta.url)) ?? new URL(import.meta.env.BASE_URL, window.location.href);
  return base;
}

/** The path of the bundle's directory: "/ui/", or "/" at the root of an origin. */
export function basePath(): string {
  return baseUrl().pathname;
}
