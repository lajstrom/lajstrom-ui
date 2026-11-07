// The mock is only useful if it looks like what the server will store. This checks every mock
// manifest against the rules of docs/spec/manifest-profile.md.

import { describe, expect, it } from "vitest";

import { packagePath, tagFor } from "@/lib/profile";
import { sha256Hex } from "@/lib/sha256";

import { aptVersions } from "./apt";
import { buildVersion, EMPTY_CONFIG } from "./builders";
import { mavenVersions } from "./maven";
import { pypiVersions } from "./pypi";
import { rawVersions } from "./raw";

const specs = [...rawVersions(), ...pypiVersions(), ...aptVersions(), ...mavenVersions()];
const built = specs.map((s) => ({ spec: s, v: buildVersion(s, "art.example.com") }));

const required = ["lajstrom.schema", "lajstrom.format", "lajstrom.repo", "lajstrom.name", "lajstrom.version", "org.opencontainers.image.created"];
const artifactType = { raw: "raw", pypi: "pypi", apt: "deb", maven: "maven" } as const;

describe("mock manifests follow the manifest profile", () => {
  it.each(built.map(({ spec, v }) => [`${spec.format}/${spec.repo} ${spec.name} ${spec.version} ${spec.variant ?? ""}`, spec, v] as const))(
    "%s",
    (_label, spec, v) => {
      const m = v.manifest;
      // §1: manifest media type, artifactType per format, empty config.
      expect(m.mediaType).toBe("application/vnd.oci.image.manifest.v1+json");
      expect(m.artifactType).toBe(`application/vnd.lajstrom.${artifactType[spec.format]}.v1`);
      expect(m.config).toEqual(EMPTY_CONFIG);
      // §3: required annotations, values as the version says.
      for (const key of required) expect(m.annotations[key], key).toBeTruthy();
      expect(m.annotations["lajstrom.schema"]).toBe("1");
      expect(m.annotations["lajstrom.format"]).toBe(spec.format);
      expect(m.annotations["org.opencontainers.image.created"]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      // §1: every layer has a title; at most one metadata layer, and it is last.
      for (const l of m.layers) expect(l.annotations?.["org.opencontainers.image.title"]).toBeTruthy();
      const meta = m.layers.filter((l) => l.mediaType.endsWith(".metadata.v1+json"));
      expect(meta.length).toBeLessThanOrEqual(1);
      if (meta.length) expect(m.layers.at(-1)).toBe(meta[0]);
      // §2: file layer media types carry the format's prefix.
      for (const f of v.files) expect(f.mediaType.startsWith(`application/vnd.lajstrom.${artifactType[spec.format]}.`)).toBe(true);
      // §4: tag and repository path.
      expect(v.tag).toBe(tagFor(spec.version, spec.variant ?? ""));
      expect(v.ociReference).toBe(`art.example.com/${spec.format}/${spec.repo}/${packagePath(spec.format, spec.name)}:${v.tag}`);
      // The digest is the sha256 of the manifest JSON, as a registry computes it.
      expect(v.digest).toBe(`sha256:${sha256Hex(JSON.stringify(m))}`);
    },
  );

  it("never has two manifests with the same tag or the same (version, variant) in one package", () => {
    const tags = new Set<string>();
    const keys = new Set<string>();
    for (const { spec, v } of built) {
      const pkg = `${spec.format}/${spec.repo}/${spec.name}`;
      const tag = `${pkg}:${v.tag}`;
      const key = `${pkg}@${spec.version}/${spec.variant ?? ""}`;
      expect(tags.has(tag), tag).toBe(false);
      expect(keys.has(key), key).toBe(false);
      tags.add(tag);
      keys.add(key);
    }
  });

  it("gives raw files the first 16 hex digits of their sha256 as the version", () => {
    for (const { spec } of built.filter(({ spec }) => spec.format === "raw")) {
      expect(spec.version).toMatch(/^[0-9a-f]{16}$/);
      expect((spec.metadata as { sha256: string }).sha256.startsWith(spec.version)).toBe(true);
    }
  });
});
