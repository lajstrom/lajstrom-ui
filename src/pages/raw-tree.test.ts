import { describe, expect, it } from "vitest";

import type { PackageSummary } from "@/api/types";

import { rawLevel } from "./raw-tree";

function file(name: string, size: number, updatedAt: string): PackageSummary {
  return {
    name,
    nameOci: name,
    createdAt: updatedAt,
    updatedAt,
    latestVersion: null,
    latestVariants: [],
    lastPublished: null,
    versions: 1,
    manifests: 1,
    size,
    summary: null,
    attrs: {},
    pointers: [],
  };
}

describe("rawLevel", () => {
  const page = [
    file("README.md", 10, "2026-11-01T00:00:00Z"),
    file("docs/a.pdf", 100, "2026-11-02T00:00:00Z"),
    file("docs/2026/b.pdf", 200, "2026-11-05T00:00:00Z"),
    file("bin/tool", 5, "2026-11-03T00:00:00Z"),
  ];

  it("folds the subtree into the root's subdirectories, with what the page has of each, and its files", () => {
    const { directories, files } = rawLevel("", page);
    expect(directories).toEqual([
      { name: "bin", path: "bin/", files: 1, size: 5, updatedAt: "2026-11-03T00:00:00Z" },
      { name: "docs", path: "docs/", files: 2, size: 300, updatedAt: "2026-11-05T00:00:00Z" },
    ]);
    expect(files.map((f) => f.name)).toEqual(["README.md"]);
  });

  it("shows one level below a directory", () => {
    const { directories, files } = rawLevel("docs/", page);
    expect(directories.map((d) => d.path)).toEqual(["docs/2026/"]);
    expect(files.map((f) => f.name)).toEqual(["docs/a.pdf"]);
  });
});
