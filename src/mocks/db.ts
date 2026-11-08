// The in-memory "server" behind the mock API: the seed turned into the rows and answers
// Lajstrom would compute. Handlers in handlers.ts translate HTTP to these functions.

import type {
  AuditEvent,
  FacetValue,
  PackageDetail,
  PackageSummary,
  PublishSession,
  VersionDetail,
  RawDirectory,
  ReindexReport,
  Repo,
  SearchHit,
  VersionSummary,
  WhoAmI,
} from "@/api/types";
import { formatSpec } from "@/lib/formats";
import { packagePath } from "@/lib/profile";
import { sha256Hex } from "@/lib/sha256";

import { aptVersions } from "./data/apt";
import { buildVersion, type BuiltVersion } from "./data/builders";
import { mavenVersions } from "./data/maven";
import { pypiVersions } from "./data/pypi";
import { rawVersions } from "./data/raw";
import { bindings, registries, repoSeeds, roleActions, serverInfo, tokens, users, type RepoSeed } from "./data/system";
import { ago, ahead, before, HOST } from "./data/time";
import { getPersona, type Persona } from "./persona";
import { keep, persist } from "./state";

type Action = "read" | "write" | "delete" | "manage";

/** The mock answers the proposed fields of api-proposal.md §3.2 too, so its repos have them all. */
export type MockRepo = Repo & Required<Pick<Repo, "stats" | "permissions" | "reindex">>;

type Row = BuiltVersion & { repoKey: string; format: string };

const allVersions: Row[] = [...rawVersions(), ...pypiVersions(), ...aptVersions(), ...mavenVersions()].map((spec) => ({
  ...buildVersion(spec, HOST),
  repoKey: `${spec.format}/${spec.repo}`,
  format: spec.format,
}));

