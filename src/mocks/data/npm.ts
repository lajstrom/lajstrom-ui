import { npmScope } from "@/lib/profile";
import { sha256Hex } from "@/lib/sha256";

import type { ReferrerSpec, VersionSpec } from "./builders";
import { ago } from "./time";

/** The fields of package.json a version document keeps (manifest-profile.md §2, npm). */
export type PackageJson = {
  description: string;
  license: string;
  author?: string | { name: string; email?: string };
  homepage?: string;
  repository?: string;
  keywords?: string[];
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

export type NpmRelease = {
  version: string;
  /** Size of the tarball in bytes. */
  size: number;
  at: string;
  referrers?: ReferrerSpec[];
  /** What this version's package.json says differently from the package's. */
  changes?: Partial<PackageJson>;
};

/** A digest of the given length in bytes, as hex: the mock has no tarball to hash. */
function fakeHex(seed: string, bytes: number): string {
  let hex = "";
  for (let i = 0; hex.length < bytes * 2; i++) hex += sha256Hex(`${seed}#${i}`);
  return hex.slice(0, bytes * 2);
}

const base64 = (hex: string) =>
  btoa(
    hex
      .match(/../g)!
      .map((h) => String.fromCharCode(parseInt(h, 16)))
      .join(""),
  );

/** The manifest of one version, its tarball the one file layer; npm has no variant. Published by
 * a principal, or fetched by a proxy from the upstream at origin, its URL: then the digests are
 * the upstream's, the same in every repo that fetches them, and the manifest has the origin of
 * manifest-profile.md §3.1 instead of an uploader. */
export function npmVersion(repo: string, name: string, pkg: PackageJson, rel: NpmRelease, from: { by: string } | { origin: string }): VersionSpec {
  const [, base] = npmScope(name);
  // The file name npm serves the tarball under: the name without its scope (§2, npm).
  const filename = `${base}-${rel.version}.tgz`;
  const seed = "origin" in from ? `${from.origin}${name}@${rel.version}` : `npm:${repo}/${name}@${rel.version}`;
  const sha512 = fakeHex(seed, 64);
  const integrity = `sha512-${base64(sha512)}`;
  const shasum = sha256Hex(`${seed}:sha1`).slice(0, 40);
  const doc = { ...pkg, ...rel.changes };
  const { repository, ...fields } = doc;
  const scripts = doc.scripts ?? {};
  return {
    format: "npm",
    repo,
    name,
    version: rel.version,
    files: [
      {
        name: filename,
        mediaType: "application/vnd.lajstrom.npm.tarball.v1.tar+gzip",
        size: rel.size,
        attrs: { "lajstrom.npm.integrity": integrity, "lajstrom.npm.shasum": shasum },
      },
    ],
    metadata: {
      name,
      version: rel.version,
      // The version document without dist, readme and the keys that begin with _.
      manifest: {
        name,
        version: rel.version,
        ...fields,
        ...(repository ? { repository: { type: "git", url: `git+${repository}.git` } } : {}),
      },
      readme: `# ${name}\n\n${doc.description}\n`,
      filename,
      size: rel.size,
      integrity,
      shasum,
      sha256: sha256Hex(`${seed}:sha256`),
      hasShrinkwrap: false,
      hasInstallScript: ["preinstall", "install", "postinstall"].some((s) => s in scripts),
    },
    createdAt: rel.at,
    referrers: rel.referrers,
    // The URL a client of npmjs.org asks for: the scope's / as it is.
    ...("origin" in from ? { origin: { url: `${from.origin}${name}/-/${filename}`, checksum: `sha512:${sha512}` } } : { uploadedBy: from.by }),
  };
}

/** One manifest per version, each published by its principal. */
function npmPackage(repo: string, name: string, pkg: PackageJson, releases: (NpmRelease & { by: string })[]): VersionSpec[] {
  return releases.map(({ by, ...rel }) => npmVersion(repo, name, pkg, rel, { by }));
}

const REPO = "internal";
const CI = "token:41";
const ACME = { name: "Web Platform", email: "web-platform@acme.example" };
const git = (slug: string) => `https://git.acme.example/${slug}`;

export function npmVersions(): VersionSpec[] {
  return [
    ...npmPackage(
      REPO,
      "@acme/widgets",
      {
        description: "Dashboard widgets for Acme's web apps",
        license: "UNLICENSED",
        author: ACME,
        homepage: git("web/widgets"),
        repository: git("web/widgets"),
        keywords: ["react", "dashboard", "charts"],
        main: "dist/index.js",
        types: "dist/index.d.ts",
        dependencies: { "@acme/ui-kit": "^3.4.0", "d3-scale": "^4.0.2" },
        peerDependencies: { react: "^18.2.0 || ^19.0.0" },
        engines: { node: ">=20" },
      },
      [
        { version: "1.0.0", size: 48_211, at: ago(60, 3), by: CI },
        { version: "1.1.0", size: 51_904, at: ago(41, 6), by: CI },
        { version: "1.2.0", size: 53_377, at: ago(12, 2), by: CI, referrers: ["cosign", "spdx"] },
        {
          version: "2.0.0-beta.0",
          size: 61_020,
          at: ago(6, 4),
          by: CI,
          changes: { dependencies: { "@acme/ui-kit": "^3.5.0", "d3-scale": "^4.0.2" }, peerDependencies: { react: "^19.0.0" } },
        },
        {
          version: "2.0.0-beta.1",
          size: 61_388,
          at: ago(1, 5),
          by: CI,
          referrers: ["cosign"],
          changes: { dependencies: { "@acme/ui-kit": "^3.5.0", "d3-scale": "^4.0.2" }, peerDependencies: { react: "^19.0.0" } },
        },
      ],
    ),
    ...npmPackage(
      REPO,
      "@acme/ui-kit",
      {
        description: "React components of the Acme design system",
        license: "UNLICENSED",
        author: ACME,
        homepage: git("web/ui-kit"),
        repository: git("web/ui-kit"),
        keywords: ["react", "design-system", "components"],
        main: "dist/index.js",
        types: "dist/index.d.ts",
        dependencies: { clsx: "^2.1.1" },
        peerDependencies: { react: "^18.2.0 || ^19.0.0", "react-dom": "^18.2.0 || ^19.0.0" },
      },
      [
        { version: "3.4.0", size: 212_906, at: ago(70, 1), by: CI },
        { version: "3.4.1", size: 213_118, at: ago(48, 2), by: CI },
        { version: "3.5.0", size: 220_745, at: ago(9, 7), by: CI, referrers: ["cosign"] },
      ],
    ),
    ...npmPackage(
      REPO,
      "@acme/eslint-config",
      {
        description: "The ESLint configuration of Acme's TypeScript projects",
        license: "UNLICENSED",
        author: ACME,
        repository: git("web/eslint-config"),
        main: "index.js",
        peerDependencies: { eslint: "^9.0.0", typescript: ">=5.4" },
        dependencies: { "typescript-eslint": "^8.18.0", "eslint-plugin-react-hooks": "^5.1.0" },
      },
      [
        { version: "5.0.0", size: 6_502, at: ago(88), by: "user:admin" },
        { version: "5.1.0", size: 6_841, at: ago(15, 3), by: CI },
      ],
    ),
    ...npmPackage(
      REPO,
      "acme-cli",
      {
        description: "Command-line client for the Acme platform",
        license: "UNLICENSED",
        author: { name: "Platform Team", email: "platform@acme.example" },
        homepage: git("platform/acme-cli-js"),
        repository: git("platform/acme-cli-js"),
        bin: { acme: "bin/acme.js" },
        engines: { node: ">=20" },
        dependencies: { commander: "^12.1.0", undici: "^6.21.0" },
        optionalDependencies: { keytar: "^7.9.0" },
        // Fetches the platform binary on install, so its packument says hasInstallScript.
        scripts: { postinstall: "node scripts/fetch-binary.js" },
      },
      [
        { version: "0.9.0", size: 18_330, at: ago(52, 2), by: CI },
        { version: "1.0.0", size: 19_802, at: ago(20, 4), by: CI, referrers: ["cosign", "slsa"] },
        { version: "1.1.0-rc.1", size: 20_417, at: ago(2, 3), by: CI, referrers: ["cosign"] },
      ],
    ),
    ...npmPackage(
      REPO,
      "left-pad",
      {
        description: "String left pad (Acme's pinned fork)",
        license: "WTFPL",
        author: "azer",
        repository: "https://github.com/left-pad/left-pad",
        main: "index.js",
      },
      [{ version: "1.3.0", size: 2_317, at: ago(150), by: "user:admin" }],
    ),
    // Pushed with oras push: a version through /v2 appends no dist-tag (http-routing.md, npm),
    // so the package has no pointers. Its old npmjs.org name keeps its capitals.
    ...npmPackage(
      REPO,
      "JSONStream",
      {
        description: "rawStream.pipe(JSONStream.parse()).pipe(streamOfObjects)",
        license: "(MIT OR Apache-2.0)",
        author: { name: "Dominic Tarr", email: "dominic.tarr@gmail.com" },
        homepage: "http://github.com/dominictarr/JSONStream",
        repository: "https://github.com/dominictarr/JSONStream",
        keywords: ["json", "stream", "streaming", "parser", "async", "parsing"],
        bin: { JSONStream: "bin.js" },
        dependencies: { jsonparse: "^1.2.0", through: ">=2.2.7 <3" },
      },
      [{ version: "1.3.5", size: 8_214, at: ago(35, 1), by: "user:admin" }],
    ),
  ];
}

/** The state of each package's journal: its dist-tags (manifest-profile.md §8). `npm publish`
 * adds latest, `--tag beta` another; a package pushed with oras has none. */
export function npmDistTags(): { repo: string; name: string; tags: Record<string, string> }[] {
  return [
    { repo: REPO, name: "@acme/widgets", tags: { latest: "1.2.0", beta: "2.0.0-beta.1", stable: "1.1.0" } },
    { repo: REPO, name: "@acme/ui-kit", tags: { latest: "3.5.0" } },
    { repo: REPO, name: "@acme/eslint-config", tags: { latest: "5.1.0" } },
    { repo: REPO, name: "acme-cli", tags: { latest: "1.0.0", next: "1.1.0-rc.1" } },
    { repo: REPO, name: "left-pad", tags: { latest: "1.3.0" } },
  ];
}
