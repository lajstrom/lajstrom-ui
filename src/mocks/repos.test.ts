// Creating, changing, deleting and reindexing repos in the mock (docs/api.md, Repos;
// docs/spec/proxy-and-group.md §2), through the client's calls and msw in node: who may, the
// server's errors, and where the forms show them.

import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiError, apiGet, apiPath } from "@/api/client";
import { createRepo, deleteRepo, prefetch, startReindex, updateRepo } from "@/api/mutations";
import { repoQuery, reposQuery } from "@/api/queries";
import { setSession } from "@/api/session";
import type { CreateRepoRequest, ReindexRun, Repo } from "@/api/types";
import { dismiss, getNotices } from "@/lib/notices";
import { pollInterval, settingChange } from "@/pages/repo-changes";
import { fieldOf, groupPatch, mergePolicy, policyPatch, repoFields, sizeBytes, sizeParts, upstreamForm, upstreamPatch } from "@/pages/repo-form";

import { createToken } from "./auth";
import { bindings } from "./db";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

// Each request waits the mock's latency, up to 310 ms: a test of many needs more than 5 s.
vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  for (const n of getNotices()) dismiss(n.id);
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string) {
  const t = createToken({ user }, { name: `repos test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const get = (format: string, name: string) => apiGet<Repo>(apiPath("repos", format, name));

/** The refusal of a create, and the field of the form it belongs to. */
async function refusal(req: CreateRepoRequest) {
  const err = await createRepo(req).then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`created ${req.format}/${req.name}`);
  return { status: err.status, message: err.message, field: fieldOf(err, repoFields(req.group?.members), "name") };
}

describe("create", () => {
  it("creates a hosted repo, a proxy of a configured upstream and a group of oci repos, for the admin", async () => {
    signIn("admin");
    const hosted = await createRepo({ format: "raw", name: "made-here", registry: "zot", anonymousRead: true });
    expect(hosted).toMatchObject({ prefix: "raw/made-here", kind: "hosted", registry: "zot", anonymousRead: true, policy: null });
    expect(await createRepo({ format: "rpm", name: "el10", registry: "zot", anonymousRead: false })).toMatchObject({ prefix: "rpm/el10", kind: "hosted" });

    const proxy = await createRepo({ format: "oci", name: "quay", registry: "zot", kind: "proxy", upstream: { name: "quay", deny: ["private/*"] } });
    expect(proxy.upstream).toEqual({ name: "quay", metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: ["private/*"] });

    const group = await createRepo({ format: "oci", name: "edge", kind: "group", group: { members: ["internal", "quay"], paths: { internal: ["acme/*"], quay: ["*"] } } });
    expect(group).toMatchObject({ kind: "group", group: { members: ["internal", "quay"] } });
    expect(group.registry).toBeUndefined();
    expect((await get("oci", "edge")).group?.paths).toEqual({ internal: ["acme/*"], quay: ["*"] });
  });

  it("refuses each field with a message that names it, which the form shows at that field", async () => {
    signIn("admin");
    const base = { format: "oci", registry: "zot" };
    expect(await refusal({ ...base, name: "Bad Name" })).toMatchObject({ status: 400, field: "name" });
    expect(await refusal({ ...base, name: "tags" })).toMatchObject({ status: 400, field: "name" });
    expect(await refusal({ ...base, name: "internal" })).toMatchObject({ status: 409, field: "name" });
    expect(await refusal({ format: "raw", name: "p", registry: "zot", kind: "proxy", upstream: { name: "quay" } })).toMatchObject({ field: "kind", message: "kind: format raw has no proxy repos" });
    expect(await refusal({ ...base, name: "p", registry: "nope" })).toMatchObject({ field: "registry" });
    expect(await refusal({ ...base, name: "p", kind: "proxy" })).toMatchObject({ field: "upstream" });
    expect(await refusal({ ...base, name: "p", kind: "proxy", upstream: { name: "npmjs" } })).toMatchObject({ field: "upstream.name" });
    expect(await refusal({ ...base, name: "p", kind: "proxy", upstream: { name: "quay", metadataTTL: "200h" } })).toMatchObject({ field: "upstream.metadataTTL" });
    expect(await refusal({ ...base, name: "p", kind: "proxy", upstream: { name: "quay", deny: ["has space"] } })).toMatchObject({ field: "upstream.deny" });
    expect(await refusal({ ...base, name: "p", kind: "hosted", upstream: { name: "quay" } })).toMatchObject({ field: "upstream" });

    const group = { format: "oci", name: "g", kind: "group" as const };
    expect(await refusal({ ...group, registry: "zot", group: { members: ["hub"], paths: { hub: ["*"] } } })).toMatchObject({ field: "registry" });
    expect(await refusal({ ...group, group: { members: ["all"], paths: { all: ["*"] } } })).toMatchObject({ field: "group.members", message: expect.stringContaining("is a group") });
    expect(await refusal({ ...group, group: { members: ["hub", "nope"], paths: { hub: ["*"], nope: ["x"] } } })).toMatchObject({ field: "group.members" });
    expect(await refusal({ ...group, group: { members: ["hub", "ghcr"], paths: { hub: ["*"], ghcr: ["*"] } } })).toMatchObject({
      field: "group.paths.ghcr",
      message: 'group.paths.ghcr[0]: "*" is also group.paths.hub[0]',
    });
    expect(await refusal({ ...group, group: { members: ["hub"], paths: { hub: ["*"] }, merge: ["x"] } })).toMatchObject({ field: "group.merge" });
    expect(await refusal({ ...group, group: { members: ["hub", "ghcr"], paths: { hub: ["*"] } } })).toMatchObject({ field: "group.paths.ghcr" });
    expect(await refusal({ ...group, group: { members: ["hub"], paths: { hub: ["a/**"] } } })).toMatchObject({ field: "group.paths.hub" });
  });

  it("needs the admin role", async () => {
    signIn("bob");
    await expect(createRepo({ format: "apt", name: "more", registry: "zot" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("change", () => {
  it("changes anonymousRead and merges the policy for a maintainer; a body that changes nothing keeps updatedAt", async () => {
    signIn("bob");
    const before = await get("apt", "ubuntu-internal");
    const r = await updateRepo("apt", "ubuntu-internal", { anonymousRead: false, policy: { maxFileSize: 1024, blobRedirect: null } });
    expect(r).toMatchObject({ anonymousRead: false, policy: { maxFileSize: 1024 } });
    expect(r.updatedAt).not.toBe(before.updatedAt);
    const again = await updateRepo("apt", "ubuntu-internal", { anonymousRead: false });
    expect(again.updatedAt).toBe(r.updatedAt);
    await expect(updateRepo("apt", "ubuntu-internal", { policy: { maven: { sessionTimeout: "45m" } } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^policy\.maven/) });
    signIn("admin");
    await expect(updateRepo("maven", "releases", { policy: { maven: { sessionTimeout: "45x" } } })).rejects.toMatchObject({ message: expect.stringMatching(/^policy\.maven\.sessionTimeout/) });
    await expect(updateRepo("maven", "releases", { policy: { maven: { maxSessionFiles: 1000 } } })).rejects.toMatchObject({ status: 400 });
    await expect(updateRepo("oci", "all", { policy: { maxFileSize: 1 } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^policy: a group/) });
  });

  it("merges a proxy's upstream; another upstream, other members or other routes need the admin role", async () => {
    // carol maintains the oci repos for this test.
    bindings.push({ id: 99, principal: "user:carol", role: "maintainer", repoMask: "oci/*", createdAt: new Date().toISOString() });
    signIn("carol");
    const hub = await updateRepo("oci", "hub", { upstream: { name: "dockerhub", metadataTTL: "1h", deny: ["acme/*", "corp/*"] } });
    expect(hub.upstream).toEqual({ name: "dockerhub", metadataTTL: "1h", negativeTTL: "2m", offline: false, allow: [], deny: ["acme/*", "corp/*"] });
    expect((await updateRepo("oci", "hub", { upstream: { metadataTTL: null } })).upstream?.metadataTTL).toBe("10m");
    await expect(updateRepo("oci", "hub", { upstream: { name: "quay" } })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/^upstream\.name/) });
    await expect(updateRepo("oci", "hub", { upstream: { metadataTTL: "-1s" } })).rejects.toMatchObject({ status: 400 });

    const all = await get("oci", "all");
    // The members sent back as they are need manage alone; in another order, the admin role.
    await updateRepo("oci", "all", { group: { members: all.group!.members } });
    await expect(updateRepo("oci", "all", { group: { members: [...all.group!.members].reverse() } })).rejects.toMatchObject({ status: 403 });
    await expect(updateRepo("oci", "all", { group: { paths: { hub: ["library/*"] } } })).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/^group\.paths/) });
    bindings.pop();

    signIn("admin");
    const changed = await updateRepo("oci", "all", { group: { members: ["internal", "hub"], paths: { ghcr: null } } });
    expect(changed.group).toEqual({ members: ["internal", "hub"], paths: { internal: ["acme/*"], hub: ["*"] } });
    await expect(updateRepo("oci", "all", { group: { members: ["internal", "hub", "ghcr"] } })).rejects.toMatchObject({ message: expect.stringMatching(/^group\.paths\.ghcr/) });
    await updateRepo("oci", "all", { group: { members: ["internal", "hub", "ghcr"], paths: { ghcr: ["oras-project/*", "sigstore/*"] } } });

    await expect(updateRepo("oci", "internal", { upstream: { offline: true } })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^upstream: only a proxy/) });
    await expect(updateRepo("oci", "hub", { kind: "hosted" })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^kind: format oci/) });
    await expect(updateRepo("oci", "hub", { kind: "hosted", anonymousRead: true })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a prefetch of an offline proxy (409), and takes it again once online", async () => {
    signIn("admin");
    await updateRepo("oci", "ghcr", { upstream: { offline: true } });
    await expect(prefetch("oci", "ghcr", { images: ["oras-project/oras:v1"], platforms: ["linux/amd64"] })).rejects.toMatchObject({ status: 409 });
    await updateRepo("oci", "ghcr", { upstream: { offline: false } });
  });
});

describe("delete", () => {
  it("refuses a member of a group, deletes a group without force and its members stay, and needs force for versions", async () => {
    signIn("admin");
    await createRepo({ format: "oci", name: "pair", kind: "group", group: { members: ["internal"], paths: { internal: ["*"] } } });
    await expect(deleteRepo("oci", "internal", true)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("oci/pair") });
    await deleteRepo("oci", "pair", false);
    await expect(get("oci", "pair")).rejects.toMatchObject({ status: 404 });
    expect((await get("oci", "internal")).kind).toBe("hosted");

    await expect(deleteRepo("pypi", "payments", false)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("force=true") });
    signIn("alice");
    await expect(deleteRepo("pypi", "payments", true)).rejects.toMatchObject({ status: 403 });
    signIn("admin");
    await deleteRepo("pypi", "payments", true);
    const list = await apiGet<{ repos: Repo[] }>(apiPath("repos"));
    expect(list.repos.some((r) => r.format === "pypi" && r.name === "payments")).toBe(false);
  });
});

describe("reindex", () => {
  afterEach(() => vi.useRealTimers());

  it("starts a run, refuses a second while it runs (409), and answers the report when it is done", async () => {
    signIn("admin");
    await createRepo({ format: "raw", name: "fresh", registry: "ci-distribution" });
    // No run has covered a repo created since the reconcile loop's.
    await expect(apiGet(apiPath("repos", "raw", "fresh", "reindex"))).rejects.toMatchObject({ status: 404 });

    vi.useFakeTimers({ toFake: ["Date"] });
    const run = await startReindex("raw", "scratch", { prune: true, verify: true });
    expect(run).toMatchObject({ state: "running", allRepos: false, prune: true, verify: true, report: null });
    expect((await get("raw", "scratch")).reindex?.state).toBe("running");
    await expect(startReindex("raw", "scratch", {})).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/runs on .* since /) });
    expect(pollInterval(run, Date.now())).toBe(1000);

    vi.setSystemTime(Date.now() + 5000);
    const done = await apiGet<ReindexRun>(apiPath("repos", "raw", "scratch", "reindex"));
    expect(done.state).toBe("done");
    expect(done.report?.removed).toBe(1);
    // ci-distribution has no referrers API: verify pushed the referrers indexes again.
    expect(done.report?.repairedReferrers?.length).toBeGreaterThan(0);
    expect(pollInterval(done, Date.now())).toBe(false);
    expect((await get("raw", "scratch")).reindex?.state).toBe("idle");
  });

  it("says when a run of every repo covers it, and needs manage", async () => {
    signIn("admin");
    await expect(startReindex("maven", "payments", {})).rejects.toMatchObject({ status: 409, message: expect.stringContaining("every repo") });
    await expect(startReindex("raw", "assets", { force: true } as never)).rejects.toMatchObject({ status: 400 });
    signIn("alice");
    await expect(startReindex("raw", "assets", {})).rejects.toMatchObject({ status: 403 });
  });
});

describe("anonymousRead and the policy, optimistic", () => {
  async function watching() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const options of [reposQuery, repoQuery("raw", "assets")]) {
      const o = new QueryObserver(client, options as never);
      o.subscribe(() => {});
    }
    await vi.waitFor(() => expect(client.getQueryData(repoQuery("raw", "assets").queryKey)).toBeDefined());
    await vi.waitFor(() => expect(client.getQueryData(reposQuery.queryKey)).toBeDefined());
    return client;
  }
  const assets = { format: "raw", name: "assets", prefix: "raw/assets" };

  it("shows the change in the repo and the list at once, and keeps it once the server has it", async () => {
    signIn("admin");
    const client = await watching();
    const m = new MutationObserver(client, settingChange(assets));
    const done = m.mutate({ anonymousRead: false });
    await vi.waitFor(() => expect(client.getQueryData<Repo>(repoQuery("raw", "assets").queryKey)?.anonymousRead).toBe(false));
    expect(client.getQueryData<Repo[]>(reposQuery.queryKey)?.find((r) => r.prefix === "raw/assets")?.anonymousRead).toBe(false);
    await done;
    expect((await get("raw", "assets")).anonymousRead).toBe(false);
  });

  it("goes back to the server's policy when it refuses, with a notice", async () => {
    signIn("admin");
    const client = await watching();
    const before = client.getQueryData<Repo>(repoQuery("raw", "assets").queryKey)!.policy;
    const m = new MutationObserver(client, settingChange(assets));
    const done = m.mutate({ policy: { maxFileSize: 0 } }).catch(() => undefined);
    await vi.waitFor(() => expect(client.getQueryData<Repo>(repoQuery("raw", "assets").queryKey)?.policy?.maxFileSize).toBe(0));
    await done;
    expect(client.getQueryData<Repo>(repoQuery("raw", "assets").queryKey)?.policy).toEqual(before);
    expect(getNotices().at(-1)?.title).toBe("Change the policy of raw/assets: refused");
  });
});

describe("the forms", () => {
  it("merge and diff a policy as the server does", () => {
    expect(mergePolicy({ maxFileSize: 1, maven: { sessionTimeout: "30m" } }, { maxFileSize: null, maven: { sessionTimeout: null, versionPolicy: "snapshot" } })).toEqual({ maven: { versionPolicy: "snapshot" } });
    expect(mergePolicy({ maxFileSize: 1 }, { maxFileSize: null })).toBeNull();
    expect(policyPatch({ maxFileSize: 1, blobRedirect: "never" }, { maxFileSize: 2 })).toEqual({ maxFileSize: 2, blobRedirect: null });
    expect(policyPatch({ maven: { sessionTimeout: "30m" } }, { maven: { sessionTimeout: "30m" } })).toBeNull();
    expect(sizeParts(5 * 1024 ** 3)).toEqual({ value: "5", unit: "GiB" });
    expect(sizeParts(512 * 1024 ** 2)).toEqual({ value: "512", unit: "MiB" });
    expect(sizeBytes("1.5", "GiB")).toBe(1.5 * 1024 ** 3);
    expect(sizeBytes("", "GiB")).toBeUndefined();
  });

  it("send the keys of an upstream and a group that changed", () => {
    const u = { name: "dockerhub", metadataTTL: "10m", negativeTTL: "2m", offline: false, allow: [], deny: ["acme/*"] };
    expect(upstreamPatch(u, upstreamForm(u))).toBeNull();
    expect(upstreamPatch(u, { ...upstreamForm(u), metadataTTL: "", offline: true, deny: "acme/*\ncorp/*" })).toEqual({ metadataTTL: null, offline: true, deny: ["acme/*", "corp/*"] });
    const g = { members: ["internal", "hub", "ghcr"], paths: { internal: ["acme/*"], hub: ["*"], ghcr: ["oras-project/*"] } };
    expect(groupPatch("oci", g, { members: g.members, merge: "", paths: { internal: "acme/*", hub: "*", ghcr: "oras-project/*" } })).toBeNull();
    expect(groupPatch("oci", g, { members: ["hub", "internal"], merge: "", paths: { internal: "acme/*", hub: "*" } })).toEqual({
      members: ["hub", "internal"],
      paths: { internal: ["acme/*"], hub: ["*"], ghcr: null },
    });
    expect(groupPatch("npm", { members: ["a", "b"], merge: [] }, { members: ["a", "b"], merge: "lodash", paths: {} })).toEqual({ merge: ["lodash"] });
  });
});
