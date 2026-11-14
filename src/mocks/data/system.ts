import type { Binding, Registry, RepoPolicy, ServerInfo, SigningKey, Token, User } from "@/api/types";
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
    { name: "pypi", artifactType: "application/vnd.lajstrom.pypi.v1" },
    { name: "raw", artifactType: "application/vnd.lajstrom.raw.v1" },
  ],
  authModes: ["password", "token"],
};

// Capabilities follow the matrix of docs/architecture.md §5; cells marked "verify" there are
// filled with the answer the registry spikes are expected to give.
export const registries: Omit<Registry, "repos">[] = [
  {
    name: "zot",
    type: "generic",
    product: "Zot 2.1",
    url: "http://zot.lajstrom.svc:5000",
    prefix: "art/",
    support: "ci",
    capabilities: {
      createOnPush: true,
      referrers: true,
      catalog: true,
      deleteManifest: true,
      immutableTags: false,
      blobRedirect: false,
      maxBlobSize: 0,
    },
    status: { state: "ok", checkedAt: before(0, 0, 0.4), latencyMs: 4, message: null },
  },
  {
    name: "ecr-prod",
    type: "ecr",
    product: "Amazon ECR",
    url: "https://123456789012.dkr.ecr.eu-central-1.amazonaws.com",
    prefix: "art/",
    support: "manual",
    capabilities: {
      createOnPush: false,
      referrers: true,
      catalog: false,
      deleteManifest: true,
      immutableTags: true,
      blobRedirect: true,
      maxBlobSize: 52_000 * 1024 * 1024,
    },
    status: { state: "ok", checkedAt: before(0, 0, 0.6), latencyMs: 38, message: null },
  },
  {
    name: "ci-distribution",
    type: "generic",
    product: "distribution 3.0",
    url: "http://registry.ci.svc:5000",
    prefix: "",
    support: "ci",
    capabilities: {
      createOnPush: true,
      referrers: false,
      catalog: true,
      deleteManifest: false,
      immutableTags: false,
      blobRedirect: false,
      maxBlobSize: 0,
    },
    status: {
      state: "degraded",
      checkedAt: before(0, 0, 0.8),
      latencyMs: 1240,
      message: "/v2/ answered in 1.24 s (threshold 1 s)",
    },
  },
];

export type RepoSeed = {
  format: "raw" | "pypi" | "apt" | "maven" | "oci";
  name: string;
  registry: string;
  anonymousRead: boolean;
  policy: RepoPolicy | null;
  createdAt: string;
  /** Set by a change in the demo; the seed's repos were last changed when created. */
  updatedAt?: string;
  reindex: "idle" | "running" | "failed";
  signingKeys?: SigningKey[];
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
    policy: { "maven.sessionTimeout": "30m", "maven.sessionExpiry": "abort" },
    createdAt: ago(210),
    reindex: "idle",
  },
  {
    format: "maven",
    name: "payments",
    registry: "ecr-prod",
    anonymousRead: false,
    policy: { "maven.sessionTimeout": "45m", "maven.sessionExpiry": "seal" },
    createdAt: ago(80),
    reindex: "running",
  },
];

/** A user's uid in the mock, stable across reloads: the server's are UUIDv7, these only look so. */
export function uidOf(name: string): string {
  const h = sha256Hex(`uid:${name}`);
  const variant = (8 | (parseInt(h[16]!, 16) & 3)).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const users: User[] = [
  { uid: uidOf("admin"), name: "admin", kind: "local", disabled: false, createdAt: ago(420) },
  { uid: uidOf("alice"), name: "alice", kind: "local", disabled: false, createdAt: ago(300) },
  { uid: uidOf("bob"), name: "bob", kind: "local", disabled: false, createdAt: ago(290) },
  { uid: uidOf("carol"), name: "carol", kind: "local", disabled: false, createdAt: ago(150) },
  { uid: uidOf("dave"), name: "dave", kind: "local", disabled: true, createdAt: ago(240) },
];

// Deploy tokens are bound to exactly one repo (rbac.md §1); uploads in the seed use only the
// tokens bound to their repo, and users only where a binding lets them write.
export const tokens: Token[] = [
  { id: 3, kind: "pat", name: "laptop", user: "alice", scopes: [], expiresAt: ahead(61), lastUsedAt: before(0, 1), createdAt: ago(29), revokedAt: null, hashPrefix: "019931d4" },
  { id: 4, kind: "pat", name: "ci-local", user: "bob", scopes: ["read"], expiresAt: ahead(20), lastUsedAt: before(1, 2), createdAt: ago(70), revokedAt: null, hashPrefix: "daa0b8d4" },
  { id: 7, kind: "pat", name: "old laptop", user: "alice", scopes: [], expiresAt: ahead(5), lastUsedAt: before(40), createdAt: ago(85), revokedAt: ago(10, 4), hashPrefix: "5363e7f2" },
  { id: 9, kind: "pat", name: "notebook", user: "carol", scopes: ["read", "write"], expiresAt: ahead(3, 4), lastUsedAt: before(2), createdAt: ago(87), revokedAt: null, hashPrefix: "a2fd807c" },
  { id: 11, kind: "pat", name: "release scripts", user: "admin", scopes: [], expiresAt: ahead(300), lastUsedAt: before(0, 5), createdAt: ago(65), revokedAt: null, hashPrefix: "1b3d0235" },
  { id: 12, kind: "deploy", name: "github-actions payments-api", repo: "maven/payments", scopes: ["read", "write"], expiresAt: null, lastUsedAt: before(0, 0, 4), createdAt: ago(78), revokedAt: null, hashPrefix: "3281d82f" },
  { id: 15, kind: "deploy", name: "github-actions acme-agent (apt)", repo: "apt/ubuntu-internal", scopes: ["read", "write"], expiresAt: ahead(180), lastUsedAt: before(1, 3), createdAt: ago(120), revokedAt: null, hashPrefix: "e19cb71b" },
  { id: 16, kind: "deploy", name: "github-actions acme-agent (raw)", repo: "raw/assets", scopes: ["write"], expiresAt: ahead(180), lastUsedAt: before(9, 2), createdAt: ago(90), revokedAt: null, hashPrefix: "3234bb55" },
  { id: 18, kind: "deploy", name: "jupyterhub", repo: "pypi/internal", scopes: ["read"], expiresAt: null, lastUsedAt: before(0, 0, 12), createdAt: ago(200), revokedAt: null, hashPrefix: "10df33fe" },
  { id: 21, kind: "deploy", name: "billing CI", repo: "pypi/internal", scopes: ["read", "write"], expiresAt: ahead(45), lastUsedAt: before(4, 2), createdAt: ago(100), revokedAt: null, hashPrefix: "82a21d7c" },
  { id: 22, kind: "deploy", name: "payments CI (pypi)", repo: "pypi/payments", scopes: ["write"], expiresAt: ahead(140), lastUsedAt: before(6, 3), createdAt: ago(60), revokedAt: null, hashPrefix: "9ab0bbe6" },
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
];

export const roleActions: Record<Binding["role"], ("read" | "write" | "delete" | "manage")[]> = {
  reader: ["read"],
  writer: ["read", "write"],
  maintainer: ["read", "write", "delete", "manage"],
  admin: ["read", "write", "delete", "manage"],
};
