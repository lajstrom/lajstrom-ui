// The in-memory "server" behind the mock API: the seed turned into the rows and answers
// Lajstrom would compute. Handlers in handlers.ts translate HTTP to these functions.

import type {
  Attachment,
  AttachmentList,
  AuditEvent,
  AuditList,
  BatchDeleteItemResult,
  BatchDeleteResult,
  Binding,
  Caller,
  FacetValue,
  PackageDetail,
  PackageList,
  Pointer,
  PublishSession,
  VariantDetail,
  VersionDetail,
  RawDirectory,
  ReindexReport,
  ReindexRun,
  Repo,
  RepoPolicy,
  SearchHit,
  VersionSummary,
  WhoAmI,
  Yank,
} from "@/api/types";
import type { User } from "@/api/types";
import { formatSpec } from "@/lib/formats";
import { packagePath } from "@/lib/profile";
import { sha256Hex } from "@/lib/sha256";

import { aptVersions } from "./data/apt";
import { buildVersion, type BuiltVersion } from "./data/builders";
import { mavenVersions } from "./data/maven";
import { npmDistTags, npmVersions } from "./data/npm";
import { pypiVersions } from "./data/pypi";
import { rawVersions } from "./data/raw";
import { reindexFindings } from "./data/reindex";
import { rpmVersions } from "./data/rpm";
import { bindings, registries, repoSeeds, roleActions, serverInfo, tokens, uidOf, users, type MockBinding, type RepoSeed } from "./data/system";
import { passwords } from "./data/system";
import { ago, ahead, before, HOST } from "./data/time";
import { getPersona, type Persona } from "./persona";
import { durationSeconds, groupRefusal, isPackageName, mergeGroup, mergeUpstream, prefetchImages, upstreamRefusal } from "./proxy";
import { keep, persist } from "./state";
import { upstreams } from "./data/system";
import type { PrefetchResult, RepoGroup, Upstream } from "@/api/types";

type Action = "read" | "write" | "delete" | "manage";

/** The mock answers the proposed fields of api-proposal.md §3.2 too, so its repos have them all. */
export type MockRepo = Repo & Required<Pick<Repo, "stats" | "permissions" | "reindex">>;

type Row = BuiltVersion & { repoKey: string; format: string };

