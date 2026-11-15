// The mock's yank, unyank, delete and batch delete (docs/api.md), through the client's calls and
// msw in node: who may, what they change, and the errors of the server.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath } from "@/api/client";
import { deleteVersion, deleteVersions, unyankVersion, yankVersion } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { AuditList, PackageList, VersionDetail, VersionSummary } from "@/api/types";

type VersionList = { versions: VersionSummary[] };

import { createToken } from "./auth";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

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
  const t = createToken({ user }, { name: `versions test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

/** The packages of a repo with their versions, newest first. */
async function versionsOf(format: string, repo: string) {
  const { packages } = await apiGet<PackageList>(apiPath("repos", format, repo, "packages"));
  return Promise.all(
    packages.map(async (p) => ({
      name: p.name,
      versions: (await apiGet<VersionList>(apiPath("repos", format, repo, "packages", p.name, "versions"))).versions,
    })),
  );
}

const detail = (format: string, repo: string, name: string, version: string) =>
  apiGet<VersionDetail>(apiPath("repos", format, repo, "packages", name, "versions", version));

describe("yank and unyank", () => {
  it("marks a pypi version yanked, with its reason, for a writer; an unyank clears it", async () => {
    signIn("carol");
    const [pkg] = await versionsOf("pypi", "internal");
    const version = pkg!.versions[0]!.version;

    await yankVersion("pypi", "internal", pkg!.name, version, "breaks proxies");
    expect((await detail("pypi", "internal", pkg!.name, version)).yanked).toEqual({ reason: "breaks proxies" });
    const list = await apiGet<VersionList>(apiPath("repos", "pypi", "internal", "packages", pkg!.name, "versions"));
    expect(list.versions.find((v) => v.version === version)?.yanked).toEqual({ reason: "breaks proxies" });

    // The same yank again changes nothing: one audit row.
    await yankVersion("pypi", "internal", pkg!.name, version, "breaks proxies");
    signIn("admin");
    const audit = await apiGet<AuditList>(apiPath("audit"), { action: "pypi.yank" });
    expect(audit.events.filter((e) => e.subject === `${pkg!.name}@${version}`)).toHaveLength(1);

    signIn("carol");
    await unyankVersion("pypi", "internal", pkg!.name, version);
    expect((await detail("pypi", "internal", pkg!.name, version)).yanked).toBeUndefined();
    await unyankVersion("pypi", "internal", pkg!.name, version);
  });

  it("refuses a reader, a repo that is not pypi, and a version that is not there", async () => {
    signIn("alice");
    const [pkg] = await versionsOf("pypi", "internal");
    await expect(yankVersion("pypi", "internal", pkg!.name, pkg!.versions[0]!.version, "")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    signIn("admin");
    const [raw] = await versionsOf("raw", "assets");
    await expect(yankVersion("raw", "assets", raw!.name, raw!.versions[0]!.version, "")).rejects.toMatchObject({ status: 400, code: "INVALID" });
    await expect(yankVersion("pypi", "internal", pkg!.name, "0.0.0-nope", "")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("delete a version", () => {
  it("deletes every variant when the digests are the ones read, and audits each", async () => {
    signIn("admin");
    const pkg = (await versionsOf("maven", "releases")).find((p) => p.versions.length > 1)!;
    const v = pkg.versions.at(-1)!;
    const digests = v.variants.map((x) => x.digest);

    await expect(deleteVersion("maven", "releases", pkg.name, v.version, ["sha256:" + "0".repeat(64)])).rejects.toMatchObject({ status: 412, code: "CONFLICT" });
    await deleteVersion("maven", "releases", pkg.name, v.version, digests);
    await expect(detail("maven", "releases", pkg.name, v.version)).rejects.toMatchObject({ status: 404 });
    const audit = await apiGet<AuditList>(apiPath("audit"), { action: "delete", repo: "maven/releases" });
    expect(audit.events.filter((e) => digests.includes(e.digest ?? ""))).toHaveLength(digests.length);
  });

  it("refuses a writer, and a registry that does not delete manifests", async () => {
    signIn("carol");
    const [pkg] = await versionsOf("pypi", "internal");
    const v = pkg!.versions[0]!;
    await expect(deleteVersion("pypi", "internal", pkg!.name, v.version, v.variants.map((x) => x.digest))).rejects.toMatchObject({ status: 403 });

    signIn("admin");
    // raw/scratch is on ci-distribution, whose capabilities.deleteManifest is false.
    const [scratch] = await versionsOf("raw", "scratch");
    const s = scratch!.versions[0]!;
    await expect(deleteVersion("raw", "scratch", scratch!.name, s.version, s.variants.map((x) => x.digest))).rejects.toMatchObject({
      status: 501,
      code: "UNAVAILABLE",
    });
    expect((await detail("raw", "scratch", scratch!.name, s.version)).version).toBe(s.version);
  });
});

describe("delete versions in a batch", () => {
  it("answers each item: deleted, changed, gone; a dry run deletes nothing", async () => {
    signIn("admin");
    const pkg = (await versionsOf("pypi", "payments")).find((p) => p.versions.length >= 2)!;
    const [a, b] = pkg.versions.slice(-2);
    const item = (v: typeof a, digests = v!.variants.map((x) => x.digest)) => ({ package: pkg.name, version: v!.version, digests });

    const dry = await deleteVersions("pypi", "payments", { items: [item(a)], dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, results: [{ status: "deleted" }] });
    expect((await detail("pypi", "payments", pkg.name, a!.version)).version).toBe(a!.version);

    const result = await deleteVersions("pypi", "payments", {
      items: [item(a), item(b, ["sha256:" + "1".repeat(64)]), { package: pkg.name, version: "0.0.0-nope", digests: ["sha256:" + "2".repeat(64)] }],
      job: "ui-test",
    });
    expect(result).toMatchObject({ job: "ui-test", dryRun: false });
    expect(result.results.map((r) => r.status)).toEqual(["deleted", "changed", "gone"]);
    expect(result.results[1]!.digests).toEqual(b!.variants.map((x) => x.digest));
    await expect(detail("pypi", "payments", pkg.name, a!.version)).rejects.toMatchObject({ status: 404 });

    const again = await deleteVersions("pypi", "payments", { items: [item(a)] });
    expect(again.results[0]!.status).toBe("gone");
  });

  it("says young for a version published after the cut-off, and refuses a body that is not one", async () => {
    signIn("admin");
    const [pkg] = await versionsOf("apt", "ubuntu-internal");
    const v = pkg!.versions[0]!;
    const result = await deleteVersions("apt", "ubuntu-internal", {
      items: [{ package: pkg!.name, version: v.version, digests: v.variants.map((x) => x.digest) }],
      cutoff: "2000-01-01T00:00:00Z",
    });
    expect(result.results[0]).toMatchObject({ status: "young", lastModified: v.lastModified });
    await expect(deleteVersions("apt", "ubuntu-internal", { items: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe("npm dist-tags as the pointers of a version", () => {
  const name = "@acme/widgets";

  it("lists the dist-tags that name each version, in the list and in the detail", async () => {
    signIn("alice");
    const list = await apiGet<VersionList>(apiPath("repos", "npm", "internal", "packages", name, "versions"));
    const pointed = Object.fromEntries(list.versions.map((v) => [v.version, v.pointers.map((p) => p.name)]));
    expect(pointed).toEqual({ "2.0.0-beta.1": ["beta"], "2.0.0-beta.0": [], "1.2.0": ["latest"], "1.1.0": ["stable"], "1.0.0": [] });
    expect((await detail("npm", "internal", name, "1.2.0")).pointers).toEqual([{ kind: "dist-tag", name: "latest" }]);
    // A version pushed with oras has no dist-tag.
    const [jsonstream] = (await apiGet<VersionList>(apiPath("repos", "npm", "internal", "packages", "JSONStream", "versions"))).versions;
    expect(jsonstream!.pointers).toEqual([]);
  });

  it("refuses to delete a version a dist-tag names unless forced", async () => {
    signIn("admin");
    const list = await apiGet<VersionList>(apiPath("repos", "npm", "internal", "packages", name, "versions"));
    const digests = list.versions.find((v) => v.version === "1.1.0")!.variants.map((x) => x.digest);

    await expect(deleteVersion("npm", "internal", name, "1.1.0", digests)).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    const batch = await deleteVersions("npm", "internal", { items: [{ package: name, version: "1.1.0", digests }] });
    expect(batch.results[0]).toMatchObject({ status: "protected", pointers: [{ kind: "dist-tag", name: "stable" }] });
    expect((await detail("npm", "internal", name, "1.1.0")).version).toBe("1.1.0");

    await deleteVersion("npm", "internal", name, "1.1.0", digests, true);
    await expect(detail("npm", "internal", name, "1.1.0")).rejects.toMatchObject({ status: 404 });
  });
});
