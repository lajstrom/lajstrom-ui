import type { Binding, Registry, RepoGroup, RepoPolicy, ServerInfo, SigningKey, Token, Upstream, User } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { ago, ahead, before, EXTERNAL_URL } from "./time";

/** GET /api/v1/info but the caller, which the handler adds per request. */
export const serverInfo: Omit<ServerInfo, "caller"> = {
  version: "dev",
  commit: "b9b19e6",
  date: ago(0, 2),
  externalURL: EXTERNAL_URL,
  anonymousRead: true,
  formats: [
    { name: "apt", artifactType: "application/vnd.lajstrom.deb.v1" },
    { name: "maven", artifactType: "application/vnd.lajstrom.maven.v1" },
    { name: "npm", artifactType: "application/vnd.lajstrom.npm.v1" },
    { name: "pypi", artifactType: "application/vnd.lajstrom.pypi.v1" },
    { name: "raw", artifactType: "application/vnd.lajstrom.raw.v1" },
    { name: "rpm", artifactType: "application/vnd.lajstrom.rpm.v1" },
  ],
  authModes: ["password", "token"],
  // auth.login.tokenLifetime, 12 h: POST /api/v1/login answers a DPoP-bound token; and
  // auth.login.idleTimeout, 15 min as PCI DSS 8.2.8 asks: unused that long, it is refused.
  login: { tokenLifetime: 43_200, idleTimeout: 900 },
};

// Capabilities follow the matrix of docs/architecture.md §5, vendors and tiers the table of
// docs/registries/README.md (Support tiers); the status is the answering replica's.
const capabilities = {
  referrersAlwaysTag: false,
  maxBlobSize: 0,
  consistency: "strong",
  consistencyBound: "0s",
  maxNameDepth: 0,
  maxNameLength: 0,
  tagsFoldCase: false,
  buildRoutes: true,
} as const;

export const registries: Omit<Registry, "repos">[] = [
  {
    name: "zot",
    type: "generic",
    vendor: "zot",
    url: "http://zot.lajstrom.svc:5000",
    prefix: "art/",
    support: "ci",
    capabilities: { ...capabilities, createOnPush: true, referrers: true, catalog: true, deleteManifest: true, immutableTags: false, blobRedirect: false },
    status: { state: "ok", checkedAt: before(0, 0, 0.4), answeredAt: before(0, 0, 0.4), latencyMs: 4, message: null, breaker: "closed" },
  },
  {
    name: "ecr-prod",
    type: "ecr",
    vendor: "ecr",
    url: "https://123456789012.dkr.ecr.eu-central-1.amazonaws.com",
    prefix: "art/",
    support: "hosted",
    capabilities: {
      ...capabilities,
      createOnPush: false,
      referrers: true,
      catalog: false,
      deleteManifest: true,
      immutableTags: true,
      blobRedirect: true,
      maxBlobSize: 52_000 * 1024 * 1024,
      consistency: "eventual",
      consistencyBound: "2m10s",
      maxNameLength: 256,
    },
    status: { state: "ok", checkedAt: before(0, 0, 0.6), answeredAt: before(0, 0, 0.6), latencyMs: 38, message: null, breaker: "closed" },
  },
  {
    name: "ci-distribution",
    type: "generic",
    vendor: "distribution",
    url: "http://registry.ci.svc:5000",
    prefix: "",
    support: "ci",
    capabilities: {
      ...capabilities,
      createOnPush: true,
      referrers: false,
      catalog: true,
      deleteManifest: false,
      immutableTags: false,
      blobRedirect: false,
      referrersAlwaysTag: true,
    },
    status: {
      state: "degraded",
      checkedAt: before(0, 0, 0.8),
      answeredAt: before(0, 0, 1.3),
      latencyMs: 1240,
      message: "/v2/ answered in 1.24 s (threshold 1 s)",
      breaker: "half-open",
    },
  },
];

export type RepoSeed = {
  format: "raw" | "pypi" | "apt" | "maven" | "npm" | "rpm" | "oci";
  name: string;
  /** None on a group, which stores nothing (docs/api.md, Repos). */
  registry?: string;
  anonymousRead: boolean;
  policy: RepoPolicy | null;
  createdAt: string;
  /** Set by a change in the demo; the seed's repos were last changed when created. */
  updatedAt?: string;
  reindex: "idle" | "running" | "failed";
  signingKeys?: SigningKey[];
  /** hosted when absent; a proxy has its upstream, a group its members (proxy-and-group.md §2). */
  kind?: "hosted" | "proxy" | "group";
  upstream?: Upstream;
  group?: RepoGroup;
};

const fingerprint = (seed: string) => sha256Hex(seed).slice(0, 40).toUpperCase();