const allVersions: Row[] = [...rawVersions(), ...pypiVersions(), ...aptVersions(), ...mavenVersions(), ...npmVersions(), ...rpmVersions()].map((spec) => ({
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

// --- npm dist-tags (manifest-profile.md §8) -------------------------------------------------

/** The journal state of the seed's npm packages, by `<repoKey> <name>`: dist-tag → version. */
const distTags = new Map(npmDistTags().map((d) => [`npm/${d.repo} ${d.name}`, d.tags]));

/** The pointers that name a manifest's version: its package's dist-tags, sorted by name, as
 * format.PointersOf answers them. A tag of a deleted version names nothing the list has. */
function pointersOf(v: Row): Pointer[] {
  const tags = distTags.get(`${v.repoKey} ${v.packageName}`) ?? {};
  return Object.entries(tags)
    .filter(([, version]) => version === v.version)
    .map(([name]): Pointer => ({ kind: "dist-tag", name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The version the dist-tag latest names, while the package has it. */
function latestTagged(list: Row[]): Row | undefined {
  const latest = list[0] ? distTags.get(`${list[0].repoKey} ${list[0].packageName}`)?.latest : undefined;
  return latest === undefined ? undefined : list.find((v) => v.version === latest);
}

/** The refusal of a delete of a version that pointers name (format.RefusedProtected). */
function protectedMessage(repo: Repo, v: Row, pointers: Pointer[]): string {
  const names = pointers.map((p) => `${p.kind} ${p.name}`).join(", ");
  return `version ${v.version} of "${v.packageName}" in ${keyOf(repo)} is what ${names} points to; move it, or force the delete; nothing was deleted`;
}

// --- RBAC (docs/spec/rbac.md §3) ---------------------------------------------------------

function maskMatches(mask: string, repoKey: string): boolean {
  const [mf, mr] = mask.split("/");
  const [f, r] = repoKey.split("/");
  return (mf === "*" || mf === f) && (mr === "*" || mr === r);
}

function permissions(persona: Persona, seed: RepoSeed): Action[] {
  const repoKey = keyOf(seed);
  if (persona !== "anonymous") {
    const principals = principalsOf(persona);
    const granted = new Set<Action>();
    for (const b of bindings) {
      if (!principals.includes(b.principal)) continue;
      if (b.role === "admin" || maskMatches(b.repoMask, repoKey)) roleActions[b.role].forEach((a) => granted.add(a));
    }
    if (granted.size) return (["read", "write", "delete", "manage"] as Action[]).filter((a) => granted.has(a));
  }
  return seed.anonymousRead && serverInfo.anonymousRead ? ["read"] : [];
}

export function isAdmin(persona = getPersona()): boolean {
  const principals = principalsOf(persona);
  return bindings.some((b) => principals.includes(b.principal) && b.role === "admin");
}

/** The principals whose bindings a user has: its own and those of its groups now (rbac.md §8). */
function principalsOf(name: string): string[] {
  const groups = users.find((u) => u.name === name)?.groups ?? [];
  return [`user:${name}`, ...groups.map((g) => `group:${g}`)];
}

// The mock names users `user:<name>` inside; the API answers the canonical `user:<uid>`, and
// takes either (docs/auth.md, the uid and the name).

/** `user:<name>` as the API answers it, `user:<uid>`; other principals as they are. */
export function apiPrincipal(principal: string): string {
  return principal.startsWith("user:") ? `user:${uidFor(principal.slice(5))}` : principal;
}

/** A principal of a request, `user:<name>` or `user:<uid>`, as the mock names it inside. */
function mockPrincipal(principal: string): string {
  const user = principal.startsWith("user:") ? userByRef(principal.slice(5)) : undefined;
  return user ? `user:${user.name}` : principal;
}

/** A user by its name or its uid, as /api/v1/users/{user} takes it. */
export function userByRef(ref: string) {
  return users.find((u) => u.name === ref || u.uid === ref);
}

/** The caller of /api/v1/info. */
export function caller(persona = getPersona()): Caller {
  if (persona === "anonymous") return { principal: "anonymous", kind: "anonymous", name: "anonymous", admin: false };
  return { principal: apiPrincipal(`user:${persona}`), kind: "user", name: persona, uid: uidFor(persona), admin: isAdmin(persona) };
}

export function whoami(persona = getPersona()): WhoAmI {
  return { principal: apiPrincipal(`user:${persona}`), kind: "user", name: persona, uid: uidFor(persona) };
}

function bindingJson(b: MockBinding): Binding {
  return { ...b, principal: apiPrincipal(b.principal), name: b.principal.startsWith("user:") ? b.principal.slice(5) : undefined };
}

/** GET /api/v1/bindings, of every principal or of one. */
export function listBindings(principal: string | null): Binding[] {
  const of = principal ? mockPrincipal(principal) : null;
  return bindings.filter((b) => !of || b.principal === of).map(bindingJson);
}

// --- Users and bindings changed in the demo -------------------------------------------------
// The admin creates, renames, disables, enables and deletes users, sets their passwords, and
// creates and deletes bindings, with the server's rules and messages (docs/api.md, Users and
// Bindings; docs/spec/rbac.md §1, §3). Inside, a user is `user:<name>` as above: a rename
// renames it in the bindings and the tokens, and its uid stays. Every change is an audit row,
// and the demo keeps them (src/mocks/state.ts).

/** The seed as it was, for the audit rows of it: a change in the demo adds rows, never removes. */
const seedUsers = users.map((u) => ({ ...u }));
const seedBindings = bindings.map((b) => ({ ...b }));

/** Users deleted in the demo: the server keeps the row, named ~<uid>, with the name it had. */
const deletedUsers: (User & { deletedName: string })[] = [];
/** The uid of each name a user had before a rename or a delete, for the audit rows of then. */
const formerUids = new Map<string, string>();
let nextBindingId = Math.max(0, ...bindings.map((b) => b.id)) + 1;

keep("users", {
  save: () => ({ users, bindings, deletedUsers, formerUids: [...formerUids], passwords: [...passwords], nextBindingId }),
  load: (data) => {
    const d = data as {
      users?: User[];
      bindings?: MockBinding[];
      deletedUsers?: (User & { deletedName: string })[];
      formerUids?: [string, string][];
      passwords?: [string, string][];
      nextBindingId?: number;
    };
    if (!Array.isArray(d.users) || !Array.isArray(d.bindings)) return;
    users.splice(0, users.length, ...d.users);
    bindings.splice(0, bindings.length, ...d.bindings);
    deletedUsers.splice(0, deletedUsers.length, ...(d.deletedUsers ?? []));
    for (const [name, uid] of d.formerUids ?? []) formerUids.set(name, uid);
    for (const [name, hash] of d.passwords ?? []) passwords.set(name, hash);
    if (typeof d.nextBindingId === "number") nextBindingId = d.nextBindingId;
    auditCache = null;
  },
});

/** The uid of a user the mock names: the live user of the name, or the one that had it; a
 * deleted user's name is ~<uid>. */
function uidFor(name: string): string {
  if (name.startsWith("~")) return name.slice(1);
  return users.find((u) => u.name === name)?.uid ?? formerUids.get(name) ?? uidOf(name);
}

/** The name an audit row shows for a user: a deleted one's is the name it had. */
function nameFor(name: string): string {
  return name.startsWith("~") ? (deletedUsers.find((u) => `~${u.uid}` === name)?.deletedName ?? name) : name;
}

export function listUsers(): User[] {
  return [...users].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const conflict = (message: string): Refusal => ({ status: 409, code: "CONFLICT", message });

/** A body of one JSON object with no field but those known, as the server decodes it. */
function bodyRefusal(body: unknown, known: string[]): Refusal | null {
  if (!isObject(body)) return invalid("body: must be a JSON object");
  const unknown = Object.keys(body).find((k) => !known.includes(k));
  return unknown === undefined ? null : invalid(`body: unknown field "${unknown}"`);
}

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bytes = (s: string) => new TextEncoder().encode(s).length;

/** A user name of rbac.md §1 (CheckName of the server), or why not; the name quoted as Go's %q
 * does. */
export function nameRefusal(name: string): Refusal | null {
  if (name === "") return invalid("name: must not be empty");
  if (name === "deploy") return invalid('name: "deploy" is reserved: Basic credentials deploy:<token> are a deploy token');
  if (UID.test(name)) return invalid(`name: ${JSON.stringify(name)} has the form of a uid, which user:<uid> means; a name may not (docs/spec/rbac.md §1)`);
  if (bytes(name) > 64 || !/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return invalid(`name: ${JSON.stringify(name)} must be lowercase letters, digits, '.', '_' and '-', starting with a letter or a digit, at most 64 bytes`);
  }
  return null;
}

/** A password of 8 to 1024 bytes that is no token's secret (CheckPassword of the server). */
export function passwordRefusal(password: string): Refusal | null {
  if (bytes(password) < 8) return invalid("password: must be at least 8 bytes");
  if (bytes(password) > 1024) return invalid("password: must be at most 1024 bytes");
  if (password.startsWith("ljs_pat_") || password.startsWith("ljs_dep_")) {
    return invalid("password: must not start with ljs_pat_ or ljs_dep_: a secret with either is a token's");
  }
  return null;
}

/** Whether an enabled user has an admin binding, but for those skip leaves out; a group's admin
 * binding does not count (rbac.md §3). */
function anyAdmin(skip: (b: MockBinding) => boolean): boolean {
  return bindings.some((b) => !skip(b) && b.role === "admin" && users.some((u) => !u.disabled && b.principal === `user:${u.name}`));
}

const lastAdmin = (name: string) =>
  conflict(`user ${name} is the last enabled user with an admin binding: create another admin first (lajstrom admin user create --admin, or admin binding create)`);

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** POST /api/v1/users: a local user with its password, and with admin its admin binding too. */
export function createUser(body: unknown, by: string): User | Refusal {
  const refused = bodyRefusal(body, ["name", "password", "admin"]);
  if (refused) return refused;
  const b = body as Record<string, unknown>;
  if (b.admin !== undefined && b.admin !== null && typeof b.admin !== "boolean") return invalid("admin: must not be a JSON " + typeof b.admin);
  const name = str(b.name);
  const bad = nameRefusal(name) ?? passwordRefusal(str(b.password));
  if (bad) return bad;
  if (users.some((u) => u.name === name)) return conflict(`user ${name} already exists`);
  const now = new Date().toISOString();
  const user: User = { uid: uidOf(`${name} ${now}`), name, kind: "local", disabled: false, createdAt: now };
  users.push(user);
  passwords.set(name, sha256Hex(str(b.password)));
  if (b.admin === true) bindings.push({ id: nextBindingId++, principal: `user:${name}`, role: "admin", repoMask: "*/*", createdAt: now });
  changed({ at: now, principal: by, action: "user.create", repo: "", subject: `user:${name}`, digest: null, ip: DEMO_IP, details: { name, admin: b.admin === true, source: "api" } });
  return user;
}

function renameUser(user: User, to: string): void {
  const from = user.name;
  formerUids.set(from, user.uid);
  user.name = to;
  for (const b of bindings) if (b.principal === `user:${from}`) b.principal = `user:${to}`;
  for (const t of tokens) if (t.kind === "pat" && t.user === from) t.user = to;
  // A user of the seed signs in with its old name as its password still.
  const hash = passwords.get(from) ?? (user.kind === "local" ? sha256Hex(from) : undefined);
  passwords.delete(from);
  if (hash !== undefined) passwords.set(to, hash);
}

/** PATCH /api/v1/users/{user}: disabled first, then the name, each an audit row of its own; a
 * value the user has already changes nothing. */
export function updateUser(user: User, body: unknown, by: string): User | Refusal {
  const refused = bodyRefusal(body, ["name", "disabled"]);
  if (refused) return refused;
  const b = body as { name?: unknown; disabled?: unknown };
  if (b.name !== undefined && b.name !== null && typeof b.name !== "string") return invalid("name: must not be a JSON " + typeof b.name);
  if (b.disabled !== undefined && b.disabled !== null && typeof b.disabled !== "boolean") return invalid("disabled: must not be a JSON " + typeof b.disabled);
  const name = b.name as string | null | undefined;
  const disabled = b.disabled as boolean | null | undefined;
  if (name == null && disabled == null) return invalid("body: nothing to change; the fields are name and disabled");
  const at = new Date().toISOString();
  if (disabled != null && disabled !== user.disabled) {
    if (disabled && !anyAdmin((x) => x.principal === `user:${user.name}`) && bindings.some((x) => x.principal === `user:${user.name}` && x.role === "admin")) {
      return lastAdmin(user.name);
    }
    user.disabled = disabled;
    changed({ at, principal: by, action: disabled ? "user.disable" : "user.enable", repo: "", subject: `user:${user.name}`, digest: null, ip: DEMO_IP, details: { name: user.name, source: "api" } });
  }
  if (name != null) {
    const bad = nameRefusal(name);
    if (bad) return bad;
    if (name !== user.name) {
      if (users.some((u) => u.name === name)) return conflict(`user ${name} already exists`);
      const from = user.name;
      renameUser(user, name);
      changed({ at, principal: by, action: "user.rename", repo: "", subject: `user:${name}`, digest: null, ip: DEMO_IP, details: { from, name, source: "api" } });
    }
  }
  return user;
}

/** POST /api/v1/users/{user}/password. */
export function setPassword(user: User, body: unknown, by: string): Refusal | null {
  const refused = bodyRefusal(body, ["password"]);
  if (refused) return refused;
  const password = str((body as Record<string, unknown>).password);
  const bad = passwordRefusal(password);
  if (bad) return bad;
  passwords.set(user.name, sha256Hex(password));
  changed({ at: new Date().toISOString(), principal: by, action: "user.password", repo: "", subject: `user:${user.name}`, digest: null, ip: DEMO_IP, details: { name: user.name, source: "api" } });
  return null;
}

/** DELETE /api/v1/users/{user}: its live tokens revoked, its bindings deleted, the row kept as
 * ~<uid> and the name free at once. Not the last enabled user with an admin binding. */
export function deleteUser(user: User, by: string): Refusal | null {
  const own = (b: MockBinding) => b.principal === `user:${user.name}`;
  if (bindings.some((b) => own(b) && b.role === "admin") && !anyAdmin(own)) return lastAdmin(user.name);
  const now = new Date().toISOString();
  let tokensRevoked = 0;
  for (const t of tokens) {
    if (t.kind !== "pat" || t.user !== user.name) continue;
    if (t.revokedAt === null) {
      t.revokedAt = now;
      tokensRevoked++;
    }
    t.user = `~${user.uid}`;
  }
  const bindingsDeleted = bindings.filter(own).length;
  for (let i = bindings.length - 1; i >= 0; i--) if (own(bindings[i]!)) bindings.splice(i, 1);
  users.splice(users.indexOf(user), 1);
  deletedUsers.push({ ...user, disabled: true, name: `~${user.uid}`, deletedName: user.name });
  formerUids.set(user.name, user.uid);
  passwords.delete(user.name);
  changed({ at: now, principal: by, action: "user.delete", repo: "", subject: `user:${user.name}`, digest: null, ip: DEMO_IP, details: { name: user.name, tokensRevoked, bindingsDeleted, source: "api" } });
  return null;
}

/** A principal that a binding may name, `user:<name or uid>` or `group:<name>`, or why it cannot
 * be bound (bindable of the server). Whether the user exists is asked last. */
function bindable(principal: string): Refusal | null {
  const cannot = () =>
    invalid(`principal: ${principal} cannot be bound: a binding is for user:<name> or group:<name>; anonymous reads through a repo's anonymousRead, a deploy token gets its repo and scopes`);
  if (principal === "anonymous") return cannot();
  const i = principal.indexOf(":");
  const [kind, name] = i < 0 ? [principal, ""] : [principal.slice(0, i), principal.slice(i + 1)];
  if (name === "") return invalid(`principal: "${principal}": want <kind>:<name> or anonymous`);
  if (kind === "user") return null;
  if (kind === "group") {
    if (bytes(name) > 256) return invalid("principal: a group name is at most 256 bytes");
    if (/\p{C}/u.test(name)) return invalid("principal: a group name is printable UTF-8");
    if (name.trim() !== name) return invalid("principal: a group name has no space at either end");
    return null;
  }
  if (kind === "token") return /^\d+$/.test(name) ? cannot() : invalid(`principal: "${principal}": token id must be decimal`);
  if (kind === "anonymous") return invalid(`principal: "${principal}": anonymous takes no name`);
  return invalid(`principal: "${principal}": unknown kind "${kind}"`);
}

/** POST /api/v1/bindings. A user's binding names it by its name or its uid, and counts for the
 * user whatever its name later; a group need not have members. */
export function createBinding(body: unknown, by: string): Binding | Refusal {
  const refused = bodyRefusal(body, ["principal", "role", "repoMask"]);
  if (refused) return refused;
  const b = body as Record<string, unknown>;
  const sent = str(b.principal);
  const role = str(b.role);
  const repoMask = str(b.repoMask);
  const bad = bindable(sent) ?? (Object.hasOwn(roleActions, role) ? null : invalid(`role: "${role}" is not reader, writer, maintainer or admin`)) ?? maskRefusal(repoMask);
  if (bad) return bad;
  if (role === "admin" && repoMask !== "*/*") return invalid("repoMask: an admin binding is on */*: the admin role is every repo and the system");
  // Stored by the user's name inside the mock; the API answers its uid.
  let principal = sent;
  if (sent.startsWith("user:")) {
    const user = userByRef(sent.slice(5));
    if (!user) return invalid(`principal: user ${sent.slice(5)} does not exist`);
    principal = `user:${user.name}`;
  }
  if (bindings.some((x) => x.principal === principal && x.role === role && x.repoMask === repoMask)) {
    return conflict(`binding ${sent} ${role} on ${repoMask} exists already`);
  }
  const row: MockBinding = { id: nextBindingId++, principal, role: role as MockBinding["role"], repoMask, createdAt: new Date().toISOString() };
  bindings.push(row);
  changed({ at: row.createdAt, principal: by, action: "binding.create", repo: "", subject: principal, digest: null, ip: DEMO_IP, details: { id: row.id, role, repoMask, source: "api" } });
  return bindingJson(row);
}

/** DELETE /api/v1/bindings/{id}: not the last admin binding of an enabled user. */
export function deleteBinding(idText: string, by: string): Refusal | null {
  const id = /^\d+$/.test(idText) ? Number(idText) : 0;
  if (!Number.isSafeInteger(id) || id < 1) return invalid(`id: "${idText}" is not the id of a binding`);
  const i = bindings.findIndex((b) => b.id === id);
  if (i < 0) return notFound(`binding ${id} does not exist`);
  const row = bindings[i]!;
  const holder = users.find((u) => row.principal === `user:${u.name}`);
  if (row.role === "admin" && holder && !holder.disabled && !anyAdmin((b) => b.id === id)) {
    return conflict(`binding ${id} is the last admin binding of an enabled user: create another first (lajstrom admin binding create, or admin user create --admin)`);
  }
  bindings.splice(i, 1);
  changed({ at: new Date().toISOString(), principal: by, action: "binding.delete", repo: "", subject: row.principal, digest: null, ip: DEMO_IP, details: { id, role: row.role, repoMask: row.repoMask, source: "api" } });
  return null;
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
    ...kindOf(seed),
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
    reindex: demoReindexState(keyOf(seed)) ?? {
      state: seed.reindex,
      startedAt: running ? before(0, 0, 0.3) : before(0, 0, 21),
      finishedAt: running ? null : before(0, 0, 20),
      errors: 0,
      nextReconcileAt: running ? null : ahead(0, 0, 39),
    },
    ...(seed.signingKeys ? { signingKeys: seed.signingKeys } : {}),
  };
}

/** What a proxy or a group has instead of a hosted repo's fields (docs/api.md, The resource): a
 * proxy every key of its upstream, a group its members with merge, or with paths on oci, and
 * neither registry nor policy. */
function kindOf(seed: RepoSeed): Partial<Repo> {
  if (seed.kind === "proxy" && seed.upstream) {
    return { kind: "proxy", upstream: { metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: [], ...seed.upstream } };
  }
  if (seed.kind === "group" && seed.group) {
    const { members, merge, paths } = seed.group;
    return {
      kind: "group",
      registry: undefined,
      policy: undefined,
      group: seed.format === "oci" ? { members, paths: paths ?? {} } : { members, merge: merge ?? [] },
    };
  }
  return {};
}

/** The groups that have the repo as a member, as <format>/<name>. */
export function groupsOf(repo: { format: string; name: string }): string[] {
  return repoSeeds.filter((s) => s.kind === "group" && s.format === repo.format && s.group?.members.includes(repo.name)).map(keyOf);
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
  // npm: the description of the version document.
  const manifest = m.manifest as Record<string, unknown> | undefined;
  if (typeof manifest?.description === "string") return manifest.description;
  const control = m.control as Record<string, string> | undefined;
  if (control?.Description) return control.Description;
  const pom = m.pom as Record<string, string> | undefined;
  if (pom?.description) return pom.description;
  if (pom?.name) return pom.name;
  if (typeof m.contentType === "string") return m.contentType;
  return null;
}

/** A package with every proposed fact, as the mock answers it. */
type Summary = Omit<PackageDetail, "ociRepository" | "latestMetadata">;

function summarize(name: string, list: Row[]): Summary {
  // npm: the version the dist-tag latest names, which npm installs; else the newest.
  const latest = latestTagged(list) ?? list[0]!;
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
    updatedAt: list[0]!.createdAt,
  };
}

export type PackageQuery = {
  prefix?: string;
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

export function listPackages(repo: Repo, query: PackageQuery): PackageList {
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

  if (query.prefix) rows = rows.filter(({ summary }) => summary.name.startsWith(query.prefix!));
  const q = query.q?.trim().toLowerCase();
  if (q) rows = rows.filter(({ summary }) => summary.name.toLowerCase().includes(q) || summary.summary?.toLowerCase().includes(q));
  for (const f of query.attr ?? []) {
    const i = f.indexOf(":");
    const k = f.slice(0, i);
    const val = f.slice(i + 1);
    rows = rows.filter(({ list }) => list.some((v) => v.attrs[k] === val));
  }

  let directories: RawDirectory[] | undefined;
  if (repo.format === "raw" && query.dir !== undefined && query.dir !== null && !q && !query.prefix) {
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
  const cmp: Record<string, (a: Summary, b: Summary) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    versions: (a, b) => a.versions - b.versions,
    size: (a, b) => a.size - b.size,
  };
  const defaultSign = sort === "name" ? 1 : -1;
  const by = cmp[sort] ?? cmp.name!;
  rows.sort((a, b) => by(a.summary, b.summary) * (dirSign ?? defaultSign));

  const { page, next } = paginate(rows, query.limit ?? 100, query.cursor);
  return { packages: page.map((r) => r.summary), next: next ?? undefined, facets, ...(directories ? { directories } : {}) };
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
    latestMetadata: (latestTagged(list) ?? list[0]!).metadata,
  };
}

/** The manifest's lajstrom.* annotations by their full key, as the server's attrs. */
function lajstromAttrs(v: Row): Record<string, string> {
  return Object.fromEntries(Object.entries(v.annotations).filter(([k]) => k.startsWith("lajstrom.")));
}

/** A package's manifests grouped by version, newest first (docs/api.md, List versions). */
function byVersion(list: Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const v of list) groups.set(v.version, [...(groups.get(v.version) ?? []), v]);
  return [...groups.values()]
    .map((g) => [...g].sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    .sort((a, b) => b[0]!.createdAt.localeCompare(a[0]!.createdAt) || b[0]!.version.localeCompare(a[0]!.version));
}

/** The fields every version answer shares: the first variant's publish time orders, the
 * newest one's is lastModified; the pointers are npm's dist-tags that name it. */
function versionHead(rows: Row[]) {
  return { version: rows[0]!.version, publishedAt: rows[0]!.createdAt, lastModified: rows.at(-1)!.createdAt, pointers: pointersOf(rows[0]!) };
}

export function listVersions(repo: Repo, name: string): VersionSummary[] | null {
  const list = manifestsOf(repo, name);
  if (!list) return null;
  return byVersion(list).map((rows) => ({
    ...versionHead(rows),
    ...yankOf(repo, name, rows[0]!.version),
    variants: rows.map((v) => ({
      variant: v.variant,
      tag: v.tag,
      digest: v.digest,
      publishedAt: v.createdAt,
      artifactType: v.artifactType,
      attrs: lajstromAttrs(v),
      size: v.size,
      fileCount: v.fileCount,
      degraded: v.degraded,
      referrers: v.referrers,
    })),
  }));
}

function variantDetail(v: Row): VariantDetail {
  return {
    variant: v.variant,
    tag: v.tag,
    digest: v.digest,
    publishedAt: v.createdAt,
    artifactType: v.artifactType,
    attrs: lajstromAttrs(v),
    metadata: v.metadata,
    degraded: v.degraded,
    indexedAt: v.indexedAt,
    files: v.files,
    annotations: v.annotations,
    manifest: v.manifest,
  };
}

/** GET …/versions/{version}[?variant=]: 404 (null) for a version or a variant that is not there. */
export function getVersion(repo: Repo, name: string, version: string, variant: string | null): VersionDetail | null {
  const rows = manifestsOf(repo, name)?.filter((m) => m.version === version);
  if (!rows?.length) return null;
  const sorted = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const shown = variant === null ? sorted : sorted.filter((v) => v.variant === variant);
  if (!shown.length) return null;
  return {
    ...versionHead(sorted),
    ...yankOf(repo, name, version),
    variants: shown.map(variantDetail),
    ociRepository: `${repo.format}/${repo.name}/${packagePath(repo.format, name)}`,
  };
}

const attachmentKind: Record<string, Attachment["kind"]> = {
  "application/vnd.dev.cosign.artifact.sig.v1+json": "signature",
  "application/vnd.cncf.notary.signature": "signature",
  "application/spdx+json": "sbom",
  "application/vnd.cyclonedx+json": "sbom",
};

/** GET …/versions/{version}/attachments: the referrers of its variants as the index labels
 * them (docs/api.md, Attachments of a version). Keyless and notation signatures are
 * unsupported, the SBOMs unsigned, the provenance signed by the demo's trusted key. */
export function listAttachments(repo: Repo, name: string, version: string, variant: string | null): AttachmentList | null {
  const rows = manifestsOf(repo, name)?.filter((m) => m.version === version && (variant === null || m.variant === variant));
  if (!rows?.length) return null;
  const attachments: Attachment[] = rows.flatMap((v) =>
    v.referrerList.map((r) => {
      const predicateType = r.annotations["in-toto.io/predicate-type"] ?? "";
      const kind = predicateType.startsWith("https://slsa.dev/provenance") ? "provenance" : (attachmentKind[r.artifactType] ?? "other");
      const verification: Attachment["verification"] = kind === "signature" ? "unsupported" : kind === "provenance" ? "verified" : "unsigned";
      return {
        variant: v.variant,
        subject: v.digest,
        digest: r.digest,
        layer: `sha256:${sha256Hex(`layer:${r.digest}`)}`,
        mediaType: kind === "provenance" ? "application/vnd.dsse.envelope.v1+json" : r.artifactType,
        artifactType: r.artifactType,
        kind,
        predicateType,
        size: r.size,
        annotations: r.annotations,
        ...(r.tool ? { tool: r.tool } : {}),
        verification,
        ...(verification === "verified" ? { signedBy: "release-key" } : {}),
        ...(verification === "unsupported" ? { reason: r.tool === "notation" ? "a notation signature" : "a keyless signature" } : {}),
        ...(r.createdAt ? { createdAt: r.createdAt } : {}),
        indexedAt: v.indexedAt,
      };
    }),
  );
  attachments.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return { attachments, truncated: false };
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

/** The repo's part of a run's report. prune removes the rows of manifests gone from the registry;
 * verify, on a registry without the referrers API, pushes again the referrers indexes that
 * lack referrers (docs/operations.md, What a run does). */
function reindexReport(repo: MockRepo, run: { prune: boolean; verify: boolean } = { prune: true, verify: false }): ReindexReport {
  const pkgs = byRepo.get(repo.prefix) ?? new Map<string, Row[]>();
  const found = reindexFindings(repo.prefix, pkgs);
  // The rows of an OCI repository the registry does not know were not seen.
  const unknown = new Set(found.repositoryUnknown.map((u) => u.digest));
  const manifests = [...pkgs.values()].flat().filter((v) => !unknown.has(v.digest));
  const foreign: NonNullable<ReindexReport["foreign"]> = [];
  let removed = 0;
  if (repo.prefix === "raw/assets") {
    foreign.push({
      repository: "charts/podinfo",
      tag: "6.7.1",
      digest: `sha256:${sha256Hex("foreign:podinfo")}`,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
    });
  }
  if (repo.prefix === "raw/scratch") {
    foreign.push({
      repository: "tmp/debug-image",
      tag: "latest",
      digest: `sha256:${sha256Hex("foreign:debug-image")}`,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
    });
    removed = run.prune ? 1 : 0;
  }
  foreign.push(...found.foreign);
  // The run read the tags of the rows and those its lists name. It reads a degraded row again
  // and writes it (updated), and sees a drifted one under another digest (not unchanged).
  const tagged = [...foreign, ...found.orphanReferrers, ...found.orphanJournal, ...found.errors];
  const repositories = new Set([
    ...manifests.map((v) => packagePath(repo.format, v.packageName)),
    ...tagged.map((f) => f.repository).filter(Boolean),
    ...found.split.map((s) => s.other),
  ]);
  const degraded = manifests.filter((v) => v.degraded).length;
  const attachments = manifests.reduce((n, v) => n + v.referrers.signatures + v.referrers.sboms + v.referrers.attestations, 0);
  const noReferrersApi = registries.find((r) => r.name === repo.registry)?.capabilities.referrers === false;
  const repairedReferrers: NonNullable<ReindexReport["repairedReferrers"]> =
    run.verify && noReferrersApi
      ? manifests.slice(0, 2).map((v) => ({
          repository: packagePath(v.format, v.packageName),
          subject: v.digest,
          index: `sha256:${sha256Hex(`referrers-index:${v.digest}`)}`,
          added: [`sha256:${sha256Hex(`signature:${v.digest}`)}`],
        }))
      : [];
  return {
    repo: repo.prefix,
    ociRepositories: repositories.size,
    manifests: manifests.length + tagged.filter((f) => f.tag).length + found.split.reduce((n, s) => n + s.otherTags.length, 0),
    added: 0,
    updated: degraded,
    unchanged: manifests.length - degraded - found.drift.length,
    removed,
    pending: 0,
    deletedPending: 0,
    degraded,
    referrers: attachments + found.orphanReferrers.length,
    attachments,
    foreign,
    orphanReferrers: found.orphanReferrers,
    orphanJournal: found.orphanJournal,
    drift: found.drift,
    split: found.split,
    repositoryUnknown: found.repositoryUnknown,
    repairedReferrers,
    errors: found.errors,
    truncated: false,
  };
}

/** Runs started in the demo, by repo; each takes a few seconds. */
type DemoRun = { id: number; startedAt: number; principal: string; prune: boolean; verify: boolean };
const demoRuns = new Map<string, DemoRun>();
let nextRunId = 40;
const RUN_SECONDS = 4;

keep("reindex", {
  save: () => ({ runs: [...demoRuns], nextRunId }),
  load: (data) => {
    const d = data as { runs?: [string, DemoRun][]; nextRunId?: number };
    for (const [k, run] of d.runs ?? []) demoRuns.set(k, run);
    nextRunId = Math.max(nextRunId, d.nextRunId ?? 0);
  },
});

/** The repo's reindex state (proposed) while a run of the demo covers it. */
function demoReindexState(key: string): MockRepo["reindex"] | null {
  const run = demoRuns.get(key);
  if (!run) return null;
  const running = Date.now() - run.startedAt < RUN_SECONDS * 1000;
  return {
    state: running ? "running" : "idle",
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: running ? null : new Date(run.startedAt + RUN_SECONDS * 1000).toISOString(),
    errors: 0,
    nextReconcileAt: ahead(0, 0, 39),
  };
}

/** GET …/reindex: the latest run that covered the repo, or null when none has: a repo created
 * since the reconcile loop's last run, and a group, which the loop passes by. The seed's runs
 * are the reconcile loop's; one that is running has no report yet, as on the server. */
export function reindexRun(repo: MockRepo): ReindexRun | null {
  const demo = demoRuns.get(repo.prefix);
  if (!demo && (repo.kind === "group" || repo.createdAt > before(0, 0, 21))) return null;
  if (demo) {
    const running = Date.now() - demo.startedAt < RUN_SECONDS * 1000;
    const finished = new Date(demo.startedAt + RUN_SECONDS * 1000).toISOString();
    return {
      id: demo.id,
      state: running ? "running" : "done",
      source: "api",
      principal: apiPrincipal(demo.principal),
      replica: "lajstrom-0 1",
      allRepos: false,
      prune: demo.prune,
      verify: demo.verify,
      startedAt: new Date(demo.startedAt).toISOString(),
      heartbeatAt: running ? new Date().toISOString() : finished,
      finishedAt: running ? null : finished,
      report: running ? null : reindexReport(repo, demo),
    };
  }
  const state = repo.reindex.state === "running" ? "running" : repo.reindex.state === "failed" ? "failed" : "done";
  return {
    id: 31,
    state,
    source: "reconcile",
    principal: "anonymous",
    replica: "lajstrom-0 1",
    allRepos: true,
    prune: true,
    verify: false,
    startedAt: repo.reindex.startedAt ?? before(0, 0, 21),
    heartbeatAt: repo.reindex.finishedAt ?? before(0, 0, 0.1),
    finishedAt: repo.reindex.finishedAt,
    error: state === "failed" ? "the registry answered 503 to the tag list of the repo's first OCI repository" : undefined,
    report: state === "running" ? null : reindexReport(repo),
  };
}

/** POST …/reindex: a run of the repo, refused while one runs (409). */
export function startReindex(repo: MockRepo, body: unknown, by: string): ReindexRun | Refusal {
  // An overlapping run is named: where it runs and since when (docs/api.md, Reindex).
  const current = reindexRun(repo);
  if (current?.state === "running") {
    return { status: 409, code: "CONFLICT", message: `a reindex of ${current.allRepos ? "every repo" : repo.prefix} runs on ${current.replica} since ${current.startedAt}` };
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== "object" || Array.isArray(b)) return invalid("the body must be a JSON object");
  const unknown = Object.keys(b).find((k) => k !== "prune" && k !== "verify");
  if (unknown) return invalid(`${unknown}: not a field of a reindex request`);
  demoRuns.set(repo.prefix, { id: ++nextRunId, startedAt: Date.now(), principal: by, prune: b.prune === true, verify: b.verify === true });
  changed({ at: new Date().toISOString(), principal: by, action: "repo.reindex", repo: repo.prefix, subject: repo.prefix, digest: null, ip: DEMO_IP, details: { prune: b.prune === true, verify: b.verify === true, source: "api" } });
  return reindexRun(repo)!;
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

/** An audit row as the mock keeps it: users by name, empty fields as "" and null. The API
 * answers it as an AuditEvent (auditJson). */
type MockEvent = {
  at: string;
  principal: string;
  action: string;
  repo: string;
  subject: string;
  digest: string | null;
  ip: string;
  details: Record<string, unknown>;
  state?: AuditEvent["state"];
  error?: string;
};

function auditLog(): (MockEvent & { id: number })[] {
  const events: MockEvent[] = [];
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
  for (const u of seedUsers.filter((u) => u.name !== "admin")) {
    events.push({ at: u.createdAt, principal: "user:admin", action: "user.create", repo: "", subject: `user:${u.name}`, digest: null, ip: ipOf["user:admin"]!, details: {} });
  }
  for (const b of seedBindings.filter((b) => b.id !== 1)) {
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
    {
      at: ago(0, 7),
      principal: "user:bob",
      action: "push",
      repo: "raw/scratch",
      subject: "tmp/heapdump-2026-11-05.hprof",
      digest: `sha256:${sha256Hex("failed:heapdump")}`,
      ip: ipOf["user:bob"]!,
      details: { client: "curl/8.5.0" },
      state: "failed",
      error: "the registry refused the blob: 413 Request Entity Too Large",
    },
  );
  events.push(...demoEvents);
  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.map((e, i) => ({ id: events.length - i, ...e }));
}

/** The audit log, computed again after a change in the demo. */
let auditCache: (MockEvent & { id: number })[] | null = null;
const audit = () => (auditCache ??= auditLog());

/** A row as the API answers it: canonical principals, empty fields left out. */
function auditJson(e: MockEvent & { id: number }): AuditEvent {
  return {
    id: e.id,
    at: e.at,
    principal: apiPrincipal(e.principal),
    principalName: e.principal.startsWith("user:") ? nameFor(e.principal.slice(5)) : undefined,
    action: e.action,
    repo: e.repo || undefined,
    subject: e.subject ? apiPrincipal(e.subject) : undefined,
    digest: e.digest ?? undefined,
    ip: e.ip || undefined,
    details: Object.keys(e.details).length ? e.details : undefined,
    state: e.state ?? "ok",
    error: e.error,
  };
}

export type AuditQuery = {
  repo?: string;
  principal?: string;
  action?: string;
  state?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
};

export function listAudit(q: AuditQuery): AuditList {
  let rows = audit();
  if (q.repo) rows = rows.filter((e) => e.repo === q.repo);
  if (q.principal) {
    const of = mockPrincipal(q.principal);
    rows = rows.filter((e) => e.principal === of);
  }
  if (q.action) rows = rows.filter((e) => e.action === q.action);
  if (q.state) rows = rows.filter((e) => (e.state ?? "ok") === q.state);
  if (q.since) rows = rows.filter((e) => e.at >= q.since!);
  if (q.until) rows = rows.filter((e) => e.at < q.until!);
  const { page, next } = paginate(rows, q.limit ?? 100, q.cursor);
  return { events: page.map(auditJson), next: next ?? undefined };
}


// --- Changes made in the demo ---------------------------------------------------------------
// What the API lets a caller of the demo change in repos: create, change and delete them, with
// the server's rules (docs/api.md, Repos), from the repo pages and from the API docs of the
// demo. Every change is an audit event and is kept by src/mocks/state.ts, so
// that a reload replays it.

/** Repos of the seed deleted in the demo: their seeded versions go when it reloads. */
const deletedRepos = new Set<string>();
/** Audit events of changes the data does not show by itself: updates and deletes. */
const demoEvents: MockEvent[] = [];

const DEMO_IP = "192.0.2.10";

function changed(event?: MockEvent): void {
  if (event) demoEvents.push(event);
  auditCache = null;
  persist();
}

/** The audit row of a change that another part of the mock makes, such as a webhook's
 * (src/mocks/webhooks.ts): now, from the demo's address. */
export function audited(event: Pick<MockEvent, "principal" | "action" | "repo" | "subject" | "details">): void {
  changed({ ...event, at: new Date().toISOString(), digest: null, ip: DEMO_IP });
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

/** The yanks of pypi versions, by yankKey: the reason, "" for none. A deleted version keeps its
 * yank, as on the server. */
const yanks = new Map<string, string>();
const yankKey = (repo: Repo, name: string, version: string) => `${keyOf(repo)} ${name} ${version}`;

function yankOf(repo: Repo, name: string, version: string): { yanked?: Yank } {
  const reason = yanks.get(yankKey(repo, name, version));
  return reason === undefined ? {} : { yanked: { reason } };
}

/** Manifests of the seed deleted in the demo, by digest: they go again when it reloads. */
const deletedManifests = new Set<string>();

function dropManifest(digest: string): void {
  removeRows((v) => v.digest === digest);
  for (const pkgs of byRepo.values()) {
    for (const [name, list] of pkgs) {
      const i = list.findIndex((v) => v.digest === digest);
      if (i === -1) continue;
      list.splice(i, 1);
      if (!list.length) pkgs.delete(name);
    }
  }
}

keep("db", {
  save: () => ({ repos: repoSeeds, deletedRepos: [...deletedRepos], events: demoEvents, deletedManifests: [...deletedManifests], yanks: [...yanks] }),
  load: (data) => {
    const d = data as { repos?: RepoSeed[]; deletedRepos?: string[]; events?: MockEvent[]; deletedManifests?: string[]; yanks?: [string, string][] };
    if (!Array.isArray(d.repos)) return;
    // Repos the seed has gained since the state was kept join it, but for those deleted since.
    const added = repoSeeds.filter((s) => !d.repos!.some((r) => keyOf(r) === keyOf(s)) && !d.deletedRepos?.includes(keyOf(s)));
    repoSeeds.splice(0, repoSeeds.length, ...d.repos, ...added);
    for (const k of d.deletedRepos ?? []) {
      deletedRepos.add(k);
      dropRepoData(k);
    }
    for (const digest of d.deletedManifests ?? []) {
      deletedManifests.add(digest);
      dropManifest(digest);
    }
    for (const [k, reason] of d.yanks ?? []) yanks.set(k, reason);
    demoEvents.push(...(d.events ?? []));
    auditCache = null;
  },
});

// --- The first admin ------------------------------------------------------------------------
// The admin made with the bootstrap token (POST /api/v1/bootstrap, src/mocks/bootstrap.ts): a
// local user with its password and the binding (user:<uid>, admin, */*), made together, and one
// user.create event by anonymous with the source bootstrap (docs/auth.md, Bootstrap), not one
// derived from the seed (auditLog). Kept with the users and the events of the demo.

type MockUser = (typeof users)[number];

/** Makes the first admin called name; the caller has checked the name, that it is free, and the
 * password. */
export function makeFirstAdmin(name: string, password: string): MockUser {
  const at = new Date().toISOString();
  // A fresh uid, as createUser makes: a user deleted in the demo may have had the name.
  const user: MockUser = { uid: uidOf(`${name} ${at}`), name, kind: "local", disabled: false, createdAt: at };
  users.push(user);
  bindings.push({ id: nextBindingId++, principal: `user:${name}`, role: "admin", repoMask: "*/*", createdAt: at });
  passwords.set(name, sha256Hex(password));
  changed({ at, principal: "anonymous", action: "user.create", repo: "", subject: `user:${name}`, digest: null, ip: DEMO_IP, details: { admin: true, name, source: "bootstrap" } });
  return user;
}

/** A refusal the handler answers: the status, and the message of the server's error. */
export type Refusal = { status: number; code: string; message: string };

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

/** Repo names: lowercase letters and digits separated by single '.', '_' or '-' (manifest-profile.md §4.1). */
const REPO_NAME = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
/** The formats of the server: its plugins' (GET /api/v1/info) and oci, which needs none. */
const FORMATS: string[] = [...serverInfo.formats.map((f) => f.name), "oci"];

/** Why a repo mask is not one (rbac.md §3: <format>/<repo>, * for a whole segment); null when it is. */
export function maskRefusal(mask: unknown): Refusal | null {
  const [format, repo, ...rest] = typeof mask === "string" ? mask.split("/") : [];
  if (format === undefined || repo === undefined || rest.length) return invalid("repoMask: <format>/<repo>, * for a whole segment, such as oci/* or */talos");
  if (format !== "*" && !FORMATS.includes(format)) return invalid(`repoMask: ${format} is not a format of this server (${FORMATS.join(", ")})`);
  if (repo !== "*" && !REPO_NAME.test(repo)) return invalid(`repoMask: ${repo} is not a repo name`);
  return null;
}
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The keys of a policy (Policy in the server's openapi.yaml); a merge patch may also set any of
 * them to null, which removes it. */
function checkPolicy(policy: unknown, format: string, patch: boolean): Refusal | null {
  if (policy === null || policy === undefined) return null;
  if (!isObject(policy)) return invalid("policy: a JSON object or null");
  for (const [k, v] of Object.entries(policy)) {
    if (v === null && patch) continue;
    if (k === "maxFileSize") {
      if (!Number.isInteger(v) || (v as number) < 1) return invalid("policy.maxFileSize: a number of bytes, at least 1");
    } else if (k === "blobRedirect") {
      if (v !== "auto" && v !== "never") return invalid("policy.blobRedirect: auto or never");
    } else if (k === "maven" && format === "maven") {
      if (!isObject(v)) return invalid("policy.maven: a JSON object");
      const unknown = Object.keys(v).find((mk) => !["sessionTimeout", "maxSessionFiles", "versionPolicy"].includes(mk));
      if (unknown) return invalid(`policy.maven.${unknown} is not a policy key`);
      // The ranges of docs/api.md, Policy.
      const { sessionTimeout: t, maxSessionFiles: n, versionPolicy: vp } = v;
      const seconds = typeof t === "string" ? durationSeconds(t) : null;
      if (t !== undefined && !(t === null && patch) && (seconds === null || seconds < 60 || seconds > 86400)) {
        return invalid(`policy.maven.sessionTimeout: "${String(t)}" is not a duration from 1m to 24h`);
      }
      if (n !== undefined && !(n === null && patch) && (!Number.isInteger(n) || (n as number) < 1 || (n as number) > 999)) {
        return invalid("policy.maven.maxSessionFiles: an integer from 1 to 999");
      }
      if (vp !== undefined && !(vp === null && patch) && vp !== "release" && vp !== "snapshot") return invalid("policy.maven.versionPolicy: release or snapshot");
    } else if (k === "maven") return invalid("policy.maven: a maven repo only");
    else return invalid(`policy.${k} is not a policy key`);
  }
  return null;
}

/** An RFC 7396 merge patch of a policy: null removes a key, maven merges key by key. */
function mergePolicy(current: RepoPolicy | null, patch: Record<string, unknown> | null): RepoPolicy | null {
  if (patch === null) return null;
  const out: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (k === "maven" && isObject(v)) {
      const maven: Record<string, unknown> = { ...(isObject(out.maven) ? out.maven : {}) };
      for (const [mk, mv] of Object.entries(v)) {
        if (mv === null) delete maven[mk];
        else maven[mk] = mv;
      }
      if (Object.keys(maven).length) out.maven = maven;
      else delete out.maven;
    } else out[k] = v;
  }
  return Object.keys(out).length ? (out as RepoPolicy) : null;
}

export function versionCount(repoKey: string): number {
  return [...(byRepo.get(repoKey)?.values() ?? [])].reduce((n, list) => n + list.length, 0);
}

const forbidden = (message: string): Refusal => ({ status: 403, code: "FORBIDDEN", message });

/** Names a registry's storage or routes keep for themselves (docs/api.md, Repos; ADR 0017). */
const reservedName = (name: string) => /(blobs|\.uploads|\.sync)$/.test(name) || ["index.json", "oci-layout", "manifests", "referrers", "tags"].includes(name);

/** The formats whose repos may be proxies and groups in the demo: oci, which needs no plugin. npm,
 * the one plugin that has them (proxy-and-group.md §1), has hosted repos only here: the mock
 * prefetches images, not names. */
const KINDED_FORMATS = ["oci"];

/** POST /api/v1/repos: the admin creates a repo (docs/api.md, Repos): hosted, a proxy of an
 * upstream of the configuration, or a group of repos of its format (proxy-and-group.md §2). */
export function createRepo(body: unknown, by: string): MockRepo | Refusal {
  if (!isObject(body)) return invalid("the body must be a JSON object");
  const b = body;
  const known = ["format", "name", "registry", "kind", "anonymousRead", "policy", "upstream", "group"];
  const unknown = Object.keys(b).find((k) => !known.includes(k));
  if (unknown) return invalid(`${unknown}: not a field of a repo`);
  if (typeof b.format !== "string" || !FORMATS.includes(b.format)) return invalid(`format: one of ${FORMATS.join(", ")}`);
  const format = b.format as RepoSeed["format"];
  if (typeof b.name !== "string" || b.name.length > 64 || !REPO_NAME.test(b.name)) {
    return invalid(`name: "${String(b.name ?? "")}" must be lowercase letters and digits separated by single '.', '_' or '-', at most 64 characters`);
  }
  if (reservedName(b.name)) return invalid(`name: "${b.name}" is kept by registries: no name ends in blobs, .uploads or .sync, or is index.json, oci-layout, manifests, referrers or tags`);
  const kind = b.kind ?? "hosted";
  if (kind !== "hosted" && kind !== "proxy" && kind !== "group") return invalid(`kind: "${String(kind)}" is not hosted, proxy or group`);
  if (kind !== "hosted" && !KINDED_FORMATS.includes(format)) return invalid(`kind: format ${format} has no ${kind} repos`);
  if (kind === "group") {
    if (b.registry !== undefined) return invalid("registry: a group has none: it stores nothing");
    if (b.policy !== undefined && b.policy !== null) return invalid("policy: a group has none; each member keeps its own");
  } else if (typeof b.registry !== "string" || !registries.some((r) => r.name === b.registry)) {
    return invalid(`registry: one of ${registries.map((r) => r.name).join(", ")}`);
  }
  if (b.anonymousRead !== undefined && typeof b.anonymousRead !== "boolean") return invalid("anonymousRead: true or false");
  const policyError = checkPolicy(b.policy, format, false);
  if (policyError) return policyError;
  if (kind === "proxy") {
    if (b.upstream === undefined || b.upstream === null) return invalid("upstream: a proxy repo needs one, by the name the configuration gives it");
    const refused = upstreamRefusal(b.upstream, format, upstreams);
    if (refused) return refused;
  } else if (b.upstream !== undefined && b.upstream !== null) return invalid("upstream: only a proxy repo has one");
  if (kind === "group") {
    if (b.group === undefined || b.group === null) return invalid("group: a group needs its members");
    const refused = groupRefusal(b.group, format, b.name, repoSeeds);
    if (refused) return refused;
  } else if (b.group !== undefined && b.group !== null) return invalid("group: only a group has one");
  const key = `${format}/${b.name}`;
  if (repoSeeds.some((s) => keyOf(s) === key)) return { status: 409, code: "CONFLICT", message: `repo ${key} exists` };

  const now = new Date().toISOString();
  const seed: RepoSeed = {
    format,
    name: b.name,
    ...(kind === "group" ? {} : { registry: b.registry as string }),
    anonymousRead: b.anonymousRead === true,
    policy: kind === "group" ? null : ((b.policy as RepoSeed["policy"]) ?? null),
    createdAt: now,
    updatedAt: now,
    reindex: "idle",
    ...(kind === "hosted" ? {} : { kind }),
    ...(kind === "proxy" ? { upstream: b.upstream as Upstream } : {}),
    ...(kind === "group" ? { group: b.group as RepoGroup } : {}),
  };
  repoSeeds.push(seed);
  // A new repo starts empty, even where one of the same name was deleted.
  dropRepoData(key);
  changed();
  return repoOf(seed, by.replace(/^user:/, ""));
}

/** A group's paths in one spelling, whatever the order of its keys. */
const pathsKey = (paths: RepoGroup["paths"]) => JSON.stringify(Object.entries(paths ?? {}).sort(([a], [b]) => a.localeCompare(b)));

/** PATCH /api/v1/repos/{format}/{repo}: anonymousRead and policy; a proxy's upstream and a
 * group's settings, merged and checked whole; the admin role for another upstream.name, other
 * members or other paths (docs/api.md, Change). {"kind": "hosted"} alone turns a proxy of a
 * format that can adopt its documents into a hosted repo: none of the mock's can. */
export function updateRepo(repo: MockRepo, body: unknown, by: string): MockRepo | Refusal {
  if (!isObject(body)) return invalid("the body must be a JSON object");
  const b = body;
  const me = by.replace(/^user:/, "");
  const admin = isAdmin(me);
  for (const k of Object.keys(b)) {
    if (["format", "name", "registry"].includes(k)) return invalid(`${k}: cannot change`);
    if (!["anonymousRead", "policy", "upstream", "group", "kind"].includes(k)) return invalid(`${k}: not a field of a repo`);
  }
  const seed = repoSeeds.find((s) => keyOf(s) === repo.prefix)!;
  const kind = seed.kind ?? "hosted";
  if ("kind" in b) {
    if (Object.keys(b).length > 1) return invalid("kind: alone in the body");
    if (b.kind !== "hosted") return invalid("kind: only hosted, which a proxy becomes once");
    if (!admin) return forbidden(`kind: turning ${repo.prefix} into a hosted repo needs the admin role`);
    if (kind === "group") return invalid("kind: a group cannot become a hosted repo");
    if (kind === "proxy") return invalid(`kind: format ${seed.format} cannot turn a proxy into a hosted repo`);
    return repoOf(seed, me);
  }
  if (b.anonymousRead !== undefined && typeof b.anonymousRead !== "boolean") return invalid("anonymousRead: true or false");
  if (b.policy !== undefined && kind === "group") return invalid("policy: a group has none; each member keeps its own");
  const policyError = checkPolicy(b.policy, repo.format, true);
  if (policyError) return policyError;

  let upstream = seed.upstream;
  if (b.upstream !== undefined) {
    if (kind !== "proxy" || !seed.upstream) return invalid("upstream: only a proxy repo has one");
    if (!isObject(b.upstream)) return invalid(b.upstream === null ? "upstream: a proxy keeps its upstream; it cannot be removed" : "upstream: a merge patch of its keys");
    const merged = mergeUpstream(seed.upstream, b.upstream);
    const refused = upstreamRefusal(merged, seed.format, upstreams);
    if (refused) return refused;
    if (merged.name !== seed.upstream.name && !admin) return forbidden(`upstream.name: choosing the upstream of ${repo.prefix} needs the admin role`);
    upstream = merged as Upstream;
  }
  let group = seed.group;
  if (b.group !== undefined) {
    if (kind !== "group" || !seed.group) return invalid("group: only a group has one");
    if (!isObject(b.group)) return invalid(b.group === null ? "group: a group keeps its members; it cannot be removed" : "group: a merge patch of its keys");
    const merged = mergeGroup(seed.group, b.group) as RepoGroup;
    const refused = groupRefusal(merged, seed.format, seed.name, repoSeeds);
    if (refused) return refused;
    // The admin role is asked for a change, not for the key: members sent back as they are, in
    // their order, need manage alone.
    if (!admin && JSON.stringify(merged.members) !== JSON.stringify(seed.group.members)) return forbidden(`group.members: changing the members of ${repo.prefix} needs the admin role`);
    if (!admin && pathsKey(merged.paths) !== pathsKey(seed.group.paths)) return forbidden(`group.paths: changing the routes of ${repo.prefix} needs the admin role`);
    group = merged;
  }

  const before = { anonymousRead: seed.anonymousRead, policy: seed.policy, upstream: seed.upstream, group: seed.group };
  const after = {
    anonymousRead: b.anonymousRead === undefined ? seed.anonymousRead : (b.anonymousRead as boolean),
    policy: b.policy === undefined ? seed.policy : mergePolicy(seed.policy, (b.policy as Record<string, unknown> | null) ?? null),
    upstream,
    group,
  };
  // A body that changes nothing changes nothing, not even updatedAt.
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    Object.assign(seed, after);
    seed.updatedAt = new Date().toISOString();
    const keys = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    const pick = (o: typeof after) => Object.fromEntries(keys.map((k) => [k, o[k] ?? null]));
    changed({ at: seed.updatedAt, principal: by, action: "repo.update", repo: repo.prefix, subject: repo.prefix, digest: null, ip: DEMO_IP, details: { from: pick(before), to: pick(after), source: "api" } });
  }
  return repoOf(seed, me);
}

/** DELETE /api/v1/repos/{format}/{repo}[?force=true]: refused with versions unless forced. */
export function deleteRepo(repo: MockRepo, force: boolean, by: string): Refusal | null {
  // A member of a group stays, force or not (proxy-and-group.md §2.5).
  const groups = groupsOf(repo);
  if (groups.length) {
    return { status: 409, code: "CONFLICT", message: `repo ${repo.prefix} is a member of ${groups.join(", ")}; change the members of ${groups.length > 1 ? "those groups" : "that group"} first` };
  }
  const versions = versionCount(repo.prefix);
  if (versions > 0 && !force) {
    return { status: 409, code: "CONFLICT", message: `repo ${repo.prefix} has ${versions} versions; delete them or pass force=true` };
  }
  repoSeeds.splice(repoSeeds.findIndex((s) => keyOf(s) === repo.prefix), 1);
  dropRepoData(repo.prefix);
  deletedRepos.add(repo.prefix);
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i]!.repo === repo.prefix) tokens.splice(i, 1);
  // What a proxy fetched stays in the registry, but the index forgets it; so does its last run.
  for (const k of [...held]) if (k.startsWith(`${repo.prefix}@`)) held.delete(k);
  demoRuns.delete(repo.prefix);
  changed({ at: new Date().toISOString(), principal: by, action: "repo.delete", repo: repo.prefix, subject: repo.prefix, digest: null, ip: DEMO_IP, details: { versions, source: "api" } });
  return null;
}

const notFound = (message: string): Refusal => ({ status: 404, code: "NOT_FOUND", message });

/** PUT and DELETE …/versions/{version}/yank (docs/api.md, Yank a pypi version): reason null
 * unyanks. Idempotent: the same yank again, or an unyank of a version not yanked, changes
 * nothing and writes no audit row. */
export function yankVersion(repo: MockRepo, name: string, version: string, reason: string | null, by: string): Refusal | null {
  if (repo.format !== "pypi" || (repo.kind ?? "hosted") !== "hosted") return invalid(`${repo.prefix} is not a hosted pypi repo: only those yank`);
  if (!manifestsOf(repo, name)?.some((v) => v.version === version)) return notFound(`${name} has no version ${version} in ${repo.prefix}`);
  const key = yankKey(repo, name, version);
  if (reason === null ? !yanks.has(key) : yanks.get(key) === reason) return null;
  if (reason === null) yanks.delete(key);
  else yanks.set(key, reason);
  const op = reason === null ? "unyank" : "yank";
  changed({ at: new Date().toISOString(), principal: by, action: "pypi.yank", repo: repo.prefix, subject: `${name}@${version}`, digest: null, ip: DEMO_IP, details: { op, version, ...(reason ? { reason } : {}) } });
  return null;
}

/** Whether the repo's registry deletes manifests; null when it does, else the 501 of the delete. */
function deletes(repo: MockRepo): Refusal | null {
  const registry = registries.find((r) => r.name === repo.registry);
  return registry && !registry.capabilities.deleteManifest
    ? { status: 501, code: "UNAVAILABLE", message: `registry ${registry.name} does not delete manifests (capabilities.deleteManifest false); nothing was deleted` }
    : null;
}

/** Deletes the manifests of a version, each with an audit row. */
function deleteRows(repo: MockRepo, rows: Row[], by: string, details: Record<string, unknown> = {}): void {
  for (const v of rows) {
    deletedManifests.add(v.digest);
    dropManifest(v.digest);
    const referrers = v.referrers.signatures + v.referrers.sboms + v.referrers.attestations;
    changed({ at: new Date().toISOString(), principal: by, action: "delete", repo: repo.prefix, subject: `${v.packageName}@${v.version}${v.variant ? ` (${v.variant})` : ""}`, digest: v.digest, ip: DEMO_IP, details: { referrers, source: "api", ...details } });
  }
}

const sameDigests = (rows: Row[], digests: string[]) =>
  rows.length === new Set(digests).size && rows.every((v) => digests.includes(v.digest));

/** RFC 9110's HTTP-date, as If-Unmodified-Since has it; null when it is not one. */
function httpDate(v: string): number | null {
  const t = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(v) ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : t;
}

/** Whether a manifest was published after the cut-off, in whole seconds. */
const after = (v: Row, cutoff: number) => Math.floor(Date.parse(v.createdAt) / 1000) > Math.floor(cutoff / 1000);

export type VersionDelete = { variant: string | null; force: boolean; ifMatch: string | null; ifUnmodifiedSince: string | null };

/** DELETE …/versions/{version} (docs/api.md, Delete a version): a compare-and-delete with
 * If-Match and If-Unmodified-Since; a version an npm dist-tag names is a 409 unless forced. */
export function deleteVersion(repo: MockRepo, name: string, version: string, opts: VersionDelete, by: string): Refusal | null {
  const all = manifestsOf(repo, name)?.filter((v) => v.version === version) ?? [];
  if (!all.length) return notFound(`${name} has no version ${version} in ${repo.prefix}`);
  const rows = opts.variant === null ? all : all.filter((v) => v.variant === opts.variant);
  if (!rows.length) return notFound(`${name} ${version} has no variant ${opts.variant}`);
  if (opts.ifMatch !== null && opts.ifMatch.trim() !== "*") {
    const tags = opts.ifMatch.split(",").map((t) => t.trim());
    if (!tags.every((t) => /^"sha256:[0-9a-f]{64}"$/.test(t))) return invalid(`If-Match: a list of quoted digests, or *, not ${opts.ifMatch}`);
    if (!sameDigests(rows, tags.map((t) => t.slice(1, -1)))) {
      return { status: 412, code: "CONFLICT", message: `${name} ${version} changed since it was read: its digests are now ${rows.map((v) => v.digest).join(", ")}` };
    }
  }
  if (opts.ifUnmodifiedSince !== null) {
    const cutoff = httpDate(opts.ifUnmodifiedSince);
    if (cutoff === null) return invalid(`If-Unmodified-Since: an HTTP-date, not ${opts.ifUnmodifiedSince}`);
    if (rows.some((v) => after(v, cutoff))) return { status: 412, code: "CONFLICT", message: `${name} ${version} was published after the cut-off` };
  }
  const pointers = opts.force ? [] : pointersOf(rows[0]!);
  if (pointers.length) return { status: 409, code: "CONFLICT", message: protectedMessage(repo, rows[0]!, pointers) };
  const unavailable = deletes(repo);
  if (unavailable) return unavailable;
  deleteRows(repo, rows, by);
  return null;
}

const JOB = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** POST …/versions:delete (docs/api.md, Delete versions in a batch): each item on its own, with
 * the conditions of the single delete; a result per item. */
export function deleteVersions(repo: MockRepo, body: unknown, by: string): BatchDeleteResult | Refusal {
  if (!isObject(body)) return invalid("the body is a JSON object with items");
  const unknown = Object.keys(body).find((k) => !["items", "cutoff", "dryRun", "job"].includes(k));
  if (unknown) return invalid(`unknown field ${unknown}`);
  const { items, cutoff, dryRun = false, job = `batch-${Date.now().toString(36)}` } = body;
  if (!Array.isArray(items) || items.length < 1 || items.length > 1000) return invalid("items: 1 to 1000 versions");
  for (const [i, item] of items.entries()) {
    if (!isObject(item) || typeof item.package !== "string" || typeof item.version !== "string" || !Array.isArray(item.digests) || !item.digests.length || !item.digests.every((d) => typeof d === "string")) {
      return invalid(`items[${i}]: package, version and the digests of every variant`);
    }
    const extra = Object.keys(item).find((k) => !["package", "version", "digests"].includes(k));
    if (extra) return invalid(`items[${i}]: unknown field ${extra}`);
  }
  const cut = cutoff === undefined ? null : typeof cutoff === "string" ? Date.parse(cutoff) : NaN;
  if (cut !== null && Number.isNaN(cut)) return invalid("cutoff: an RFC 3339 time");
  if (typeof dryRun !== "boolean") return invalid("dryRun: true or false");
  if (typeof job !== "string" || !JOB.test(job)) return invalid("job: up to 64 letters, digits, '.', '_' and '-', starting with a letter or a digit");
  const unavailable = deletes(repo);
  const results = (items as { package: string; version: string; digests: string[] }[]).map((item): BatchDeleteItemResult => {
    const head = { package: item.package, version: item.version };
    const rows = manifestsOf(repo, item.package)?.filter((v) => v.version === item.version) ?? [];
    if (!rows.length) return { ...head, status: "gone", message: `${item.package} has no version ${item.version}` };
    if (!sameDigests(rows, item.digests)) return { ...head, status: "changed", message: "its digests changed since they were read", digests: rows.map((v) => v.digest) };
    if (cut !== null && rows.some((v) => after(v, cut))) {
      return { ...head, status: "young", message: "published after the cut-off", lastModified: rows.at(-1)!.createdAt };
    }
    const pointers = pointersOf(rows[0]!);
    if (pointers.length) return { ...head, status: "protected", message: protectedMessage(repo, rows[0]!, pointers), pointers };
    if (unavailable) return { ...head, status: "error", message: unavailable.message };
    if (!dryRun) deleteRows(repo, rows, by, { job });
    return { ...head, status: "deleted" };
  });
  return { job, dryRun, results };
}

// --- Proxy repos ----------------------------------------------------------------------------
// The purge of a proxy's cache and a prefetch (docs/api.md). The mock keeps no documents of an
// upstream, so a purge only writes its audit row; a prefetch of an oci proxy holds what it
// fetched, kept in the demo, so that a second run finds it held.

/** What the backend holds of the proxies' fetches, `<repo>@<digest>`. */
const held = new Set<string>();

keep("proxy", {
  save: () => ({ held: [...held] }),
  load: (data) => {
    for (const k of (data as { held?: string[] }).held ?? []) held.add(k);
  },
});

/** DELETE …/upstream-cache[?name=]: a proxy's documents of its upstream, or of one name. */
export function purgeUpstreamCache(repo: MockRepo, name: string | null, by: string): Refusal | null {
  if (repo.kind !== "proxy") return invalid(`repo ${repo.prefix} is not a proxy: it has no cache of an upstream`);
  if (name !== null && !isPackageName(name, repo.format)) return invalid(`name: "${name}" is not a package name of ${repo.format}`);
  changed({ at: new Date().toISOString(), principal: by, action: "repo.cache.purge", repo: repo.prefix, subject: repo.prefix, digest: null, ip: DEMO_IP, details: { ...(name === null ? {} : { name }), source: "api" } });
  return null;
}

/** POST …/prefetch: images of an oci proxy; an offline one asks its upstream nothing (409). A
 * format proxy would take names, but the mock has none: only oci repos have the kind here. */
export function prefetch(repo: MockRepo, body: unknown, by: string): PrefetchResult | Refusal {
  if (repo.kind !== "proxy" || !repo.upstream) return invalid(`repo ${repo.prefix} is not a proxy`);
  if (repo.format !== "oci") return invalid(`format ${repo.format} has no prefetch`);
  const upstream = repo.upstream;
  const config = upstreams.find((u) => u.name === upstream.name && u.format === repo.format);
  if (upstream.offline || !config) {
    return { status: 409, code: "CONFLICT", message: `repo ${repo.prefix} is offline${config ? "" : `: upstream ${upstream.name} is not configured`}; it asks its upstream nothing` };
  }
  const result = prefetchImages({ repo: repo.prefix, upstream, dockerHub: config.dockerHub ?? false, held }, body);
  if ("status" in result) return result;
  // Each push of a fetch is an audit row of the caller's; the prefetch writes none of its own.
  const at = new Date().toISOString();
  for (const r of result.results) {
    if (r.status !== "fetched" || r.kind !== "manifest") continue;
    demoEvents.push({ at, principal: by, action: "proxy.fetch", repo: repo.prefix, subject: `${r.name}${r.platform ? ` (${r.platform})` : ""}`, digest: r.digest ?? null, ip: DEMO_IP, details: { upstream: upstream.name, ref: r.digest } });
  }
  changed();
  return result;
}

export { bindings, tokens, users, serverInfo };
