// Proxy and group repos in the mock (docs/spec/proxy-and-group.md, docs/api.md): the resources,
// the purge of a proxy's cache and a prefetch, through the client's calls and msw in node.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath, apiSend } from "@/api/client";
import { createRepo, prefetch, purgeUpstreamCache, updateRepo } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { AuditList, ManifestList, PackageList, Repo, VersionDetail, VersionSummary } from "@/api/types";
import { connectFor, formatSpec } from "@/lib/formats";
import { countResults, failedItems, listItems, prefetchRequest } from "@/pages/proxy-changes";

import { createToken } from "./auth";
import { handlers } from "./handlers";
import { matches, normalizePlatform, npmNameRefusal, parseImage, refusedBy } from "./proxy";

const server = setupServer(...handlers);

type VersionList = { versions: VersionSummary[] };

// Each request waits the mock's latency, up to 310 ms, and a prefetch a moment per image: a test
// of several needs more than 5 s.
vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string) {
  const t = createToken({ user }, { name: `proxy test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const repo = (format: string, name: string) => apiGet<Repo>(apiPath("repos", format, name));

describe("the resources", () => {
  it("answers a proxy with every key of its upstream, and a group with its members and routes but no registry or policy", async () => {
    signIn("alice");
    const hub = await repo("oci", "hub");
    expect(hub).toMatchObject({ kind: "proxy", registry: "zot", upstream: { name: "dockerhub", metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: ["acme/*"] } });
    expect(hub.group).toBeUndefined();

    const all = await repo("oci", "all");
    expect(all).toMatchObject({ kind: "group", group: { members: ["internal", "hub", "ghcr"], paths: { hub: ["*"] } } });
    expect(all).not.toHaveProperty("registry");
    expect(all).not.toHaveProperty("policy");
    expect(all.group).not.toHaveProperty("merge");
    expect((await repo("oci", "internal")).kind).toBe("hosted");
  });

  it("answers the npm proxy and group of §2.4: a proxy of npmjs, and a group of npm/internal and it with merge", async () => {
    signIn("alice");
    const npmjs = await repo("npm", "npmjs");
    expect(npmjs).toMatchObject({ kind: "proxy", registry: "zot", policy: null, upstream: { name: "npmjs", metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: ["@acme/*"] } });
    const all = await repo("npm", "all");
    expect(all).toMatchObject({ kind: "group", group: { members: ["internal", "npmjs"], merge: [] } });
    expect(all).not.toHaveProperty("registry");
    expect(all).not.toHaveProperty("policy");
    expect(all.group).not.toHaveProperty("paths");
    // A group holds nothing: its list of packages is empty (docs/api.md, List packages).
    expect((await apiGet<PackageList>(apiPath("repos", "npm", "all", "packages"))).packages).toEqual([]);
  });

  it("refuses to delete a member of a group, force or not, naming the group", async () => {
    signIn("admin");
    await expect(apiSend("DELETE", apiPath("repos", "oci", "hub"), { query: { force: true } })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("oci/all"),
    });
    expect((await repo("oci", "hub")).kind).toBe("proxy");
  });
});

describe("connect a client", () => {
  it("has no publish snippets for a proxy or a group, and keeps them for a hosted repo", async () => {
    signIn("admin");
    const ids = async (name: string) => {
      const r = { ...(await repo("oci", name)), prefix: `oci/${name}` };
      const ctx = { baseUrl: "https://art.example.com", host: "art.example.com", repo: r, readNeedsAuth: true };
      return connectFor(formatSpec("oci"), ctx).flatMap((g) => g.snippets.map((s) => s.id));
    };
    expect(await ids("internal")).toEqual(["docker-push", "docker-pull", "oras"]);
    expect(await ids("hub")).toEqual(["docker-pull", "oras-pull"]);
    expect(await ids("all")).toEqual(["docker-pull", "oras-pull"]);
  });
});

describe("purge the upstream cache of an npm proxy", () => {
  it("takes a name npm takes, scoped or not, and refuses another", async () => {
    signIn("admin");
    await purgeUpstreamCache("npm", "npmjs", "@types/node");
    await purgeUpstreamCache("npm", "npmjs", "JSONStream");
    await expect(purgeUpstreamCache("npm", "npmjs", "a/b")).rejects.toMatchObject({ status: 400, message: 'name: "a/b" is not a package name of npm' });
    await expect(purgeUpstreamCache("npm", "all")).rejects.toMatchObject({ status: 400 });
    const audit = await apiGet<AuditList>(apiPath("audit"), { action: "repo.cache.purge", repo: "npm/npmjs" });
    expect(audit.events.map((e) => e.details?.name)).toEqual(["JSONStream", "@types/node"]);
  });
});

describe("prefetch an npm proxy", () => {
  it("fetches the versions the dist-tags name, or every one; a second run finds them held, and the repo lists them", async () => {
    signIn("admin");
    const first = await prefetch("npm", "npmjs", { names: ["express", "left-pad"] });
    // express's dist-tags name two lines of releases; in the order of its packument.
    expect(first.results).toEqual([
      { name: "express", version: "4.21.2", status: "fetched" },
      { name: "express", version: "5.1.0", status: "fetched" },
      { name: "left-pad", version: "1.3.0", status: "fetched" },
    ]);
    const second = await prefetch("npm", "npmjs", { names: ["express"], allVersions: true });
    expect(second.results.map((r) => `${r.version} ${r.status}`)).toEqual(["5.0.0 fetched", "4.21.2 held", "5.1.0 held"]);

    // Each fetch is an audit row of the caller's, proxy.fetch instead of push.
    const audit = await apiGet<AuditList>(apiPath("audit"), { repo: "npm/npmjs", action: "proxy.fetch" });
    expect(audit.events.map((e) => e.subject).sort()).toEqual(["express@4.21.2", "express@5.0.0", "express@5.1.0", "left-pad@1.3.0"]);
    expect(audit.events.every((e) => e.principalName === "admin" && e.details?.upstream === "npmjs")).toBe(true);
    expect((await apiGet<AuditList>(apiPath("audit"), { repo: "npm/npmjs", action: "push" })).events).toEqual([]);

    // What it fetched is the repo's, as an upload's would be (proxy-and-group.md §1, §5).
    expect((await apiGet<PackageList>(apiPath("repos", "npm", "npmjs", "packages"))).packages.map((p) => [p.name, p.latestVersion])).toEqual([
      ["express", "5.1.0"],
      ["left-pad", "1.3.0"],
    ]);
    expect((await repo("npm", "npmjs")).stats).toMatchObject({ packages: 2, versions: 4 });
    const versions = await apiGet<VersionList>(apiPath("repos", "npm", "npmjs", "packages", "express", "versions"));
    expect(versions.versions.map((v) => v.version)).toEqual(["5.1.0", "4.21.2", "5.0.0"]);
  });

  it("gives a fetched version the origin of manifest-profile.md §3.1: the tarball's URL and its checksum, no uploader, the upstream's publish time", async () => {
    signIn("admin");
    await prefetch("npm", "npmjs", { names: ["@types/made-up"] });
    const list = await apiGet<VersionList>(apiPath("repos", "npm", "npmjs", "packages", "@types/made-up", "versions"));
    const version = list.versions[0]!.version;
    const d = await apiGet<VersionDetail>(apiPath("repos", "npm", "npmjs", "packages", "@types/made-up", "versions", version));
    const m = await apiGet<ManifestList>(apiPath("repos", "npm", "npmjs", "packages", "@types/made-up", "versions", version, "manifest"));
    const a = m.manifests[0]!.manifest.annotations as Record<string, string>;
    expect(a["lajstrom.origin.url"]).toBe(`https://registry.npmjs.org/@types/made-up/-/made-up-${version}.tgz`);
    expect(a["lajstrom.origin.checksum"]).toMatch(/^sha512:[0-9a-f]{128}$/);
    expect(a).not.toHaveProperty("lajstrom.uploaded-by");
    expect(a["lajstrom.repo"]).toBe("npmjs");
    expect(d.publishedAt).toBe(a["org.opencontainers.image.created"]);
    expect(d.publishedAt < new Date().toISOString()).toBe(true);
  });

  it("answers a result per name: one npm refuses, one the lists refuse, one the upstream does not have, one above the repo's maxFileSize", async () => {
    signIn("admin");
    const { results } = await prefetch("npm", "npmjs", { names: ["Not A Name", "@acme/widgets", "clsx"] });
    expect(results.map((r) => [r.name, r.version, r.status, r.httpStatus])).toEqual([
      ["Not A Name", undefined, "failed", 400],
      ["@acme/widgets", undefined, "failed", 403],
      ["clsx", "2.1.1", "fetched", undefined],
    ]);
    expect(results[0]!.message).toBe('"Not A Name" has " ", which a URL escapes');
    expect(results[1]!.message).toBe('npm/npmjs does not mirror "@acme/widgets": deny: @acme/*');

    // A proxy that mirrors Acme's scope: npmjs.org does not have it.
    await createRepo({ format: "npm", name: "types", registry: "zot", kind: "proxy", upstream: { name: "npmjs", allow: ["@types/*", "@acme/*", "typescript"] }, policy: { maxFileSize: 1024 ** 2 } });
    const types = await prefetch("npm", "types", { names: ["@acme/widgets", "lodash", "typescript"] });
    expect(types.results.map((r) => `${r.name} ${r.version ?? "-"} ${r.status} ${r.httpStatus ?? ""}`.trim())).toEqual([
      "@acme/widgets - failed 404",
      "lodash - failed 403",
      "typescript 5.9.0-beta failed 403",
      "typescript 5.9.1-rc failed 403",
      "typescript 5.9.3 failed 403",
    ]);
    expect(types.results[0]!.message).toContain('upstream npmjs does not have "@acme/widgets"');
    expect(types.results[1]!.message).toMatch(/: allow$/);
    expect(types.results[2]!.message).toContain("above the repo's maxFileSize of 1048576");
    const rejected = await apiGet<AuditList>(apiPath("audit"), { repo: "npm/types", action: "proxy.reject" });
    expect(rejected.events).toHaveLength(3);
    // Under a larger bound the same names are fetched; nothing of the refused was kept.
    await updateRepo("npm", "types", { policy: { maxFileSize: null } });
    expect((await prefetch("npm", "types", { names: ["typescript"] })).results.map((r) => r.status)).toEqual(["fetched", "fetched", "fetched"]);
  });

  it("refuses a body that is not one, an oci body, a repo that is not a proxy, and a caller without manage", async () => {
    signIn("admin");
    await expect(prefetch("npm", "npmjs", { names: [] })).rejects.toMatchObject({ status: 400, message: "names: 0 of them; a prefetch takes 1 to 100" });
    await expect(prefetch("npm", "npmjs", { names: Array.from({ length: 101 }, (_, i) => `p${i}`) })).rejects.toMatchObject({ status: 400 });
    await expect(prefetch("npm", "npmjs", { names: ["left-pad", ""] })).rejects.toMatchObject({ status: 400, message: "names[1]: empty" });
    await expect(prefetch("npm", "npmjs", { images: ["nginx"] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^images and platforms are an oci proxy repo's/) });
    await expect(prefetch("npm", "internal", { names: ["left-pad"] })).rejects.toMatchObject({ status: 400 });
    await expect(prefetch("npm", "all", { names: ["left-pad"] })).rejects.toMatchObject({ status: 400 });
    signIn("alice");
    await expect(prefetch("npm", "npmjs", { names: ["left-pad"] })).rejects.toMatchObject({ status: 403 });
  });
});

describe("purge the upstream cache", () => {
  it("drops the cache of a proxy, or of one name, with an audit row; refuses another kind and a bad name", async () => {
    signIn("admin");
    await purgeUpstreamCache("oci", "hub");
    await purgeUpstreamCache("oci", "hub", "library/nginx");
    const audit = await apiGet<AuditList>(apiPath("audit"), { action: "repo.cache.purge", repo: "oci/hub" });
    expect(audit.events.map((e) => e.details?.name)).toEqual(["library/nginx", undefined]);

    await expect(purgeUpstreamCache("oci", "internal")).rejects.toMatchObject({ status: 400, code: "INVALID" });
    await expect(purgeUpstreamCache("oci", "all")).rejects.toMatchObject({ status: 400 });
    await expect(purgeUpstreamCache("oci", "hub", "Not A Name")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^name: /) });
  });

  it("needs manage on the repo", async () => {
    signIn("alice");
    await expect(purgeUpstreamCache("oci", "hub")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    signIn("bob");
    await expect(purgeUpstreamCache("oci", "hub")).rejects.toMatchObject({ status: 404 });
  });
});

describe("prefetch an oci proxy", () => {
  it("fetches the index, the manifest of each platform and its blobs; a second run finds them held", async () => {
    signIn("admin");
    const first = await prefetch("oci", "hub", { images: ["nginx:1.27"], platforms: ["linux/amd64", "linux/arm64/v8"] });
    const kinds = first.results.map((r) => `${r.kind}${r.platform ? ` ${r.platform}` : ""} ${r.status}`);
    expect(kinds[0]).toBe("index fetched");
    expect(kinds.filter((k) => k.startsWith("manifest"))).toEqual(["manifest linux/amd64 fetched", "manifest linux/arm64 fetched"]);
    expect(first.results.filter((r) => r.kind === "blob" && r.status === "fetched")).toHaveLength(8);
    expect(first.results.every((r) => r.name === "nginx:1.27" && r.digest?.startsWith("sha256:"))).toBe(true);

    const second = await prefetch("oci", "hub", { images: ["nginx:1.27"], platforms: ["linux/amd64", "linux/arm64"] });
    expect(second.results.map((r) => `${r.kind} ${r.status}`)).toEqual(["index held", "manifest held", "manifest held"]);

    const audit = await apiGet<AuditList>(apiPath("audit"), { action: "proxy.fetch", repo: "oci/hub" });
    expect(audit.events).toHaveLength(2);
  });

  it("answers a result per image: refused by deny or allow, an index without platforms, a platform the index lacks", async () => {
    signIn("admin");
    const { results } = await prefetch("oci", "hub", { images: ["acme/api:1.0", "redis:7.4", "docker.io/library/nginx"] });
    expect(results.map((r) => [r.status, r.httpStatus])).toEqual([
      ["failed", 403],
      ["failed", 400],
      ["failed", 400],
    ]);
    expect(results[0]!.message).toContain("deny: acme/*");
    expect(results[1]!.message).toContain("linux/amd64");

    const ghcr = await prefetch("oci", "ghcr", { images: ["library/nginx:1.27", "oras-project/oras:v1.2.0"], platforms: ["linux/s390x"] });
    expect(ghcr.results.map((r) => `${r.kind ?? ""} ${r.status} ${r.httpStatus ?? ""}`.trim())).toEqual(["failed 403", "index fetched", "manifest failed 404"]);
    expect(ghcr.results[0]!.message).toMatch(/allow$/);
  });

  it("refuses a body that is not one, names on an oci proxy, a repo that is not a proxy, and a caller without manage", async () => {
    signIn("admin");
    await expect(prefetch("oci", "hub", { images: [] })).rejects.toMatchObject({ status: 400 });
    await expect(prefetch("oci", "hub", { names: ["left-pad"] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^names: /) });
    await expect(prefetch("oci", "hub", { images: ["nginx"], platforms: ["linux"] })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^platforms\[0\]/) });
    await expect(prefetch("oci", "internal", { images: ["nginx"] })).rejects.toMatchObject({ status: 400 });
    signIn("alice");
    await expect(prefetch("oci", "hub", { images: ["nginx"] })).rejects.toMatchObject({ status: 403 });
  });
});