export const repoSeeds: RepoSeed[] = [
  {
    format: "raw",
    name: "assets",
    registry: "zot",
    anonymousRead: true,
    policy: { maxFileSize: 5 * 1024 ** 3, blobRedirect: "auto" },
    createdAt: ago(95),
    reindex: "idle",
  },
  {
    format: "raw",
    name: "scratch",
    registry: "ci-distribution",
    anonymousRead: false,
    policy: { blobRedirect: "never" },
    createdAt: ago(26),
    reindex: "idle",
  },
  {
    format: "pypi",
    name: "internal",
    registry: "ecr-prod",
    anonymousRead: false,
    policy: { maxFileSize: 512 * 1024 ** 2 },
    createdAt: ago(420),
    reindex: "idle",
  },
  {
    format: "pypi",
    name: "payments",
    registry: "ecr-prod",
    anonymousRead: false,
    policy: {},
    createdAt: ago(80),
    reindex: "idle",
  },
  {
    format: "apt",
    name: "ubuntu-internal",
    registry: "ecr-prod",
    anonymousRead: true,
    policy: { blobRedirect: "auto" },
    createdAt: ago(130),
    reindex: "idle",
    signingKeys: [
      { algorithm: "ed25519", fingerprint: fingerprint("apt-key-2"), createdAt: ago(30, 2), retiredAt: null },
      { algorithm: "rsa4096", fingerprint: fingerprint("apt-key-1"), createdAt: ago(130), retiredAt: ago(30, 2) },
    ],
  },
  {
    format: "maven",
    name: "releases",
    registry: "zot",
    anonymousRead: false,
    policy: { maven: { sessionTimeout: "30m" } },
    createdAt: ago(210),
    reindex: "idle",
  },
  {
    format: "maven",
    name: "payments",
    registry: "ecr-prod",
    anonymousRead: false,
    policy: { maven: { sessionTimeout: "45m", maxSessionFiles: 64 } },
    createdAt: ago(80),
    reindex: "running",
  },
  // npm and rpm (#7): the repos of the server's quick starts, npm/internal and rpm/el9.
  {
    format: "npm",
    name: "internal",
    registry: "zot",
    anonymousRead: false,
    policy: {},
    createdAt: ago(100),
    reindex: "idle",
  },
  {
    format: "rpm",
    name: "el9",
    registry: "ecr-prod",
    anonymousRead: true,
    policy: { blobRedirect: "auto" },
    createdAt: ago(75),
    reindex: "idle",
    signingKeys: [{ algorithm: "rsa4096", fingerprint: fingerprint("rpm-key-1"), createdAt: ago(75), retiredAt: null }],
  },
  // Proxy and group repos are of formats whose plugin has them (npm) or of oci, which needs none
  // (docs/spec/proxy-and-group.md §11, §12): a hosted oci repo, proxies of Docker Hub and of
  // ghcr.io, and one pull address over the three, as in §12.1.
  {
    format: "oci",
    name: "internal",
    registry: "zot",
    anonymousRead: false,
    policy: null,
    createdAt: ago(60),
    reindex: "idle",
  },
  {
    format: "oci",
    name: "hub",
    kind: "proxy",
    registry: "zot",
    anonymousRead: false,
    policy: null,
    upstream: { name: "dockerhub", metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: ["acme/*"] },
    createdAt: ago(58),
    reindex: "idle",
  },
  {
    format: "oci",
    name: "ghcr",
    kind: "proxy",
    registry: "zot",
    anonymousRead: false,
    policy: { maxFileSize: 2 * 1024 ** 3 },
    upstream: { name: "ghcr", metadataTTL: "1h", negativeTTL: "5m", offline: false, allow: ["oras-project/*", "sigstore/*"], deny: [] },
    createdAt: ago(58),
    reindex: "idle",
  },
  {
    format: "oci",
    name: "all",
    kind: "group",
    anonymousRead: false,
    policy: null,
    group: { members: ["internal", "hub", "ghcr"], paths: { internal: ["acme/*"], hub: ["*"], ghcr: ["oras-project/*", "sigstore/*"] } },
    createdAt: ago(57),
    reindex: "idle",
  },
  // §2.4's: a proxy of npmjs.org that never fetches Acme's scope, and one address for it and the
  // hosted npm/internal, whose names hide the proxy's.
  {
    format: "npm",
    name: "npmjs",
    kind: "proxy",
    registry: "zot",
    anonymousRead: false,
    policy: null,
    upstream: { name: "npmjs", metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: ["@acme/*"] },
    createdAt: ago(56),
    reindex: "idle",
  },
  {
    format: "npm",
    name: "all",
    kind: "group",
    anonymousRead: false,
    policy: null,
    group: { members: ["internal", "npmjs"], merge: [] },
    createdAt: ago(56),
    reindex: "idle",
  },
];

