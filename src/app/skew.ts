// The server against the API this bundle was built for (its contract, src/app/build.ts): the
// start-up asks GET /-/version and warns, and goes on, when the server is older or newer.
//
// Versions are release tags (v0.1.0, v0.1.0-rc.1) or git describe of a build between them
// (v0.0.1-959-gf0d887d, -dirty), as the server's /-/version and the vendored openapi.yaml name
// them. Before 1.0 a minor version may change the API (the server's CHANGELOG), from 1.0 a major
// one: that is a line. A server is
//
//   same        the contract's commit, or the same release;
//   compatible  newer, on the contract's line. A contract between releases (v0.0.1-959-g…) goes
//               into the next release, which may start the next line, so that line is fine too;
//   older       before the contract: it may lack what the UI calls;
//   newer       on a later line: what the UI calls may have changed;
//   unknown     a version that says nothing (dev, a bare commit), or a contract without one.

import type { Contract } from "./build";

/** GET /-/version of the server. */
export type ServerVersion = { version: string; commit: string; date: string };

export type Skew = "same" | "compatible" | "older" | "newer" | "unknown";

type Position = { n: [number, number, number]; pre: string; ahead: number; commit: string };

/** A release tag or a git describe of one, or null. */
export function parseVersion(version: string): Position | null {
  let rest = version.replace(/-dirty$/, "");
  let ahead = 0;
  let commit = "";
  const described = /^(.*)-(\d+)-g([0-9a-f]{4,40})$/.exec(rest);
  if (described) {
    rest = described[1]!;
    ahead = Number(described[2]);
    commit = described[3]!;
  }
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(rest);
  if (!m) return null;
  return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "", ahead, commit };
}

/** Semantic versioning's order of pre-releases: numbers below names, field by field. */
function comparePre(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const x = a.split(".");
  const y = b.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function compare(a: Position, b: Position): number {
  for (let i = 0; i < 3; i++) if (a.n[i] !== b.n[i]) return a.n[i]! - b.n[i]!;
  return comparePre(a.pre, b.pre) || a.ahead - b.ahead;
}

/** The line of a version as one number, the next line one more: the minor before 1.0, the
 * major from 1.0 on (above every minor of 0.x). */
function line(p: Position): number {
  return p.n[0] > 0 ? 1000 + p.n[0] : p.n[1];
}

/** Where the server stands against the contract. */
export function skewOf(contract: Contract, server: ServerVersion): Skew {
  const s = parseVersion(server.version);
  const commit = server.commit || s?.commit || (/^[0-9a-f]{7,40}$/.test(server.version) ? server.version : "");
  if (commit && contract.serverCommit.startsWith(commit)) return "same";
  const c = parseVersion(contract.serverVersion);
  if (!s || !c) return "unknown";
  const order = compare(s, c);
  if (order < 0) return "older";
  if (order === 0) return "same";
  const last = line(c) + (c.ahead > 0 ? 1 : 0);
  return line(s) <= last ? "compatible" : "newer";
}
