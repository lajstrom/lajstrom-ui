// The mock's access report and its review (docs/spec/rbac.md §14; internal/api/access.go and
// internal/auth/access.go of the server): who has what at one moment, one document in its
// canonical form, compact, the keys of every object in byte order, its lists in a fixed order,
// its times to the second and a line feed at the end, so that a review names it by the sha256 of
// its bytes; and the record of a review, the audit row access.review.

import type { AuditEvent, CIPolicy, Token } from "@/api/types";

import { tokenView } from "./auth";
import { listCIPolicies } from "./ci";
import { config, serverInfo, tokens } from "./data/system";
import { audited, latestAudit, listBindings, listRepos, listUsers, type Refusal } from "./db";

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

const SCOPES = ["all", "people", "systems"];
const DAY = 86_400_000;
/** How long the groups of an OIDC login stay a user's in the demo (auth.oidc.tokenLifetime). */
const GROUPS_FOR = 30 * DAY;

/** The flags of an entry or a token that hold, in their order. */
const FLAGS = ["admin", "allRepos", "adminWithoutEffect", "noExpiry", "unused", "beyondMaxTTL", "ownerDisabled", "inactive"] as const;
type Flag = (typeof FLAGS)[number];
const flags = (on: Partial<Record<Flag, boolean>>) => FLAGS.filter((f) => on[f]);

type Binding = ReturnType<typeof listBindings>[number] & { via?: string };

/** ?scope= and ?unusedDays= of a report, or the server's 400. */
export function reportQuery(url: URL): { scope: string; unusedDays: number } | Refusal {
  for (const key of ["scope", "unusedDays"]) if (url.searchParams.getAll(key).length > 1) return invalid(`${key}: once in the query`);
  const scope = url.searchParams.get("scope") ?? "all";
  if (!SCOPES.includes(scope)) return invalid(`scope: "${scope}" is not all, people or systems`);
  const raw = url.searchParams.get("unusedDays");
  const unusedDays = raw === null ? 90 : Number(raw);
  if (!/^\d+$/.test(raw ?? "90") || unusedDays < 1 || unusedDays > 3650) return invalid(`unusedDays: "${raw}" is not a number of days from 1 to 3650`);
  return { scope, unusedDays };
}

/** The document of scope at now, in its canonical form. */
export function accessReport(scope: string, unusedDays: number, now = Date.now()): string {
  const at = now - (now % 1000);
  const cutoff = at - unusedDays * DAY;
  const bindings: Binding[] = listBindings(null);
  const byRole = (a: Binding, b: Binding) => cmp(a.role, b.role) || cmp(a.repoMask, b.repoMask) || cmp(a.via ?? "", b.via ?? "") || a.id - b.id;
  const bindingFlags = (bs: Binding[]) => ({ admin: bs.some((b) => b.role === "admin"), allRepos: bs.some((b) => b.repoMask === "*/*") });
  const tokenEntry = (t: Token) => {
    const v = tokenView(t, now);
    const last = Date.parse(t.lastUsedAt ?? t.createdAt);
    return {
      ...v,
      flags: flags({ allRepos: t.repoMask === "*/*", noExpiry: t.expiresAt === null, unused: last < cutoff, beyondMaxTTL: v.beyondMaxTTL === true }),
    };
  };
  const live = (t: Token) => t.revokedAt === null && (t.expiresAt === null || Date.parse(t.expiresAt) > now);

  const people = scope !== "systems";
  const systems = scope !== "people";
  const users = listUsers()
    .filter((u) => (u.kind === "service" ? systems : people))
    .map((u) => {
      const principal = `user:${u.uid}`;
      const groups = (u.groups ?? []).map((name) => ({ name, expiresAt: new Date(Date.parse(u.lastSeenAt ?? u.createdAt) + GROUPS_FOR).toISOString() })).filter((g) => Date.parse(g.expiresAt) > now);
      const own = bindings.filter((b) => b.principal === principal);
      const viaGroups = groups.flatMap((g) => bindings.filter((b) => b.principal === `group:${g.name}`).map((b) => ({ ...b, via: `group:${g.name}` })));
      const all = [...own, ...viaGroups].sort(byRole);
      const pats = tokens.filter((t) => t.kind === "pat" && t.user === u.name && live(t)).sort((a, b) => a.id - b.id).map(tokenEntry);
      return {
        ...u,
        principal,
        groups: groups.sort((a, b) => cmp(a.name, b.name)),
        bindings: all,
        tokens: pats,
        flags: flags({ ...bindingFlags(all), unused: Date.parse(u.lastSeenAt ?? u.createdAt) < cutoff, inactive: u.inactive === true }),
      };
    })
    .sort((a, b) => cmp(a.name, b.name));

  const doc: Record<string, unknown> = {
    generatedAt: new Date(at).toISOString(),
    scope,
    unusedDays,
    settings: {
      adminMFA: serverInfo.adminMFA === true,
      anonymousRead: serverInfo.anonymousRead,
      disableInactiveUsersAfter: config.disableInactiveUsersAfterHours * 3600,
      deployTokensMaxTTL: config.deployTokensMaxTTLHours * 3600,
      serviceAccountsMaxTokenTTL: 365 * 86400,
    },
    users,
  };
  if (people) {
    const groupNames = [...new Set(bindings.filter((b) => b.principal.startsWith("group:")).map((b) => b.principal))].sort(cmp);
    doc.groups = groupNames.map((principal) => {
      const own = bindings.filter((b) => b.principal === principal).sort(byRole);
      const members = users
        .flatMap((u) => u.groups.filter((g) => `group:${g.name}` === principal).map((g) => ({ principal: u.principal, name: u.name, expiresAt: g.expiresAt })))
        .sort((a, b) => cmp(a.principal, b.principal));
      return { principal, bindings: own, members, flags: flags(bindingFlags(own)) };
    });
  }
  if (systems) {
    doc.workloads = [];
    doc.deployTokens = tokens
      .filter((t) => t.kind === "deploy" && live(t))
      .sort((a, b) => a.id - b.id)
      .map((t) => ({ ...tokenEntry(t), principal: `token:${t.id}` }));
    doc.ciPolicies = listCIPolicies(now)
      .policies.sort((a, b) => cmp(a.name, b.name))
      .map((p: CIPolicy) => ({ ...p, flags: flags({ noExpiry: !p.expiresAt, allRepos: p.grants.some((g) => g.mask === "*/*") }) }));
  }
  if (serverInfo.anonymousRead) {
    doc.anonymous = { repos: listRepos("anonymous").map((r) => `${r.format}/${r.name}`).sort(cmp) };
  }
  return `${canonical(doc)}\n`;
}