/** upstreams[] of the configuration (proxy-and-group.md §2.1): the API names them, never their
 * URL or credentials; the URL is the origin of what a proxy fetches (manifest-profile.md §3.1).
 * dockerHub: a path of one component is library/<path> (§11.7). */
export const upstreams: { name: string; format: string; url: string; dockerHub?: boolean }[] = [
  { name: "dockerhub", format: "oci", url: "https://registry-1.docker.io", dockerHub: true },
  { name: "ghcr", format: "oci", url: "https://ghcr.io" },
  { name: "quay", format: "oci", url: "https://quay.io" },
  { name: "npmjs", format: "npm", url: "https://registry.npmjs.org/" },
];

/** A user's uid in the mock, stable across reloads: the server's are UUIDv7, these only look so. */
export function uidOf(name: string): string {
  const h = sha256Hex(`uid:${name}`);
  const variant = (8 | (parseInt(h[16]!, 16) & 3)).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** What the mock's server is configured with and /api/v1/info does not answer (docs/configuration.md
 * of the server), in hours as the configuration writes them; 0 is off.
 * auth.disableInactiveUsersAfter: PCI DSS 8.2.6's 90 days (rbac.md §1, Inactive users).
 * auth.deployTokens.maxTTL: 180 days, set after the seed's deploy tokens without an expiry were
 * made (rbac.md §1, the lifetime of a deploy token). */
export const config = { disableInactiveUsersAfterHours: 2160, deployTokensMaxTTLHours: 4320 };

// A user's lastSeenAt is its last authentication, so no older than its tokens' last use.
export const users: User[] = [
  { uid: uidOf("admin"), name: "admin", kind: "local", disabled: false, createdAt: ago(420), lastSeenAt: before(0, 0, 5) },
  { uid: uidOf("alice"), name: "alice", kind: "local", disabled: false, createdAt: ago(300), lastSeenAt: before(0, 1) },
  { uid: uidOf("bob"), name: "bob", kind: "local", disabled: false, createdAt: ago(290), lastSeenAt: before(1, 2) },
  { uid: uidOf("carol"), name: "carol", kind: "local", disabled: false, createdAt: ago(150), lastSeenAt: before(2) },
  { uid: uidOf("dave"), name: "dave", kind: "local", disabled: true, createdAt: ago(240), lastSeenAt: ago(70) },
  // Made by its first OIDC login, without a password; its groups are those of its latest login
  // (rbac.md §8, the proposed User.groups).
  { uid: uidOf("erin"), name: "erin", kind: "oidc", disabled: false, createdAt: ago(12), lastSeenAt: before(0, 1), groups: ["platform", "payments-oncall"] },
  // Unseen for longer than auth.disableInactiveUsersAfter: inactive, and disabled by its next
  // authentication (judy / judy in the demo).
  { uid: uidOf("judy"), name: "judy", kind: "local", disabled: false, createdAt: ago(380), lastSeenAt: before(131) },
];

/** Passwords set through the API in the demo, by user name, as the sha256 of the password. Until
 * then a local user of the seed has its name as its password, and an OIDC user none. */
export const passwords = new Map<string, string>();

