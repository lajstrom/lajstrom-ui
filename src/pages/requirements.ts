import { useQueries } from "@tanstack/react-query";

import { unmetQuery } from "@/api/requirements";
import type { Repo, Requirement } from "@/api/types";

/** A requirement of the repo, and what it leaves out of a package: its versions and the digests
 * of their variants that lack the attachment; undefined while they load. */
export type Withheld = { requirement: Requirement; versions: Set<string> | undefined; digests: Set<string> | undefined };

/** What each required attachment of the repo (policy.md §11) leaves out of the package, as the
 * server answers ?unmet=: a version is withheld while any of its variants is. */
export function useWithheld(repo: Repo | undefined, name: string): Withheld[] {
  const reqs = repo?.policy?.requireAttachments ?? [];
  const results = useQueries({ queries: reqs.map((r) => unmetQuery(repo!.format, repo!.name, name, r)) });
  return reqs.map((requirement, i) => {
    const data = results[i]?.data;
    return {
      requirement,
      versions: data ? new Set(data.map((v) => v.version)) : undefined,
      digests: data ? new Set(data.flatMap((v) => v.variants.map((x) => x.digest))) : undefined,
    };
  });
}
