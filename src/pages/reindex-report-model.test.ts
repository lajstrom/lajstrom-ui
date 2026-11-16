import { describe, expect, it } from "vitest";

import type { ReindexReport } from "@/api/types";

import { isCut, MAX_FINDINGS, reportCounts, reportFindings, reportRepo, shortTag } from "./reindex-report-model";

/** A report of a clean run of raw/assets: counts, every list empty. */
function clean(over: Partial<ReindexReport> = {}): ReindexReport {
  return {
    repo: "raw/assets",
    ociRepositories: 3,
    manifests: 120,
    added: 2,
    updated: 0,
    unchanged: 117,
    removed: 1,
    pending: 0,
    deletedPending: 0,
    degraded: 0,
    referrers: 4,
    attachments: 4,
    foreign: [],
    orphanReferrers: [],
    orphanJournal: [],
    drift: [],
    split: [],
    repositoryUnknown: [],
    repairedReferrers: [],
    errors: [],
    blobMap: 0,
    skipped: "",
    truncated: false,
    ...over,
  };
}

const finding = { repository: "x", tag: "1.0" };

describe("reportCounts", () => {
  it("has every count of the report, in the server's order", () => {
    expect(reportCounts(clean()).map((c) => [c.label, c.value])).toEqual([
      ["OCI repositories", 3],
      ["Manifests", 120],
      ["Added", 2],
      ["Updated", 0],
      ["Unchanged", 117],
      ["Removed", 1],
      ["Pending", 0],
      ["Deleted, pending", 0],
      ["Degraded", 0],
      ["Referrers", 4],
      ["Attachments", 4],
    ]);
    // An encrypted repo's run counts its blob map too.
    expect(reportCounts(clean({ blobMap: 7 })).at(-1)).toMatchObject({ label: "Blob map", value: 7 });
  });

  it("warns of pending, deleted pending and degraded rows only when there are some", () => {
    expect(reportCounts(clean()).filter((c) => c.warn)).toEqual([]);
    const warned = reportCounts(clean({ pending: 2, deletedPending: 1, degraded: 3, removed: 5 })).filter((c) => c.warn);
    expect(warned.map((c) => c.label)).toEqual(["Pending", "Deleted, pending", "Degraded"]);
  });
});

describe("reportFindings", () => {
  it("lists nothing for a clean run, nor for the null lists of a run of an earlier release", () => {
    expect(reportFindings(clean())).toEqual([]);
    expect(reportFindings(clean({ orphanJournal: null, split: null, repositoryUnknown: null, repairedReferrers: null }))).toEqual([]);
  });

  it("lists the lists with entries, errors first and the only reported ones last", () => {
    const r = clean({
      foreign: [finding],
      errors: [{ repository: "", error: "list the OCI repositories: 503" }],
      drift: [{ package: "a", tag: "1.0", index: "sha256:1", registry: "sha256:2" }],
      orphanJournal: [finding, finding],
    });
    expect(reportFindings(r).map((f) => [f.key, f.count, f.tone])).toEqual([
      ["errors", 1, "danger"],
      ["drift", 1, "warning"],
      ["foreign", 1, "neutral"],
      ["orphanJournal", 2, "neutral"],
    ]);
  });

  it("marks a list of a truncated report as cut when it is full, and only then", () => {
    const full = Array.from({ length: MAX_FINDINGS }, () => finding);
    const cut = (r: ReindexReport) => reportFindings(r).map((f) => [f.key, f.cut]);
    expect(cut(clean({ truncated: true, foreign: full, errors: [finding] }))).toEqual([
      ["errors", false],
      ["foreign", true],
    ]);
    // A list of 1000 in a report that is not truncated is all there is.
    expect(cut(clean({ foreign: full }))).toEqual([["foreign", false]]);
    expect(isCut({ truncated: true }, full)).toBe(true);
    expect(isCut({ truncated: true }, full.slice(1))).toBe(false);
  });
});

describe("reportRepo", () => {
  it("splits <format>/<name>", () => {
    expect(reportRepo({ repo: "pypi/internal" })).toEqual({ format: "pypi", name: "internal" });
  });
});

describe("shortTag", () => {
  const hex = "406d52249e11" + "0".repeat(52);
  it("shortens the hex of the referrers tag schema, with cosign's suffix", () => {
    expect(shortTag(`sha256-${hex}.sig`)).toBe("sha256-406d52249e11….sig");
    expect(shortTag(`sha256-${hex}`)).toBe("sha256-406d52249e11…");
  });

  it("keeps any other tag", () => {
    for (const t of ["1.2.0__py3-none-any", "_j00000001", "latest", "sha256-abc.sig"]) expect(shortTag(t)).toBe(t);
  });
});
