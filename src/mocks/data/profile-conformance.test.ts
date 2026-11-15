// The mock is only useful if it looks like what the server will store. This checks every mock
// manifest against the rules of docs/spec/manifest-profile.md.

import { describe, expect, it } from "vitest";

import { packagePath, tagFor } from "@/lib/profile";
import { sha256Hex } from "@/lib/sha256";

import { aptVersions } from "./apt";
import { buildVersion, EMPTY_CONFIG } from "./builders";
import { mavenVersions } from "./maven";
import { npmDistTags, npmVersions } from "./npm";
import { pypiVersions } from "./pypi";
import { rawVersions } from "./raw";
import { rpmVersions } from "./rpm";

const specs = [...rawVersions(), ...pypiVersions(), ...aptVersions(), ...mavenVersions(), ...npmVersions(), ...rpmVersions()];
const built = specs.map((s) => ({ spec: s, v: buildVersion(s, "art.example.com") }));

const required = ["lajstrom.schema", "lajstrom.format", "lajstrom.repo", "lajstrom.name", "lajstrom.version", "org.opencontainers.image.created"];
const artifactType = { raw: "raw", pypi: "pypi", apt: "deb", maven: "maven", npm: "npm", rpm: "rpm" } as const;

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

  it("has npm and rpm versions to check", () => {
    expect(built.filter(({ spec }) => spec.format === "npm").length).toBeGreaterThan(0);
    expect(built.filter(({ spec }) => spec.format === "rpm").length).toBeGreaterThan(0);
  });

  // §1–§3, npm: one tarball, titled with the name without its scope; integrity and shasum on the
  // layer; no variant and no lajstrom.npm.* on a version; a SemVer version without build metadata.
  it.each(built.filter(({ spec }) => spec.format === "npm").map(({ spec, v }) => [`${spec.name}@${spec.version}`, spec, v] as const))(
    "npm %s",
    (_label, spec, v) => {
      const m = v.manifest;
      const files = m.layers.filter((l) => !l.mediaType.endsWith(".metadata.v1+json"));
      expect(files).toHaveLength(1);
      const tarball = files[0]!;
      expect(tarball.mediaType).toBe("application/vnd.lajstrom.npm.tarball.v1.tar+gzip");
      const base = spec.name.startsWith("@") ? spec.name.slice(spec.name.indexOf("/") + 1) : spec.name;
      expect(tarball.annotations?.["org.opencontainers.image.title"]).toBe(`${base}-${spec.version}.tgz`);
      expect(tarball.annotations?.["lajstrom.npm.integrity"]).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
      expect(tarball.annotations?.["lajstrom.npm.shasum"]).toMatch(/^[0-9a-f]{40}$/);
      expect(m.annotations["lajstrom.variant"]).toBeUndefined();
      expect(Object.keys(m.annotations).filter((k) => k.startsWith("lajstrom.npm."))).toEqual([]);
      expect(spec.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/);
      // §2: the metadata layer agrees with the annotations and the tarball layer.
      const md = spec.metadata as Record<string, unknown>;
      expect(md).toMatchObject({
        name: spec.name,
        version: spec.version,
        filename: tarball.annotations?.["org.opencontainers.image.title"],
        size: tarball.size,
        integrity: tarball.annotations?.["lajstrom.npm.integrity"],
        shasum: tarball.annotations?.["lajstrom.npm.shasum"],
      });
      expect(typeof md.hasShrinkwrap).toBe("boolean");
      expect(typeof md.hasInstallScript).toBe("boolean");
      const doc = md.manifest as Record<string, unknown>;
      expect(doc).toMatchObject({ name: spec.name, version: spec.version });
      expect(Object.keys(doc).filter((k) => k === "dist" || k === "readme" || k.startsWith("_"))).toEqual([]);
    },
  );

  // §8: a dist-tag is a name that never begins with a digit, and names a version of its package.
  it("names only versions the package has with its dist-tags", () => {
    for (const { repo, name, tags } of npmDistTags()) {
      const versions = specs.filter((s) => s.format === "npm" && s.repo === repo && s.name === name).map((s) => s.version);
      for (const [tag, version] of Object.entries(tags)) {
        expect(tag).toMatch(/^[A-Za-z][A-Za-z0-9._-]{0,127}$/);
        expect(versions, `${name} ${tag}`).toContain(version);
      }
    }
  });

  // §1–§3, rpm: one .rpm per manifest, the arch its variant (src for a source package), the
  // version [epoch:]version-release with the epoch only when it is not 0, no lajstrom.rpm.*.
  it.each(built.filter(({ spec }) => spec.format === "rpm").map(({ spec, v }) => [`${spec.name} ${spec.version} ${spec.variant}`, spec, v] as const))(
    "rpm %s",
    (_label, spec, v) => {
      const m = v.manifest;
      const md = spec.metadata as Record<string, unknown>;
      const files = m.layers.filter((l) => !l.mediaType.endsWith(".metadata.v1+json"));
      expect(files).toHaveLength(1);
      expect(files[0]!.mediaType).toBe("application/vnd.lajstrom.rpm.package.v1");
      expect(m.annotations["lajstrom.variant"]).toBe(md.arch);
      expect(Object.keys(m.annotations).filter((k) => k.startsWith("lajstrom.rpm."))).toEqual([]);
      const epoch = md.epoch as number;
      expect(spec.version).toBe(`${epoch ? `${epoch}:` : ""}${md.version}-${md.release}`);
      const title = `${md.name}-${md.version}-${md.release}.${md.arch}.rpm`;
      expect(files[0]!.annotations?.["org.opencontainers.image.title"]).toBe(title);
      expect(md).toMatchObject({ name: spec.name, filename: title, size: files[0]!.size });
      // §2: every key of the metadata layer, the relations as lists of their six fields.
      const keys = ["name", "epoch", "version", "release", "arch", "summary", "description", "packager", "url", "license", "vendor", "group", "buildhost", "sourcerpm", "buildtime", "installedSize", "archiveSize", "headerStart", "headerEnd", "provides", "requires", "conflicts", "obsoletes", "recommends", "suggests", "supplements", "enhances", "files", "changelogs", "filename", "size", "sha256"];
      expect(Object.keys(md).sort()).toEqual([...keys].sort());
      for (const r of ["provides", "requires", "conflicts", "obsoletes", "recommends", "suggests", "supplements", "enhances"]) {
        expect(Array.isArray(md[r]), r).toBe(true);
        for (const x of md[r] as Record<string, unknown>[]) expect(Object.keys(x).sort()).toEqual(["epoch", "flags", "name", "pre", "release", "version"]);
      }
      expect(md.sha256).toMatch(/^[0-9a-f]{64}$/);
    },
  );

  it("holds one content per rpm file name in a repo, whatever the epoch (http-routing.md, rpm)", () => {
    const names = new Map<string, string>();
    for (const { spec, v } of built.filter(({ spec }) => spec.format === "rpm")) {
      const key = `${spec.repo}/${v.files[0]!.name}`;
      expect(names.get(key), key).toBeUndefined();
      names.set(key, spec.version);
    }
  });
});
