// The mock's report of the last reindex run (GET …/reindex; ReindexRun.report in openapi.yaml),
// through the client and msw in node: pypi/internal has an entry of each list, built from its
// rows, and the request a "repository unknown" entry names deletes it.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath, apiSend } from "@/api/client";
import { setSession } from "@/api/session";
import type { PackageList, ReindexReport, ReindexRun, VersionSummary } from "@/api/types";
import { tagFor } from "@/lib/profile";

import { createToken } from "./auth";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
  const t = createToken({ user: "admin" }, { name: "reindex test", expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user: "admin", tokenId: t.id, expiresAt: null });
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

async function report(format: string, repo: string): Promise<ReindexReport> {
  const run = await apiGet<ReindexRun>(apiPath("repos", format, repo, "reindex"));
  expect(run.report).not.toBeNull();
  return run.report!;
}

const versions = (repo: string, name: string) =>
  apiGet<{ versions: VersionSummary[] }>(apiPath("repos", "pypi", repo, "packages", name, "versions")).then((l) => l.versions);

describe("the report of the last reindex", () => {
  it("has an entry of each list in pypi/internal", async () => {
    const r = await report("pypi", "internal");
    for (const list of ["foreign", "orphanReferrers", "orphanJournal", "drift", "split", "repositoryUnknown", "errors"] as const) {
      expect(r[list]?.length, list).toBeGreaterThan(0);
    }
    expect(r.truncated).toBe(false);
    expect(r.orphanJournal!.map((f) => f.tag)).toEqual(["_j00000001", "_j00000002"]);
    expect(r.orphanReferrers[0]!.tag).toBe(`sha256-${r.orphanReferrers[0]!.subject!.slice("sha256:".length)}.sig`);
  });

  it("names the rows of the index as the version list has them", async () => {
    const r = await report("pypi", "internal");

    const [drift] = r.drift;
    const variant = (await versions("internal", drift!.package)).flatMap((v) => v.variants).find((x) => x.tag === drift!.tag);
    expect(drift!.index).toBe(variant!.digest);
    expect(drift!.registry).not.toBe(drift!.index);

    const [split] = r.split!;
    const tags = (await versions("internal", split!.package)).flatMap((v) => v.variants.map((x) => x.tag));
    expect(split!.indexedTags).toEqual([...tags].sort());
    expect(split!.other).not.toBe(split!.indexed);
    expect(split!.otherTags.every((t) => tags.includes(t))).toBe(true);

    for (const u of r.repositoryUnknown!) {
      expect(u.tag).toBe(tagFor(u.version, u.variant));
      expect(u.delete).toBe(
        `DELETE /api/v1/repos/pypi/internal/packages/${encodeURIComponent(u.package)}/versions/${encodeURIComponent(u.version)}?variant=${u.variant}`,
      );
    }
  });

  it("counts the rows the run saw: not those of an unknown repository, a drifted one apart", async () => {
    const r = await report("pypi", "internal");
    const { packages } = await apiGet<PackageList>(apiPath("repos", "pypi", "internal", "packages"));
    const rows = (await Promise.all(packages.map((p) => versions("internal", p.name)))).flat().flatMap((v) => v.variants).length;
    expect(r.unchanged + r.updated + r.drift.length).toBe(rows - r.repositoryUnknown!.length);
    expect(r.updated).toBe(r.degraded);
  });

  it("drops an unknown repository's version once its request deleted it", async () => {
    const [u] = (await report("pypi", "internal")).repositoryUnknown!;
    const target = new URL(u!.delete.slice("DELETE ".length), "http://localhost");
    await apiSend("DELETE", target.pathname, { query: Object.fromEntries(target.searchParams) });

    const after = await report("pypi", "internal");
    expect(after.repositoryUnknown!.map((x) => x.digest)).not.toContain(u!.digest);
    expect(after.repositoryUnknown!.length).toBeGreaterThan(0);
  });

  it("has empty lists elsewhere, and keeps the foreign manifests of the raw repos", async () => {
    const apt = await report("apt", "ubuntu-internal");
    for (const list of ["foreign", "orphanReferrers", "orphanJournal", "drift", "split", "repositoryUnknown", "repairedReferrers", "errors"] as const) {
      expect(apt[list], list).toEqual([]);
    }
    expect((await report("raw", "assets")).foreign.map((f) => f.repository)).toEqual(["charts/podinfo"]);
    expect((await report("raw", "scratch")).foreign.map((f) => f.repository)).toEqual(["tmp/debug-image"]);
  });
});
