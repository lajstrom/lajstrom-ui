// Proxy and group repos in the mock (docs/spec/proxy-and-group.md, docs/api.md): the resources,
// the purge of a proxy's cache and a prefetch, through the client's calls and msw in node.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath, apiSend } from "@/api/client";
import { prefetch, purgeUpstreamCache } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { AuditList, Repo } from "@/api/types";
import { connectFor, formatSpec } from "@/lib/formats";
import { countResults, failedItems, listItems, prefetchRequest } from "@/pages/proxy-changes";

import { createToken } from "./auth";
import { handlers } from "./handlers";
import { matches, normalizePlatform, parseImage, refusedBy } from "./proxy";

const server = setupServer(...handlers);

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