describe("the rules of names", () => {
  it("matches patterns ignoring case, * within a component on oci, and lets deny win", () => {
    expect(matches("@acme/*", "@ACME/widgets", false)).toBe(true);
    expect(matches("acme/*", "acme/api", true)).toBe(true);
    expect(matches("acme/*", "acme/tools/lint", true)).toBe(false);
    expect(matches("acme/*", "acme/tools/lint", false)).toBe(true);
    expect(refusedBy({ name: "u", allow: ["acme/*"], deny: ["acme/secret"] }, "acme/secret", true)).toBe("deny: acme/secret");
    expect(refusedBy({ name: "u", allow: ["acme/*"] }, "other/x", true)).toBe("allow");
    expect(refusedBy({ name: "u" }, "anything", true)).toBeNull();
  });

  it("takes the npm names the server's CheckName takes, the oldest packages' capitals included", () => {
    for (const ok of ["left-pad", "@types/node", "JSONStream", "lodash.merge", "@acme/ui-kit"]) expect(npmNameRefusal(ok), ok).toBeNull();
    expect(npmNameRefusal("a/b")).toMatch(/is a scoped name/);
    expect(npmNameRefusal("@acme")).toMatch(/is not a scoped name/);
    expect(npmNameRefusal("@acme/a/b")).toMatch(/is not a scoped name/);
    expect(npmNameRefusal(".hidden")).toMatch(/begins with "\."/);
    expect(npmNameRefusal("node_modules")).toMatch(/is not a package name/);
    expect(npmNameRefusal("x".repeat(215))).toMatch(/at most 214/);
    expect(npmNameRefusal("@scope/..")).toMatch(/has the part/);
  });

  it("reads references as a client names them, and platforms as containerd does", () => {
    expect(parseImage("nginx", true)).toEqual({ path: "library/nginx", tag: "latest", digest: null });
    expect(parseImage("bitnami/redis:7.4", true)).toEqual({ path: "bitnami/redis", tag: "7.4", digest: null });
    expect(parseImage(`a/b:1@sha256:${"0".repeat(64)}`, false)).toEqual({ path: "a/b", tag: "1", digest: `sha256:${"0".repeat(64)}` });
    expect(parseImage("ghcr.io/a/b", false)).toMatch(/names a registry/);
    expect(parseImage("Upper/case", false)).toMatch(/not a repository path/);
    expect(["linux/arm64/v8", "linux/arm", "linux/amd64/v1", "windows"].map(normalizePlatform)).toEqual(["linux/arm64", "linux/arm/v7", "linux/amd64", null]);
  });

  it("builds the request of the dialog: one item a line, comments and repeats left out", () => {
    expect(listItems("nginx:1.27\n# base images\nredis:7.4, nginx:1.27\n\n")).toEqual(["nginx:1.27", "redis:7.4"]);
    expect(prefetchRequest({ format: "oci" }, ["nginx"], { platforms: ["linux/amd64"], allVersions: true })).toEqual({ images: ["nginx"], platforms: ["linux/amd64"] });
    expect(prefetchRequest({ format: "npm" }, ["left-pad"], { platforms: [], allVersions: true })).toEqual({ names: ["left-pad"], allVersions: true });
    const results = [
      { name: "a", status: "fetched" as const },
      { name: "b", status: "failed" as const },
      { name: "b", status: "failed" as const },
    ];
    expect(countResults(results)).toEqual([
      ["fetched", 1],
      ["failed", 2],
    ]);
    expect(failedItems(results)).toEqual(["b"]);
  });
});
