import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildInfo, parseContract } from "./build-info.ts";

const sha = "f0d887d5ebd9b34f49c9a1d528af6c6b60df2531";
const spec = (head: string) => `${head}\n# npm run update:openapi -- <ref> replaces it.\nopenapi: 3.1.0\ninfo:\n  title: Lajstrom management API\n  version: v1\npaths: {}\n`;

describe("parseContract", () => {
  it("takes the commit, the server's version at it and the API's version", () => {
    expect(parseContract(spec(`# Vendored from lajstrom/lajstrom@${sha} (v0.0.1-959-gf0d887d), internal/api/openapi.yaml. Do not edit:`))).toEqual({
      api: "v1",
      serverCommit: sha,
      serverVersion: "v0.0.1-959-gf0d887d",
    });
  });

  it("reads a first line without the server's version, as before it was written", () => {
    expect(parseContract(spec(`# Vendored from lajstrom/lajstrom@${sha}, internal/api/openapi.yaml. Do not edit:`)).serverVersion).toBe("");
  });

  it("refuses a file without its first line or without info.version", () => {
    expect(() => parseContract(spec("# something else"))).toThrow(/first line/);
    expect(() => parseContract(`# Vendored from lajstrom/lajstrom@${sha}\ninfo:\n  title: x\n`)).toThrow(/info.version/);
  });

  it("reads the vendored openapi/server.yaml", () => {
    const contract = parseContract(readFileSync(new URL("../openapi/server.yaml", import.meta.url), "utf8"));
    expect(contract.api).toBe("v1");
    expect(contract.serverCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("buildInfo", () => {
  const root = new URL("../", import.meta.url);

  it("is dev without the release's variables", () => {
    expect(buildInfo(root, {})).toMatchObject({ version: "dev", commit: "", date: "" });
  });

  it("takes the release's version, commit and date", () => {
    const env = { LAJSTROM_UI_VERSION: "v0.1.0", LAJSTROM_UI_COMMIT: "8d05e41", LAJSTROM_UI_DATE: "2026-11-15T10:00:00Z" };
    expect(buildInfo(root, env)).toMatchObject({ version: "v0.1.0", commit: "8d05e41", date: "2026-11-15T10:00:00Z" });
  });
});
