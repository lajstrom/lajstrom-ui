// The forms of a repo (docs/api.md, Repos): what they send, and the field a refusal of the
// server belongs to. The server checks everything; the forms send what was typed.

import { ApiError } from "@/api/client";
import type { CreateRepoRequest, PolicyPatch, Repo, RepoGroup, RepoPolicy, Upstream } from "@/api/types";

import { listItems } from "./proxy-changes";

/**
 * The field a refusal of the server belongs to: the server's message names the field first
 * ("name: …", "upstream.metadataTTL: …", "group.members[1]: …", "group.paths.hub[0]: …"), and
 * the field is the longest of `fields` that the path starts with. A 409 of a create is the
 * name's: the repo exists. null: the form's as a whole.
 */
export function fieldOf(err: unknown, fields: readonly string[], conflict?: string): string | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 409 && conflict) return conflict;
  if (err.status !== 400 && err.status !== 403) return null;
  const m = /^([A-Za-z]\w*(?:\.[\w-]+|\[\d+\])*)\s*:/.exec(err.message);
  if (!m) return null;
  const segments = m[1]!.replace(/\[\d+\]/g, "").split(".");
  for (let n = segments.length; n > 0; n--) {
    const field = segments.slice(0, n).join(".");
    if (fields.includes(field)) return field;
  }
  return null;
}

// --- Policy ---------------------------------------------------------------------------------

/** The largest file when the policy sets none (Policy in the server's openapi.yaml). */
export const defaultMaxFileSize: Record<string, number> = {
  npm: 512 * 1024 ** 2,
  pypi: 4 * 1024 ** 3,
  maven: 4 * 1024 ** 3,
  apt: 8 * 1024 ** 3,
  raw: 8 * 1024 ** 3,
  oci: 16 * 1024 ** 3,
  // A format the list does not name, rpm among them.
  rpm: 8 * 1024 ** 3,
};

/** A merge patch applied to a policy, as the server applies it: null removes a key, maven is
 * merged key by key, and a policy without keys is null. */
export function mergePolicy(current: RepoPolicy | null | undefined, patch: PolicyPatch | null): RepoPolicy | null {
  if (patch === null) return null;
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else if (k === "maven" && typeof v === "object") {
      const maven: Record<string, unknown> = { ...(current?.maven ?? {}) };
      for (const [mk, mv] of Object.entries(v)) {
        if (mv === null || mv === undefined) delete maven[mk];
        else maven[mk] = mv;
      }
      if (Object.keys(maven).length) out.maven = maven;
      else delete out.maven;
    } else out[k] = v;
  }
  return Object.keys(out).length ? (out as RepoPolicy) : null;
}

/** The merge patch that makes `current` into `next`: each key that changed, null for one that
 * went; null when nothing changes. */
export function policyPatch(current: RepoPolicy | null | undefined, next: RepoPolicy): PolicyPatch | null {
  const patch: Record<string, unknown> = {};
  for (const k of ["maxFileSize", "blobRedirect"] as const) {
    if (current?.[k] !== next[k]) patch[k] = next[k] ?? null;
  }
  const maven: Record<string, unknown> = {};
  for (const k of ["sessionTimeout", "maxSessionFiles", "versionPolicy"] as const) {
    if (current?.maven?.[k] !== next.maven?.[k]) maven[k] = next.maven?.[k] ?? null;
  }
  if (Object.keys(maven).length) patch.maven = maven;
  return Object.keys(patch).length ? (patch as PolicyPatch) : null;
}

export const SIZE_UNITS = { MiB: 1024 ** 2, GiB: 1024 ** 3 } as const;
export type SizeUnit = keyof typeof SIZE_UNITS;

/** A size of the policy as the form shows it: GiB when it is whole GiB, else MiB. */
export function sizeParts(bytes: number | undefined): { value: string; unit: SizeUnit } {
  if (bytes === undefined) return { value: "", unit: "GiB" };
  if (bytes % SIZE_UNITS.GiB === 0) return { value: String(bytes / SIZE_UNITS.GiB), unit: "GiB" };
  return { value: String(Math.round((bytes / SIZE_UNITS.MiB) * 100) / 100), unit: "MiB" };
}

/** The bytes the form means: undefined for none, the default; NaN for a value that is not a
 * number, which the server refuses. */
export function sizeBytes(value: string, unit: SizeUnit): number | undefined {
  const v = value.trim();
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * SIZE_UNITS[unit]) : NaN;
}

// --- Upstream -------------------------------------------------------------------------------

/** A proxy's upstream as the form edits it: durations as typed, lists one pattern a line. */
export type UpstreamForm = { name: string; metadataTTL: string; negativeTTL: string; offline: boolean; allow: string; deny: string };

export function upstreamForm(u?: Upstream): UpstreamForm {
  return {
    name: u?.name ?? "",
    metadataTTL: u?.metadataTTL ?? "",
    negativeTTL: u?.negativeTTL ?? "",
    offline: u?.offline ?? false,
    allow: (u?.allow ?? []).join("\n"),
    deny: (u?.deny ?? []).join("\n"),
  };
}