// A deploy token is bound to one repo, or to a mask of repos (rbac.md §1); uploads in the seed
// use only the tokens bound to their repo, and users only where a binding lets them write.
export const tokens: Token[] = [
  { id: 3, kind: "pat", name: "laptop", user: "alice", scopes: [], expiresAt: ahead(61), lastUsedAt: before(0, 1), createdAt: ago(29), revokedAt: null, hashPrefix: "019931d4" },
  { id: 4, kind: "pat", name: "ci-local", user: "bob", scopes: ["read"], expiresAt: ahead(20), lastUsedAt: before(1, 2), createdAt: ago(70), revokedAt: null, hashPrefix: "daa0b8d4" },
  { id: 7, kind: "pat", name: "old laptop", user: "alice", scopes: [], expiresAt: ahead(5), lastUsedAt: before(40), createdAt: ago(85), revokedAt: ago(10, 4), hashPrefix: "5363e7f2" },
  { id: 9, kind: "pat", name: "notebook", user: "carol", scopes: ["read", "write"], expiresAt: ahead(3, 4), lastUsedAt: before(2), createdAt: ago(87), revokedAt: null, hashPrefix: "a2fd807c" },
  { id: 11, kind: "pat", name: "release scripts", user: "admin", scopes: [], expiresAt: ahead(300), lastUsedAt: before(0, 5), createdAt: ago(65), revokedAt: null, hashPrefix: "1b3d0235" },
  { id: 12, kind: "deploy", name: "github-actions payments-api", repo: "maven/payments", scopes: ["read", "write"], expiresAt: null, lastUsedAt: before(0, 0, 4), createdAt: ago(78), revokedAt: null, hashPrefix: "3281d82f" },
  { id: 15, kind: "deploy", name: "github-actions acme-agent (apt)", repo: "apt/ubuntu-internal", scopes: ["read", "write"], expiresAt: ahead(55), lastUsedAt: before(1, 3), createdAt: ago(120), revokedAt: null, hashPrefix: "e19cb71b" },
  { id: 16, kind: "deploy", name: "github-actions acme-agent (raw)", repo: "raw/assets", scopes: ["write"], expiresAt: ahead(85), lastUsedAt: before(9, 2), createdAt: ago(90), revokedAt: null, hashPrefix: "3234bb55" },
  { id: 18, kind: "deploy", name: "jupyterhub", repo: "pypi/internal", scopes: ["read"], expiresAt: null, lastUsedAt: before(0, 0, 12), createdAt: ago(200), revokedAt: null, hashPrefix: "10df33fe" },
  { id: 21, kind: "deploy", name: "billing CI", repo: "pypi/internal", scopes: ["read", "write"], expiresAt: ahead(45), lastUsedAt: before(4, 2), createdAt: ago(100), revokedAt: null, hashPrefix: "82a21d7c" },
  { id: 22, kind: "deploy", name: "payments CI (pypi)", repo: "pypi/payments", scopes: ["write"], expiresAt: ahead(110), lastUsedAt: before(6, 3), createdAt: ago(60), revokedAt: null, hashPrefix: "9ab0bbe6" },
  { id: 24, kind: "deploy", name: "payments audit mirror", repoMask: "*/payments", scopes: ["read"], expiresAt: null, lastUsedAt: before(0, 2), createdAt: ago(25), revokedAt: null, hashPrefix: "c4e81f07" },
  // npm and rpm (#7): the CI of the npm and rpm seeds.
  { id: 41, kind: "deploy", name: "github-actions web (npm)", repo: "npm/internal", scopes: ["read", "write"], expiresAt: ahead(75), lastUsedAt: before(1, 5), createdAt: ago(98), revokedAt: null, hashPrefix: "7f04c2a9" },
  { id: 42, kind: "deploy", name: "github-actions acme-agent (rpm)", repo: "rpm/el9", scopes: ["write"], expiresAt: ahead(110), lastUsedAt: before(1, 3), createdAt: ago(60), revokedAt: null, hashPrefix: "b83e6d10" },
];

/** The mock's bindings name users as `user:<name>`; the API answers `user:<uid>` and the name
 * (src/mocks/db.ts, bindingJson). */
export type MockBinding = Omit<Binding, "name">;

export const bindings: MockBinding[] = [
  { id: 1, principal: "user:admin", role: "admin", repoMask: "*/*", createdAt: ago(420) },
  { id: 2, principal: "user:alice", role: "reader", repoMask: "*/*", createdAt: ago(300) },
  { id: 3, principal: "user:alice", role: "writer", repoMask: "*/payments", createdAt: ago(80) },
  { id: 4, principal: "user:bob", role: "maintainer", repoMask: "apt/*", createdAt: ago(130) },
  { id: 5, principal: "user:bob", role: "writer", repoMask: "raw/*", createdAt: ago(95) },
  { id: 6, principal: "user:carol", role: "writer", repoMask: "maven/releases", createdAt: ago(150) },
  { id: 7, principal: "user:carol", role: "writer", repoMask: "pypi/internal", createdAt: ago(150) },
  { id: 8, principal: "user:carol", role: "reader", repoMask: "*/*", createdAt: ago(150) },
  { id: 9, principal: "user:dave", role: "reader", repoMask: "*/*", createdAt: ago(240) },
  // Bindings of OIDC groups, which reach a repo through their members (rbac.md §8).
  { id: 10, principal: "group:platform", role: "maintainer", repoMask: "raw/*", createdAt: ago(14) },
  { id: 11, principal: "group:payments-oncall", role: "reader", repoMask: "*/payments", createdAt: ago(14) },
];

export const roleActions: Record<Binding["role"], ("read" | "write" | "delete" | "manage")[]> = {
  reader: ["read"],
  // attach is not among a repo's permissions: it is a /v2 action, the PUT of a referrer.
  attacher: ["read"],
  writer: ["read", "write"],
  maintainer: ["read", "write", "delete", "manage"],
  admin: ["read", "write", "delete", "manage"],
};
