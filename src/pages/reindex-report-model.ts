// What the reindex tab shows of a run's report (ReindexRun.report in the server's openapi.yaml;
// docs/operations.md, Reindex): its counts, and the lists that have entries.

import type { ReindexReport } from "@/api/types";

/** Each list of a report stops at this many entries; the counts stay exact. */
export const MAX_FINDINGS = 1000;

export type ReportCount = {
  label: string;
  value: number;
  /** What it counts, from the server's description of the field. */
  hint: string;
  /** A count above zero that asks for a look. */
  warn: boolean;
};

/** The counts of a report, in the server's order: what the run read, then what it did with the
 * rows. A count that a run of an earlier release did not write is 0; the blob map, which only an
 * encrypted repo has, only when it counts any. */
export function reportCounts(r: ReindexReport): ReportCount[] {
  const counts: [string, number, string, boolean?][] = [
    ["OCI repositories", r.ociRepositories, "The OCI repositories under the repo's path."],
    ["Manifests", r.manifests, "The tags read."],
    ["Added", r.added, "The rows written that the index did not have: versions and journal entries."],
    ["Updated", r.updated, "The rows read again, with verify or as degraded, and written."],
    ["Unchanged", r.unchanged, "The rows seen with the digest the index has."],
    ["Removed", r.removed, "The rows removed, their manifests gone from the registry (prune)."],
    [
      "Pending",
      r.pending,
      "The rows whose manifest the registry answered unknown: kept until it answers so twice, at least 10 minutes apart, and the row is reconcile.graceAge old.",
      true,
    ],
    [
      "Deleted, pending",
      r.deletedPending,
      "The tags the registry still lists after a delete through Lajstrom less than reconcile.graceAge before the run: not indexed again.",
      true,
    ],
    ["Degraded", r.degraded, "The versions written from their annotations, their metadata layer unreadable; every run reads them again.", true],
    ["Referrers", r.referrers, "The referrers listed (signatures, SBOMs, attestations), each digest once."],
    ["Attachments", r.attachments, "The attachment rows of the versions seen or written."],
  ];
  if (r.blobMap) counts.push(["Blob map", r.blobMap, "The rows of blob_map of an encrypted repo written or seen."]);
  return counts.map(([label, value, hint, warn = false]) => ({ label, value, hint, warn: warn && value > 0 }));
}

export type FindingKey =
  | "errors"
  | "drift"
  | "split"
  | "repositoryUnknown"
  | "foreign"
  | "orphanReferrers"
  | "orphanJournal"
  | "repairedReferrers";

export type FindingSection = {
  key: FindingKey;
  label: string;
  tone: "danger" | "warning" | "neutral";
  count: number;
  /** The list stopped at MAX_FINDINGS entries: there are more. */
  cut: boolean;
};

/** The lists of a report, in the order the tab shows them: what failed, then what needs a
 * decision, then what is only reported. */
const lists: Omit<FindingSection, "count" | "cut">[] = [
  { key: "errors", label: "Errors", tone: "danger" },
  { key: "drift", label: "Drift", tone: "warning" },
  { key: "split", label: "Split packages", tone: "warning" },
  { key: "repositoryUnknown", label: "Repository unknown", tone: "warning" },
  { key: "foreign", label: "Foreign manifests", tone: "neutral" },
  { key: "orphanReferrers", label: "Orphan referrers", tone: "neutral" },
  { key: "orphanJournal", label: "Orphan journal entries", tone: "neutral" },
  { key: "repairedReferrers", label: "Referrers indexes pushed again", tone: "neutral" },
];

/** Whether a list of a truncated report is one that stopped: it holds MAX_FINDINGS entries. */
export function isCut(r: Pick<ReindexReport, "truncated">, list: readonly unknown[]): boolean {
  return r.truncated && list.length >= MAX_FINDINGS;
}

/** The lists of a report that have entries. A list that a run of an earlier release did not
 * write is null, and shows as empty. */
export function reportFindings(r: ReindexReport): FindingSection[] {
  return lists.flatMap((l) => {
    const list = r[l.key] ?? [];
    return list.length ? [{ ...l, count: list.length, cut: isCut(r, list) }] : [];
  });
}

/** The format and the name of the report's repo, "<format>/<name>". */
export function reportRepo(r: Pick<ReindexReport, "repo">): { format: string; name: string } {
  const i = r.repo.indexOf("/");
  return { format: r.repo.slice(0, i), name: r.repo.slice(i + 1) };
}

/** A tag of the referrers tag schema, sha256-<hex>[.sig|.att|.sbom], with its hex shortened:
 * sha256-9f3a0c1b2d4e….sig. Any other tag as it is. */
export function shortTag(tag: string, keep = 12): string {
  const m = /^sha256-([0-9a-f]{64})(\.[a-z]+)?$/.exec(tag);
  return m ? `sha256-${m[1]!.slice(0, keep)}…${m[2] ?? ""}` : tag;
}