/** repoKey → package name → manifests, newest first. */
const byRepo = new Map<string, Map<string, Row[]>>();
for (const v of allVersions) {
  const pkgs = byRepo.get(v.repoKey) ?? new Map<string, Row[]>();
  const list = pkgs.get(v.packageName) ?? [];
  list.push(v);
  pkgs.set(v.packageName, list);
  byRepo.set(v.repoKey, pkgs);
}
for (const pkgs of byRepo.values()) {
  for (const list of pkgs.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const keyOf = (r: { format: string; name: string }) => `${r.format}/${r.name}`;

// --- RBAC (docs/spec/rbac.md §3) ---------------------------------------------------------

function maskMatches(mask: string, repoKey: string): boolean {
  const [mf, mr] = mask.split("/");
  const [f, r] = repoKey.split("/");
  return (mf === "*" || mf === f) && (mr === "*" || mr === r);
}

function permissions(persona: Persona, seed: RepoSeed): Action[] {
  const repoKey = keyOf(seed);
  if (persona !== "anonymous") {
    const principal = `user:${persona}`;
    const granted = new Set<Action>();
    for (const b of bindings) {
      if (b.principal !== principal) continue;
      if (b.role === "admin" || maskMatches(b.repoMask, repoKey)) roleActions[b.role].forEach((a) => granted.add(a));
    }
    if (granted.size) return (["read", "write", "delete", "manage"] as Action[]).filter((a) => granted.has(a));
  }
  return seed.anonymousRead && serverInfo.anonymousRead ? ["read"] : [];
}

export function isAdmin(persona = getPersona()): boolean {
  return bindings.some((b) => b.principal === `user:${persona}` && b.role === "admin");
}

export function whoami(persona = getPersona()): WhoAmI {
  if (persona === "anonymous") return { principal: "anonymous", kind: "anonymous", name: "", admin: false, bindings: [] };
  return {
    principal: `user:${persona}`,
    kind: "user",
    name: persona,
    admin: isAdmin(persona),
    bindings: bindings.filter((b) => b.principal === `user:${persona}`),
  };
}

// --- Repos ----------------------------------------------------------------------------------

function repoOf(seed: RepoSeed, persona: Persona): MockRepo {
  const pkgs = byRepo.get(keyOf(seed)) ?? new Map();
  const manifests = [...pkgs.values()].flat();
  const versions = new Set(manifests.map((v) => `${v.packageName}\0${v.version}`));
  const lastPush = manifests.reduce<string | null>((m, v) => (!m || v.createdAt > m ? v.createdAt : m), null);
  const running = seed.reindex === "running";
  return {
    format: seed.format,
    name: seed.name,
    kind: "hosted",
    registry: seed.registry,
    prefix: keyOf(seed),
    anonymousRead: seed.anonymousRead,
    policy: seed.policy,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt ?? (seed.format === "maven" && seed.name === "payments" ? ago(12, 3) : seed.createdAt),
    stats: {
      packages: pkgs.size,
      versions: versions.size,
      manifests: manifests.length,
      files: manifests.reduce((n, v) => n + v.fileCount, 0),
      size: manifests.reduce((n, v) => n + v.size, 0),
      lastPushAt: lastPush,
    },
    permissions: permissions(persona, seed),
    reindex: {
      state: seed.reindex,
      startedAt: running ? before(0, 0, 0.3) : before(0, 0, 21),
      finishedAt: running ? null : before(0, 0, 20),
      errors: 0,
      nextReconcileAt: running ? null : ahead(0, 0, 39),
    },
    ...(seed.signingKeys ? { signingKeys: seed.signingKeys } : {}),
  };
}

export function listRepos(persona = getPersona()): MockRepo[] {
  return repoSeeds.map((s) => repoOf(s, persona)).filter((r) => r.permissions.includes("read"));
}

/** A repo the caller may read, or null: missing and forbidden look the same (rbac.md §3). */
export function getRepo(format: string, name: string, persona = getPersona()): MockRepo | null {
  const seed = repoSeeds.find((s) => s.format === format && s.name === name);
  if (!seed) return null;
  const repo = repoOf(seed, persona);
  return repo.permissions.includes("read") ? repo : null;
}

// --- Packages -------------------------------------------------------------------------------

function summaryLine(v: BuiltVersion): string | null {
  const m = v.metadata as Record<string, unknown> | null;
  if (!m) return null;
  if (typeof m.summary === "string") return m.summary;
  const control = m.control as Record<string, string> | undefined;
  if (control?.Description) return control.Description;
  const pom = m.pom as Record<string, string> | undefined;
  if (pom?.description) return pom.description;
  if (pom?.name) return pom.name;
  if (typeof m.contentType === "string") return m.contentType;
  return null;
}

function summarize(name: string, list: Row[]): PackageSummary {
  const latest = list[0]!;
  const latestVariants = list.filter((v) => v.version === latest.version).map((v) => v.variant).filter(Boolean);
  const attrs = { ...latest.attrs };
  const pyMeta = latest.metadata as Record<string, unknown> | null;
  if (latest.artifactType.includes("pypi") && typeof pyMeta?.requires_python === "string") {
    attrs.requiresPython = pyMeta.requires_python;
  }
  return {
    name,
    nameOci: packagePath(latest.format, name),
    latestVersion: latest.version,
    versions: new Set(list.map((v) => v.version)).size,
    manifests: list.length,
    latestVariants: [...new Set(latestVariants)].sort(),
    size: list.reduce((n, v) => n + v.size, 0),
    summary: summaryLine(latest),
    attrs,
    createdAt: list[list.length - 1]!.createdAt,
    updatedAt: latest.createdAt,
  };
}

export type PackageQuery = {
  q?: string;
  attr?: string[];
  sort?: string;
  order?: string;
  limit?: number;
  cursor?: string;
  dir?: string | null;
};

const encodeCursor = (offset: number) => btoa(`o:${offset}`);
const decodeCursor = (cursor?: string | null) => {
  if (!cursor) return 0;
  try {
    return Math.max(0, Number(atob(cursor).slice(2)) || 0);
  } catch {
    return 0;
  }
};

export function paginate<T>(items: T[], limit: number, cursor?: string | null) {
  const offset = decodeCursor(cursor);
  const page = items.slice(offset, offset + limit);
  return {
    page,
    total: items.length,
    limit,
    next: offset + limit < items.length ? encodeCursor(offset + limit) : null,
    prev: offset > 0 ? encodeCursor(Math.max(0, offset - limit)) : null,
  };
}

export function listPackages(repo: Repo, query: PackageQuery) {
  const pkgs = byRepo.get(repo.prefix) ?? new Map<string, Row[]>();
  let rows = [...pkgs.entries()].map(([name, list]) => ({ summary: summarize(name, list), list }));

  // Facets count packages over the whole repo, before filters, so the filter bar never empties.
  const facets: Record<string, FacetValue[]> = {};
  for (const { key } of formatSpec(repo.format).facets) {
    const counts = new Map<string, number>();
    for (const { list } of rows) {
      for (const value of new Set(list.map((v) => v.attrs[key]).filter(Boolean) as string[])) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    facets[key] = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
  }

  const q = query.q?.trim().toLowerCase();
  if (q) rows = rows.filter(({ summary }) => summary.name.toLowerCase().includes(q) || summary.summary?.toLowerCase().includes(q));
  for (const f of query.attr ?? []) {
    const i = f.indexOf(":");
    const k = f.slice(0, i);
    const val = f.slice(i + 1);
    rows = rows.filter(({ list }) => list.some((v) => v.attrs[k] === val));
  }

  let directories: RawDirectory[] | undefined;
  if (repo.format === "raw" && query.dir !== undefined && query.dir !== null && !q) {
    const prefix = query.dir ? query.dir.replace(/\/?$/, "/") : "";
    const inDir = rows.filter(({ summary }) => summary.name.startsWith(prefix));
    const dirs = new Map<string, RawDirectory>();
    rows = [];
    for (const row of inDir) {
      const rest = row.summary.name.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        rows.push(row);
        continue;
      }
      const name = rest.slice(0, slash);
      const d = dirs.get(name) ?? { name, path: prefix + name + "/", files: 0, size: 0, updatedAt: "" };
      d.files += 1;
      d.size += row.summary.size;
      if (row.summary.updatedAt > d.updatedAt) d.updatedAt = row.summary.updatedAt;
      dirs.set(name, d);
    }
    directories = [...dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  const dirSign = query.order === "asc" ? 1 : query.order === "desc" ? -1 : null;
  const sort = query.sort ?? "name";
  const cmp: Record<string, (a: PackageSummary, b: PackageSummary) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    versions: (a, b) => a.versions - b.versions,
    size: (a, b) => a.size - b.size,
  };
  const defaultSign = sort === "name" ? 1 : -1;
  const by = cmp[sort] ?? cmp.name!;
  rows.sort((a, b) => by(a.summary, b.summary) * (dirSign ?? defaultSign));

  const { page, ...pageInfo } = paginate(rows, query.limit ?? 50, query.cursor);
  return { packages: page.map((r) => r.summary), ...pageInfo, facets, ...(directories ? { directories } : {}) };
}

function manifestsOf(repo: Repo, name: string): Row[] | null {
  return byRepo.get(repo.prefix)?.get(name) ?? null;
}

export function getPackage(repo: Repo, name: string): PackageDetail | null {
  const list = manifestsOf(repo, name);
  if (!list) return null;
  const summary = summarize(name, list);
  return {
    ...summary,
    ociRepository: `${repo.format}/${repo.name}/${summary.nameOci}`,
    latestMetadata: list[0]!.metadata,
  };
}

function toSummary(v: Row): VersionSummary {
  return {
    degraded: v.degraded,
    version: v.version,
    variant: v.variant,
    tag: v.tag,
    digest: v.digest,
    artifactType: v.artifactType,
    attrs: v.attrs,
    createdAt: v.createdAt,
    indexedAt: v.indexedAt,
    size: v.size,
    fileCount: v.fileCount,
    uploadedBy: v.uploadedBy,
    referrers: v.referrers,
  };
}

export function listVersions(repo: Repo, name: string): VersionSummary[] | null {
  return manifestsOf(repo, name)?.map(toSummary) ?? null;
}

export function getVersion(repo: Repo, name: string, digest: string): VersionDetail | null {
  const v = manifestsOf(repo, name)?.find((m) => m.digest === digest);
  if (!v) return null;
  const { packageName: _p, repoKey: _r, format: _f, ...detail } = v;
  return detail;
}

// --- Search ---------------------------------------------------------------------------------

export function search(q: string, format: string | null, limit = 20, persona = getPersona()) {
  const visible = new Set(listRepos(persona).map((r) => r.prefix));
  const needle = q.trim().toLowerCase();
  if (!needle) return { hits: [] as SearchHit[], total: 0 };
  const hex = needle.replace(/^sha256:/, "");
  const hits: (SearchHit & { score: number })[] = [];

  if (/^[0-9a-f]{8,64}$/.test(hex)) {
    for (const v of allVersions) {
      if (!visible.has(v.repoKey) || (format && !v.repoKey.startsWith(format + "/"))) continue;
      const [fmt, repo] = v.repoKey.split("/") as [SearchHit["format"], string];
      const base = { kind: "version" as const, format: fmt, repo, name: v.packageName, version: v.version, variant: v.variant, digest: v.digest };
      if (v.digest.slice(7).startsWith(hex)) hits.push({ ...base, matched: "manifest", score: 0 });
      for (const f of v.files) if (f.digest.slice(7).startsWith(hex)) hits.push({ ...base, matched: f.name, score: 1 });
    }
  }

  for (const [repoKey, pkgs] of byRepo) {
    if (!visible.has(repoKey) || (format && !repoKey.startsWith(format + "/"))) continue;
    const [fmt, repo] = repoKey.split("/") as [SearchHit["format"], string];
    for (const [name, list] of pkgs) {
      const s = summarize(name, list);
      const n = name.toLowerCase();
      const normalized = n.replace(/[-_.]+/g, "-");
      let score = -1;
      if (n === needle || normalized === needle) score = 0;
      else if (n.startsWith(needle) || n.split(/[/:.-]/).some((part) => part.startsWith(needle))) score = 1;
      else if (n.includes(needle)) score = 2;
      else if (s.summary?.toLowerCase().includes(needle)) score = 3;
      if (score >= 0) {
        hits.push({ kind: "package", format: fmt, repo, name, latestVersion: s.latestVersion, summary: s.summary, updatedAt: s.updatedAt, score });
      }
    }
  }
  hits.sort((a, b) => a.score - b.score || (a.kind === "package" && b.kind === "package" ? b.updatedAt.localeCompare(a.updatedAt) : 0));
  return { hits: hits.slice(0, limit).map(({ score: _s, ...h }) => h as SearchHit), total: hits.length };
}

// --- Registries, sessions, reindex -----------------------------------------------------------

export function listRegistries() {
  return registries.map((r) => ({
    ...r,
    repos: repoSeeds.filter((s) => s.registry === r.name).map(keyOf),
  }));
}

const sessions: (PublishSession & { repo: string })[] = [
  {
    id: 41,
    repo: "maven/payments",
    key: "com.acme.payments:payments-api:3.8.1",
    principal: "token:12",
    state: "open",
    files: ["payments-api-3.8.1.jar", "payments-api-3.8.1-sources.jar", "payments-api-3.8.1.pom"].map((name, i) => ({
      name,
      size: [221_502, 156_902, 4_488][i]!,
      digest: `sha256:${sha256Hex(`session:${name}`)}`,
    })),
    createdAt: before(0, 0, 4),
    updatedAt: before(0, 0, 1),
    expiresAt: ahead(0, 0, 41),
  },
  {
    id: 38,
    repo: "maven/releases",
    key: "com.acme.tools:schema-cli:1.0.1",
    principal: "user:carol",
    state: "expired",
    files: [{ name: "schema-cli-1.0.1.jar", size: 64_330, digest: `sha256:${sha256Hex("session:schema-cli-1.0.1.jar")}` }],
    createdAt: before(1, 4),
    updatedAt: before(1, 3, 30),
    expiresAt: before(1, 3, 30),
  },
];

export function listSessions(repo: Repo): PublishSession[] {
  return sessions.filter((s) => s.repo === repo.prefix).map(({ repo: _r, ...s }) => s);
}

export function reindexReport(repo: MockRepo): ReindexReport {
  const pkgs = byRepo.get(repo.prefix) ?? new Map<string, Row[]>();
  const manifests = [...pkgs.values()].flat();
  const foreign: ReindexReport["foreign"] = [];
  let removed = 0;
  if (repo.prefix === "raw/assets") {
    foreign.push({
      path: "raw/assets/charts/podinfo",
      tag: "6.7.1",
      digest: `sha256:${sha256Hex("foreign:podinfo")}`,
      reason: "Helm chart (config application/vnd.cncf.helm.config.v1+json) without lajstrom.schema: pushed around Lajstrom",
    });
  }
  if (repo.prefix === "raw/scratch") {
    foreign.push({
      path: "raw/scratch/tmp/debug-image",
      tag: "latest",
      digest: `sha256:${sha256Hex("foreign:debug-image")}`,
      reason: "container image without lajstrom.schema",
    });
    removed = 1;
  }
  // While a reindex runs, the report is the one of the previous, finished run.
  const running = repo.reindex.state === "running";
  return {
    repo: repo.prefix,
    startedAt: running ? before(0, 1, 21) : (repo.reindex.startedAt ?? before(0, 0, 21)),
    finishedAt: running ? before(0, 1, 20) : (repo.reindex.finishedAt ?? before(0, 0, 20)),
    ociRepositories: pkgs.size + foreign.length,
    manifests: manifests.length + foreign.length,
    added: 0,
    updated: 0,
    removed,
    degraded: manifests.filter((v) => v.degraded).length,
    foreign,
  };
}

// --- Audit ----------------------------------------------------------------------------------

const ipOf: Record<string, string> = {
  "user:admin": "10.8.0.10",
  "user:alice": "10.8.0.21",
  "user:bob": "10.8.0.34",
  "user:carol": "10.8.0.47",
};

const clientOf: Record<string, string> = {
  raw: "curl/8.5.0",
  pypi: "twine/5.1.1 CPython/3.12.3",
  apt: "curl/8.5.0",
  maven: "Apache-Maven/3.9.9 (Java 21.0.4)",
};

function auditLog(): AuditEvent[] {
  const events: Omit<AuditEvent, "id">[] = [];
  for (const v of allVersions) {
    const format = v.format;
    const principal = v.uploadedBy ?? "user:admin";
    events.push({
      at: v.createdAt,
      principal,
      action: "push",
      repo: v.repoKey,
      subject: `${v.packageName}@${v.version}${v.variant ? ` (${v.variant})` : ""}`,
      digest: v.digest,
      ip: ipOf[principal] ?? `10.20.4.${(Number(principal.split(":")[1]) * 7) % 250}`,
      details: {
        requestId: sha256Hex(`req:${v.digest}`).slice(0, 26).toUpperCase(),
        tag: v.tag,
        client: principal.startsWith("token:") && format === "apt" ? "oras/1.2.0" : clientOf[format],
      },
    });
  }
  for (const s of repoSeeds) {
    events.push({ at: s.createdAt, principal: "user:admin", action: "repo.create", repo: keyOf(s), subject: keyOf(s), digest: null, ip: ipOf["user:admin"]!, details: { registry: s.registry, anonymousRead: s.anonymousRead } });
  }
  for (const u of users.filter((u) => u.name !== "admin")) {
    events.push({ at: u.createdAt, principal: "user:admin", action: "user.create", repo: "", subject: `user:${u.name}`, digest: null, ip: ipOf["user:admin"]!, details: {} });
  }
  for (const b of bindings.filter((b) => b.id !== 1)) {
    events.push({ at: b.createdAt, principal: "user:admin", action: "binding.create", repo: "", subject: b.principal, digest: null, ip: ipOf["user:admin"]!, details: { role: b.role, repoMask: b.repoMask, binding: b.id } });
  }
  for (const t of tokens) {
    const by = t.kind === "pat" ? `user:${t.user}` : t.repo?.startsWith("apt/") ? "user:bob" : "user:admin";
    events.push({ at: t.createdAt, principal: by, action: "token.create", repo: t.repo ?? "", subject: t.kind === "pat" ? `user:${t.user}` : `token:${t.id}`, digest: null, ip: ipOf[by] ?? "10.8.0.10", details: { token: t.id, kind: t.kind, name: t.name, scopes: t.scopes } });
    if (t.revokedAt) {
      events.push({ at: t.revokedAt, principal: `user:${t.user}`, action: "token.revoke", repo: "", subject: `user:${t.user}`, digest: null, ip: ipOf[`user:${t.user}`] ?? "10.8.0.10", details: { token: t.id, name: t.name } });
    }
  }
  events.push(
    { at: ago(64), principal: "user:admin", action: "user.disable", repo: "", subject: "user:dave", digest: null, ip: ipOf["user:admin"]!, details: { reason: "left the company" } },
    { at: ago(30, 2), principal: "user:bob", action: "key.rotate", repo: "apt/ubuntu-internal", subject: "gpg", digest: null, ip: ipOf["user:bob"]!, details: { from: "rsa4096", to: "ed25519" } },
    { at: ago(12, 3), principal: "user:admin", action: "repo.update", repo: "maven/payments", subject: "maven/payments", digest: null, ip: ipOf["user:admin"]!, details: { "policy.maven.sessionTimeout": ["30m", "45m"], "policy.maven.sessionExpiry": ["abort", "seal"] } },
    { at: ago(1, 1), principal: "user:bob", action: "delete", repo: "raw/scratch", subject: "tmp/build-4702.log@3b0c4f1a9e2d7c55", digest: `sha256:${sha256Hex("deleted:build-4702")}`, ip: ipOf["user:bob"]!, details: { versions: 1 } },
    { at: ago(2, 6), principal: "user:admin", action: "repo.reindex", repo: "raw/scratch", subject: "raw/scratch", digest: null, ip: ipOf["user:admin"]!, details: { removed: 1, foreign: 1 } },
  );
  events.push(...demoEvents);
  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.map((e, i) => ({ id: events.length - i, ...e }));
}

/** The audit log, computed again after a change in the demo. */
let auditCache: AuditEvent[] | null = null;
const audit = () => (auditCache ??= auditLog());

export type AuditQuery = { repo?: string; principal?: string; action?: string; since?: string; until?: string; limit?: number; cursor?: string };

export function listAudit(q: AuditQuery) {
  let rows = audit();
  if (q.repo) rows = rows.filter((e) => e.repo === q.repo);
  if (q.principal) rows = rows.filter((e) => e.principal === q.principal);
  if (q.action) rows = rows.filter((e) => e.action === q.action);
  if (q.since) rows = rows.filter((e) => e.at >= q.since!);
  if (q.until) rows = rows.filter((e) => e.at <= q.until!);
  const { page, ...info } = paginate(rows, q.limit ?? 50, q.cursor);
  return { events: page, ...info };
}


// --- Changes made in the demo ---------------------------------------------------------------
// What the API lets a caller of the demo change in repos: create, change and delete them, with
// the server's rules (docs/api.md, Repos). The UI is read-only and offers none of it; the API
// docs of the demo can. Every change is an audit event and is kept by src/mocks/state.ts, so
// that a reload replays it.

/** Repos of the seed deleted in the demo: their seeded versions go when it reloads. */
const deletedRepos = new Set<string>();
/** Audit events of changes the data does not show by itself: updates and deletes. */
const demoEvents: Omit<AuditEvent, "id">[] = [];

const DEMO_IP = "192.0.2.10";

function changed(event?: Omit<AuditEvent, "id">): void {
  if (event) demoEvents.push(event);
  auditCache = null;
  persist();
}

function removeRows(match: (v: Row) => boolean): number {
  let n = 0;
  for (let i = allVersions.length - 1; i >= 0; i--) {
    if (match(allVersions[i]!)) {
      allVersions.splice(i, 1);
      n++;
    }
  }
  return n;
}

function dropRepoData(repoKey: string): number {
  byRepo.delete(repoKey);
  return removeRows((v) => v.repoKey === repoKey);
}

keep("db", {
  save: () => ({ repos: repoSeeds, deletedRepos: [...deletedRepos], events: demoEvents }),
  load: (data) => {
    const d = data as { repos?: RepoSeed[]; deletedRepos?: string[]; events?: Omit<AuditEvent, "id">[] };
    if (!Array.isArray(d.repos)) return;
    repoSeeds.splice(0, repoSeeds.length, ...d.repos);
    for (const k of d.deletedRepos ?? []) {
      deletedRepos.add(k);
      dropRepoData(k);
    }
    demoEvents.push(...(d.events ?? []));
    auditCache = null;
  },
});

/** A refusal the handler answers: the status, and the message of the server's error. */
export type Refusal = { status: number; code: string; message: string };

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

/** Repo names: lowercase letters and digits separated by single '.', '_' or '-' (manifest-profile.md §4.1). */
const REPO_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const FORMATS = ["raw", "pypi", "apt", "maven", "oci"] as const;
const POLICY_KEYS = ["maxFileSize", "blobRedirect", "maven.sessionTimeout", "maven.sessionExpiry"];

function checkPolicy(policy: unknown): Refusal | null {
  if (policy === null || policy === undefined) return null;
  if (typeof policy !== "object" || Array.isArray(policy)) return invalid("policy: a JSON object or null");
  const unknown = Object.keys(policy).find((k) => !POLICY_KEYS.includes(k));
  return unknown ? invalid(`policy: ${unknown} is not a policy key`) : null;
}

export function versionCount(repoKey: string): number {
  return [...(byRepo.get(repoKey)?.values() ?? [])].reduce((n, list) => n + list.length, 0);
}

/** POST /api/v1/repos: the admin creates a repo (docs/api.md, Repos). */
export function createRepo(body: unknown, by: string): MockRepo | Refusal {
  if (typeof body !== "object" || body === null) return invalid("the body must be a JSON object");
  const b = body as Record<string, unknown>;
  const known = ["format", "name", "registry", "kind", "anonymousRead", "policy"];
  const unknown = Object.keys(b).find((k) => !known.includes(k));
  if (unknown) return invalid(`${unknown}: not a field of a repo`);
  if (!FORMATS.includes(b.format as (typeof FORMATS)[number])) return invalid(`format: one of ${FORMATS.join(", ")}`);
  if (typeof b.name !== "string" || b.name.length > 64 || !REPO_NAME.test(b.name)) {
    return invalid(`name: "${String(b.name ?? "")}" must be lowercase letters and digits separated by single '.', '_' or '-', at most 64 characters`);
  }
  if (typeof b.registry !== "string" || !registries.some((r) => r.name === b.registry)) {
    return invalid(`registry: one of ${registries.map((r) => r.name).join(", ")}`);
  }
  if (b.kind !== undefined && b.kind !== "hosted") return invalid("kind: hosted, the only kind in this version");
  if (b.anonymousRead !== undefined && typeof b.anonymousRead !== "boolean") return invalid("anonymousRead: true or false");
  const policyError = checkPolicy(b.policy);
  if (policyError) return policyError;
  const key = `${b.format}/${b.name}`;
  if (repoSeeds.some((s) => keyOf(s) === key)) return { status: 409, code: "CONFLICT", message: `repo ${key} exists` };

  const now = new Date().toISOString();
  const seed: RepoSeed = {
    format: b.format as RepoSeed["format"],
    name: b.name,
    registry: b.registry,
    anonymousRead: b.anonymousRead === true,
    policy: (b.policy as RepoSeed["policy"]) ?? null,
    createdAt: now,
    updatedAt: now,
    reindex: "idle",
  };
  repoSeeds.push(seed);
  // A new repo starts empty, even where one of the same name was deleted.
  dropRepoData(key);
  changed();
  return repoOf(seed, by.replace(/^user:/, ""));
}

/** PATCH /api/v1/repos/{format}/{repo}: anonymousRead and policy; the rest cannot change. */
export function updateRepo(repo: MockRepo, body: unknown, by: string): MockRepo | Refusal {
  if (typeof body !== "object" || body === null) return invalid("the body must be a JSON object");
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) {
    if (["format", "name", "registry", "kind"].includes(k)) return invalid(`${k}: cannot change`);
    if (k !== "anonymousRead" && k !== "policy") return invalid(`${k}: not a field of a repo`);
  }
  if (b.anonymousRead !== undefined && typeof b.anonymousRead !== "boolean") return invalid("anonymousRead: true or false");
  const policyError = checkPolicy(b.policy);
  if (policyError) return policyError;
  const seed = repoSeeds.find((s) => keyOf(s) === repo.prefix)!;
  const before = { anonymousRead: seed.anonymousRead, policy: seed.policy };
  const after = {
    anonymousRead: b.anonymousRead === undefined ? seed.anonymousRead : (b.anonymousRead as boolean),
    policy: b.policy === undefined ? seed.policy : ((b.policy as RepoSeed["policy"]) ?? null),
  };
  // A body that changes nothing changes nothing, not even updatedAt.
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    seed.anonymousRead = after.anonymousRead;
    seed.policy = after.policy;
    seed.updatedAt = new Date().toISOString();
    changed({ at: seed.updatedAt, principal: by, action: "repo.update", repo: repo.prefix, subject: repo.prefix, digest: null, ip: DEMO_IP, details: { from: before, to: after, source: "api" } });
  }
  return repoOf(seed, by.replace(/^user:/, ""));
}

/** DELETE /api/v1/repos/{format}/{repo}[?force=true]: refused with versions unless forced. */
export function deleteRepo(repo: MockRepo, force: boolean, by: string): Refusal | null {
  const versions = versionCount(repo.prefix);
  if (versions > 0 && !force) {
    return { status: 409, code: "CONFLICT", message: `repo ${repo.prefix} has ${versions} versions; delete them or pass force=true` };
  }
  repoSeeds.splice(repoSeeds.findIndex((s) => keyOf(s) === repo.prefix), 1);
  dropRepoData(repo.prefix);
  deletedRepos.add(repo.prefix);
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i]!.repo === repo.prefix) tokens.splice(i, 1);
  changed({ at: new Date().toISOString(), principal: by, action: "repo.delete", repo: repo.prefix, subject: repo.prefix, digest: null, ip: DEMO_IP, details: { versions, source: "api" } });
  return null;
}

export { bindings, tokens, users, serverInfo };
