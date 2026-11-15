// What a build of the UI is, and which API of the server it was built for (src/app/build.ts).
// vite.config.ts puts it into the bundle, where the about dialog shows it, and next to it as
// build.json, which an operator can fetch from a running UI and the release workflow reads for
// its notes and the image's labels.
//
// The release sets LAJSTROM_UI_VERSION (the tag), LAJSTROM_UI_COMMIT and LAJSTROM_UI_DATE
// (scripts/build-release.sh); any other build is "dev". The contract comes from the first line
// of openapi/server.yaml, which npm run update:openapi writes, and its info.version.

import { readFileSync } from "node:fs";

import { parse } from "yaml";

import type { BuildInfo, Contract } from "../src/app/build.ts";

/** The contract named by the text of openapi/server.yaml. */
export function parseContract(serverYaml: string): Contract {
  const head = /^# Vendored from lajstrom\/lajstrom@([0-9a-f]{40})\b(?: \(([^()\s]+)\))?/.exec(serverYaml);
  if (!head) throw new Error("openapi/server.yaml lacks its first line, # Vendored from lajstrom/lajstrom@<commit>");
  const api = (parse(serverYaml) as { info?: { version?: unknown } } | null)?.info?.version;
  if (typeof api !== "string" || !api) throw new Error("openapi/server.yaml has no info.version");
  return { api, serverCommit: head[1]!, serverVersion: head[2] ?? "" };
}

/** The build information from the environment and openapi/server.yaml below root. */
export function buildInfo(root: URL, env: Record<string, string | undefined> = process.env): BuildInfo {
  return {
    version: env.LAJSTROM_UI_VERSION || "dev",
    commit: env.LAJSTROM_UI_COMMIT ?? "",
    date: env.LAJSTROM_UI_DATE ?? "",
    contract: parseContract(readFileSync(new URL("openapi/server.yaml", root), "utf8")),
  };
}
