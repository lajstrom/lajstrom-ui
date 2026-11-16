// The demo's upstream npmjs (docs/spec/proxy-and-group.md §2.1, upstreams[] of the
// configuration): the packument of a name as a proxy reads it, its versions with their publish
// times and tarballs, and its dist-tags. A few names have some of npmjs.org's versions; every
// other name npm takes has a packument made up of the name, as every image path has an index on
// the mock's oci upstreams. Acme's private scope it does not have.

import { sha256Hex } from "@/lib/sha256";

import type { VersionSpec } from "./builders";
import { npmVersion, type NpmRelease, type PackageJson } from "./npm";

/** What a proxy reads of a packument: the package.json of its versions, the versions in the
 * order the document lists them, and the dist-tags. */
export type Packument = { name: string; doc: PackageJson; versions: NpmRelease[]; distTags: Record<string, string> };

type Known = Omit<Packument, "name" | "versions"> & {
  /** version, publish time, tarball size; what a version's package.json says differently. */
  versions: [string, string, number, Partial<PackageJson>?][];
};

const known: Record<string, Known> = {
  "left-pad": {
    doc: { description: "String left pad", license: "WTFPL", author: "azer", repository: "https://github.com/stevemao/left-pad", main: "index.js" },
    versions: [
      ["1.1.3", "2016-03-24T02:21:12Z", 2_431],
      ["1.2.0", "2017-11-24T09:18:21Z", 2_812],
      ["1.3.0", "2018-04-09T01:06:24Z", 3_120],
    ],
    distTags: { latest: "1.3.0" },
  },
  lodash: {
    doc: {
      description: "Lodash modular utilities.",
      license: "MIT",
      author: { name: "John-David Dalton" },
      homepage: "https://lodash.com/",
      repository: "https://github.com/lodash/lodash",
      keywords: ["modules", "stdlib", "util"],
      main: "lodash.js",
    },
    versions: [
      ["4.17.19", "2020-07-08T17:14:40Z", 317_620],
      ["4.17.20", "2020-08-13T16:53:54Z", 317_706],
      ["4.17.21", "2021-02-20T15:42:16Z", 318_224],
    ],
    distTags: { latest: "4.17.21" },
  },
  react: {
    doc: {
      description: "React is a JavaScript library for building user interfaces.",
      license: "MIT",
      homepage: "https://react.dev/",
      repository: "https://github.com/facebook/react",
      keywords: ["react"],
      main: "index.js",
      engines: { node: ">=0.10.0" },
    },
    versions: [
      ["18.3.1", "2024-04-26T16:42:51Z", 81_874],
      ["19.0.0", "2024-12-05T18:10:24Z", 76_380],
      ["19.1.0", "2025-03-28T19:59:42Z", 76_517],
      ["19.2.0", "2025-10-01T21:38:32Z", 76_891],
    ],
    distTags: { latest: "19.2.0" },
  },
  clsx: {
    doc: {
      description: "A tiny (239B) utility for constructing className strings conditionally.",
      license: "MIT",
      author: { name: "Luke Edwards" },
      repository: "https://github.com/lukeed/clsx",
      main: "dist/clsx.js",
      types: "clsx.d.ts",
      engines: { node: ">=6" },
    },
    versions: [
      ["2.0.0", "2023-07-27T20:10:41Z", 3_310],
      ["2.1.0", "2023-12-29T00:53:16Z", 3_515],
      ["2.1.1", "2024-04-23T05:26:04Z", 3_547],
    ],
    distTags: { latest: "2.1.1" },
  },
  // Two lines of releases, each with its dist-tag: a prefetch takes both.
  express: {
    doc: {
      description: "Fast, unopinionated, minimalist web framework",
      license: "MIT",
      author: { name: "TJ Holowaychuk" },
      homepage: "https://expressjs.com/",
      repository: "https://github.com/expressjs/express",
      keywords: ["express", "framework", "web", "http", "rest", "api", "router", "app"],
      engines: { node: ">= 18" },
    },
    versions: [
      ["5.0.0", "2024-09-10T03:41:57Z", 23_910],
      ["4.21.2", "2024-12-05T23:03:19Z", 55_812, { engines: { node: ">= 0.10.0" } }],
      ["5.1.0", "2025-03-31T14:56:31Z", 24_103],
    ],
    distTags: { latest: "5.1.0", "latest-4": "4.21.2" },
  },
  typescript: {
    doc: {
      description: "TypeScript is a language for application scale JavaScript development",
      license: "Apache-2.0",
      author: { name: "Microsoft Corp." },
      homepage: "https://www.typescriptlang.org/",
      repository: "https://github.com/microsoft/TypeScript",
      main: "./lib/typescript.js",
      bin: { tsc: "bin/tsc", tsserver: "bin/tsserver" },
      engines: { node: ">=14.17" },
    },
    versions: [
      ["5.8.3", "2025-04-04T00:54:51Z", 4_465_880],
      ["5.9.0-beta", "2025-07-08T18:07:39Z", 4_502_113],
      ["5.9.1-rc", "2025-07-25T17:26:02Z", 4_515_904],
      ["5.9.2", "2025-07-31T18:28:59Z", 4_516_372],
      ["5.9.3", "2025-09-30T20:44:55Z", 4_517_046],
    ],
    distTags: { latest: "5.9.3", beta: "5.9.0-beta", rc: "5.9.1-rc" },
  },
};

const DAY = 86_400_000;
const rfc3339 = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A packument made up of the name: 2 to 5 versions, a week to four months apart, latest the
 * newest. */
function madeUp(name: string): Packument {
  const h = sha256Hex(`npmjs:${name}`);
  const byte = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
  let [major, minor, patch] = [1 + (byte(1) % 3), byte(2) % 5, 0];
  let at = Date.UTC(2021, 0, 1) + byte(3) * 4 * DAY + byte(4) * 337_000;
  const versions: NpmRelease[] = [];
  for (let i = 0; i < 2 + (byte(0) % 4); i++) {
    if (i > 0) {
      const step = byte(5 + i) % 8;
      if (step === 0) [major, minor, patch] = [major + 1, 0, 0];
      else if (step < 4) [minor, patch] = [minor + 1, 0];
      else patch++;
      at += (7 + (byte(10 + i) % 115)) * DAY + byte(15 + i) * 241_000;
    }
    versions.push({ version: `${major}.${minor}.${patch}`, at: rfc3339(at), size: 1_800 + byte(20 + i) * 613 });
  }
  return {
    name,
    doc: { description: "Made up by the demo's npmjs, which has a packument for every name", license: "MIT" },
    versions,
    distTags: { latest: versions.at(-1)!.version },
  };
}

/** The packument of a name npm takes, or null when the upstream has none: Acme's private scope
 * is not on npmjs.org. */
export function packumentOf(name: string): Packument | null {
  if (name.toLowerCase().startsWith("@acme/")) return null;
  const k = known[name];
  if (!k) return madeUp(name);
  return { name, doc: k.doc, distTags: k.distTags, versions: k.versions.map(([version, at, size, changes]) => ({ version, at, size, ...(changes ? { changes } : {}) })) };
}

/** A version of a packument as a proxy repo fetched it from the upstream at url. */
export function fetchedVersion(repo: string, url: string, p: Packument, v: NpmRelease): VersionSpec {
  return npmVersion(repo, p.name, p.doc, v, { origin: url });
}
