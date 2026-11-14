import type { PackageDetail, PackageFacts, VariantSummary, VersionDetail, VersionSummary } from "@/api/types";
import type { Crumb } from "@/components/common";
import { shortDigest } from "@/lib/format";
import type { FormatSpec } from "@/lib/formats";
import { packagePath } from "@/lib/profile";

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

/** A row of the version table: a version of the server's list, and the sums over its variants
 * when the answer has the proposed counts (null when it does not). */
export type VersionGroup = {
  version: string;
  variants: VariantSummary[];
  publishedAt: string;
  lastModified: string;
  size: number | null;
  signatures: number | null;
  degraded: boolean;
  /** lajstrom.uploaded-by of the first variant, when the answer has the attributes. */
  uploadedBy: string | null;
  yanked: VersionSummary["yanked"];
};

function sum(variants: VariantSummary[], of: (v: VariantSummary) => number | undefined): number | null {
  let total = 0;
  for (const v of variants) {
    const n = of(v);
    if (n === undefined) return null;
    total += n;
  }
  return total;
}

export function groupVersions(list: VersionSummary[]): VersionGroup[] {
  return list.map((v) => ({
    version: v.version,
    variants: v.variants,
    publishedAt: v.publishedAt,
    lastModified: v.lastModified,
    size: sum(v.variants, (x) => x.size),
    signatures: sum(v.variants, (x) => x.referrers?.signatures),
    degraded: v.variants.some((x) => x.degraded),
    uploadedBy: v.variants[0]?.attrs?.["lajstrom.uploaded-by"] ?? null,
    yanked: v.yanked,
  }));
}

/** What the package page shows: the proposed package resource, or what the versions tell. */
export type PackageInfo = Pick<PackageDetail, "name" | "createdAt" | "ociRepository"> &
  Partial<PackageFacts> & { latestMetadata?: Record<string, unknown> | null };

/** The package from a server without GET …/packages/{name}: its versions, newest first, and the
 * newest version in detail once it is loaded. */
export function derivePackage(
  format: string,
  repo: string,
  name: string,
  versions: VersionSummary[],
  latest: VersionDetail | undefined,
  spec: FormatSpec,
): PackageInfo {
  const nameOci = packagePath(format, name);
  const groups = groupVersions(versions);
  const metadata = latest?.variants[0]?.metadata;
  const about = metadata === undefined ? undefined : spec.metadataRows(metadata).find((r) => r.label === "Summary" || r.label === "Description");
  const sizes = groups.map((g) => g.size);
  return {
    name,
    nameOci,
    createdAt: versions.at(-1)?.publishedAt ?? "",
    updatedAt: versions.reduce((m, v) => (v.lastModified > m ? v.lastModified : m), ""),
    latestVersion: versions[0]?.version ?? null,
    versions: versions.length,
    manifests: versions.reduce((n, v) => n + v.variants.length, 0),
    latestVariants: versions[0]?.variants.map((v) => v.variant).filter(Boolean) ?? [],
    ...(sizes.every((s) => s !== null) ? { size: sizes.reduce<number>((n, s) => n + s!, 0) } : {}),
    ...(about ? { summary: Array.isArray(about.value) ? about.value.join(" ") : about.value } : {}),
    ociRepository: latest?.ociRepository ?? `${format}/${repo}/${nameOci}`,
    latestMetadata: metadata,
  };
}