/** Byte order, for keys and lists. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const MILLIS = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z$/;

/** Compact JSON, the keys of every object in byte order, its times to the second. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return `{${entries
      .sort(([a], [b]) => cmp(a, b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  }
  if (typeof v === "string") return JSON.stringify(v.replace(MILLIS, "$1Z"));
  return JSON.stringify(v);
}

/** POST /api/v1/access-reviews by the admin by: the review checked as the server checks it, and
 * its access.review row, answered as GET /api/v1/audit answers it. */
export function recordReview(body: unknown, by: string, now = Date.now()): AuditEvent | Refusal {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid("body: must be a JSON object");
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).find((k) => !["sha256", "generatedAt", "scope", "note"].includes(k));
  if (unknown) return invalid(`body: unknown field "${unknown}"`);
  const sha = typeof b.sha256 === "string" ? b.sha256 : "";
  const note = typeof b.note === "string" ? b.note : "";
  const scope = typeof b.scope === "string" ? b.scope : "all";
  const generatedAt = typeof b.generatedAt === "string" ? b.generatedAt : "";
  if (generatedAt !== "" && !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(generatedAt)) {
    return invalid(`generatedAt: "${generatedAt}" is not an RFC 3339 time, like 2026-11-18T10:00:00Z`);
  }
  if (sha.startsWith("sha256:")) return invalid("sha256: the 64 hexadecimal digits alone, without sha256:");
  if (!/^[0-9a-f]{64}$/.test(sha)) return invalid(`sha256: ${sha.length} characters; want the sha256 of the document's bytes, 64 lowercase hexadecimal digits`);
  if (generatedAt === "") return invalid("generatedAt: required, the generatedAt of the document reviewed");
  if (!SCOPES.includes(scope)) return invalid(`scope: "${scope}" is not all, people or systems`);
  const bytes = new TextEncoder().encode(note).length;
  if (note === "") return invalid("note: required: what was found and done, who acknowledged, the ticket; 1 byte at least");
  if (bytes > 4096) return invalid(`note: ${bytes} bytes, at most 4096`);
  if (/[^\P{Cc}\n]/u.test(note)) return invalid("note: a control character (a tab, a carriage return); a line feed is the one it may hold");
  const at = Date.parse(generatedAt);
  if (at > now + 60_000) {
    const second = (ms: number) => new Date(ms - (ms % 1000)).toISOString().replace(".000Z", "Z");
    return invalid(`generatedAt: ${second(at)} is after the server's time, ${second(now)}: the generatedAt of the document reviewed, which is never ahead of the server`);
  }
  const iso = new Date(at).toISOString().replace(".000Z", "Z");
  audited({ principal: by, action: "access.review", repo: "", subject: `sha256:${sha}`, details: { sha256: sha, generatedAt: iso, scope, note, source: "api" } });
  return latestAudit("access.review")!;
}