/** The upstream of a create: what was typed, the defaults for what was not. */
export function upstreamBody(f: UpstreamForm): Upstream {
  const allow = listItems(f.allow);
  const deny = listItems(f.deny);
  return {
    name: f.name.trim(),
    ...(f.metadataTTL.trim() ? { metadataTTL: f.metadataTTL.trim() } : {}),
    ...(f.negativeTTL.trim() ? { negativeTTL: f.negativeTTL.trim() } : {}),
    ...(f.offline ? { offline: true } : {}),
    ...(allow.length ? { allow } : {}),
    ...(deny.length ? { deny } : {}),
  };
}

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** The merge patch of a proxy's upstream: the keys that changed, a TTL left empty back to its
 * default (null); null when nothing changes. */
export function upstreamPatch(current: Upstream, f: UpstreamForm): Record<string, unknown> | null {
  const next = upstreamBody(f);
  const patch: Record<string, unknown> = {};
  if (next.name !== current.name) patch.name = next.name;
  for (const k of ["metadataTTL", "negativeTTL"] as const) if (next[k] !== current[k]) patch[k] = next[k] ?? null;
  if (f.offline !== (current.offline ?? false)) patch.offline = f.offline;
  for (const k of ["allow", "deny"] as const) if (!sameList(next[k], current[k])) patch[k] = next[k] ?? [];
  return Object.keys(patch).length ? patch : null;
}

// --- Group ----------------------------------------------------------------------------------

/** A group as the form edits it: members in order; the merged names, one a line; an oci
 * group's path patterns of each member, as typed. */
export type GroupForm = { members: string[]; merge: string; paths: Record<string, string> };

export function groupForm(g?: RepoGroup): GroupForm {
  return {
    members: [...(g?.members ?? [])],
    merge: (g?.merge ?? []).join("\n"),
    paths: Object.fromEntries(Object.entries(g?.paths ?? {}).map(([m, list]) => [m, list.join(" ")])),
  };
}

/** The group of a create: members with the merged names, or with each member's paths on oci. */
export function groupBody(format: string, f: GroupForm): RepoGroup {
  if (format === "oci") return { members: f.members, paths: Object.fromEntries(f.members.map((m) => [m, listItems(f.paths[m] ?? "")])) };
  const merge = listItems(f.merge);
  return { members: f.members, ...(merge.length ? { merge } : {}) };
}

/** The merge patch of a group: members when they or their order changed; merge when it
 * changed; on oci the routes of every member when one changed, and null for a member that went,
 * since the server checks the result whole. null when nothing changes. */
export function groupPatch(format: string, current: RepoGroup, f: GroupForm): Record<string, unknown> | null {
  const next = groupBody(format, f);
  const patch: Record<string, unknown> = {};
  if (!sameList(next.members, current.members)) patch.members = next.members;
  if (format === "oci") {
    const paths: Record<string, string[] | null> = { ...next.paths };
    for (const m of Object.keys(current.paths ?? {})) if (!(m in paths)) paths[m] = null;
    const changed = Object.entries(paths).some(([m, list]) => list === null || !sameList(list, current.paths?.[m]));
    if (changed) patch.paths = paths;
  } else if (!sameList(next.merge, current.merge)) patch.merge = next.merge ?? [];
  return Object.keys(patch).length ? patch : null;
}

/** The repos a group of the format may take as members: hosted and proxy repos the caller can
 * read, not the group itself, not one it has already. */
export function memberCandidates(repos: Repo[], format: string, self: string, members: string[]): Repo[] {
  return repos.filter((r) => r.format === format && r.kind !== "group" && r.name !== self && !members.includes(r.name));
}

// --- Create ---------------------------------------------------------------------------------

export type RepoKind = Repo["kind"];

export type CreateForm = {
  format: string;
  name: string;
  kind: RepoKind;
  registry: string;
  anonymousRead: boolean;
  upstream: UpstreamForm;
  group: GroupForm;
};

/** The body of a create: a group has neither registry nor policy; a proxy its upstream. */
export function createBody(f: CreateForm): CreateRepoRequest {
  return {
    format: f.format,
    name: f.name.trim(),
    ...(f.kind === "hosted" ? {} : { kind: f.kind }),
    ...(f.kind === "group" ? { group: groupBody(f.format, f.group) } : { registry: f.registry.trim() }),
    ...(f.kind === "proxy" ? { upstream: upstreamBody(f.upstream) } : {}),
    ...(f.anonymousRead ? { anonymousRead: true } : {}),
  };
}

/** The fields of the forms that a refusal may name; an oci group's paths are each member's. */
export function repoFields(members: string[] = []): string[] {
  return [
    "format",
    "name",
    "kind",
    "registry",
    "anonymousRead",
    "upstream",
    "upstream.name",
    "upstream.metadataTTL",
    "upstream.negativeTTL",
    "upstream.offline",
    "upstream.allow",
    "upstream.deny",
    "group",
    "group.members",
    "group.merge",
    "group.paths",
    ...members.map((m) => `group.paths.${m}`),
  ];
}
