// What this build of the UI is, and the server API it was built for: scripts/build-info.ts makes
// it at build time, vite.config.ts defines it as __LAJSTROM_UI_BUILD__ and writes it next to the
// bundle as build.json. The about dialog shows it.

/** The server's /api/v1 a bundle was built against. */
export type Contract = {
  /** The API's major version: the path prefix /api/v1 and info.version of openapi.yaml. */
  api: string;
  /** The commit of lajstrom/lajstrom whose internal/api/openapi.yaml is vendored. */
  serverCommit: string;
  /** That commit as git describe --tags names it in the server repository (v0.0.1-959-gf0d887d),
   * or a release tag; empty when the vendored file does not say. */
  serverVersion: string;
};

export type BuildInfo = {
  /** The UI's version: a release tag such as v0.1.0, or "dev". */
  version: string;
  /** The UI's commit, short; empty when unknown. */
  commit: string;
  /** The time of that commit in RFC 3339; empty when unknown. */
  date: string;
  contract: Contract;
};

declare const __LAJSTROM_UI_BUILD__: BuildInfo;

/** This build. */
export const build: BuildInfo = __LAJSTROM_UI_BUILD__;
