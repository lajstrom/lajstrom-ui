// A raw repo's packages are file paths. GET …/packages?prefix=<dir>/ answers the subtree of a
// directory, every file below it; the packages tab shows it one level at a time, as a file tree.

import type { PackageSummary } from "@/api/types";

/** A subdirectory, with what the page has of the files below it. */
export type RawDirectory = {
  name: string;
  /** Its path from the repo's root, with a slash at the end: docs/2026/ */
  path: string;
  files: number;
  size: number;
  updatedAt: string;
};

/** The level of dir, "" for the root or a path that ends with a slash, in a page of its subtree:
 * its subdirectories by name, and its own files in the order of the page. */
export function rawLevel(dir: string, packages: PackageSummary[]): { directories: RawDirectory[]; files: PackageSummary[] } {
  const dirs = new Map<string, RawDirectory>();
  const files: PackageSummary[] = [];
  for (const p of packages) {
    if (!p.name.startsWith(dir)) continue;
    const rest = p.name.slice(dir.length);
    const slash = rest.indexOf("/");
    if (slash === -1) {
      files.push(p);
      continue;
    }
    const name = rest.slice(0, slash);
    const d = dirs.get(name) ?? { name, path: `${dir}${name}/`, files: 0, size: 0, updatedAt: "" };
    d.files += 1;
    d.size += p.size;
    if (p.updatedAt > d.updatedAt) d.updatedAt = p.updatedAt;
    dirs.set(name, d);
  }
  return { directories: [...dirs.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)), files };
}
