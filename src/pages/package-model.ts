import type { VersionSummary } from "@/api/types";
import type { Crumb } from "@/components/common";
import { shortDigest } from "@/lib/format";

export function packageCrumbs(format: string, repo: string, name: string, version?: string): Crumb[] {
  const crumbs: Crumb[] = [
    { label: "Repositories", to: "/" },
    { label: format, to: "/", search: { format } },
    { label: repo, to: "/$format/$repo", params: { format, repo } },
  ];
  if (format === "raw") {
    const parts = name.split("/");
    parts.slice(0, -1).forEach((p, i) =>
      crumbs.push({
        label: p,
        to: "/$format/$repo",
        params: { format, repo },
        search: { dir: parts.slice(0, i + 1).join("/") + "/" },
      }),
    );
    crumbs.push(
      version
        ? { label: parts.at(-1)!, to: "/$format/$repo/$", params: { format, repo, _splat: name } }
        : { label: parts.at(-1)! },
    );
  } else {
    crumbs.push(version ? { label: name, to: "/$format/$repo/$", params: { format, repo, _splat: name } } : { label: name });
  }
  if (version) crumbs.push({ label: format === "raw" ? shortDigest(version, 8) : version });
  return crumbs;
}

export type VersionGroup = {
  version: string;
  manifests: VersionSummary[];
  createdAt: string;
  size: number;
  files: number;
  signatures: number;
  sboms: number;
  uploadedBy: string | null;
  degraded: boolean;
};

export function groupVersions(list: VersionSummary[]): VersionGroup[] {
  const groups = new Map<string, VersionGroup>();
  for (const v of list) {
    const g = groups.get(v.version) ?? {
      version: v.version,
      manifests: [],
      createdAt: v.createdAt,
      size: 0,
      files: 0,
      signatures: 0,
      sboms: 0,
      uploadedBy: v.uploadedBy,
      degraded: false,
    };
    g.manifests.push(v);
    g.size += v.size;
    g.files += v.fileCount;
    g.signatures += v.referrers.signatures;
    g.sboms += v.referrers.sboms;
    g.degraded ||= v.degraded;
    if (v.createdAt > g.createdAt) g.createdAt = v.createdAt;
    groups.set(v.version, g);
  }
  return [...groups.values()];
}
