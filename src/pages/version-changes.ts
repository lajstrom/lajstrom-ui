// The changes of a version (docs/adr/0003-changes-realistic-by-default.md): yank and unyank are
// optimistic, with Undo in the notice; a delete, of one version or of a batch, is confirmed, then
// realistic.

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { optimistic, realistic, update } from "@/api/change";
import { deleteVersion, deleteVersions, unyankVersion, yankVersion } from "@/api/mutations";
import { versionQuery, versionsQuery } from "@/api/queries";
import type { BatchDeleteRequest, Repo, VersionDetail, VersionSummary, Yank } from "@/api/types";
import { can } from "@/lib/access";
import { notify } from "@/lib/notices";

/** Whether the UI offers yank and unyank on the versions of the repo: a hosted pypi repo, write. */
export const yanks = (repo: Repo) => repo.format === "pypi" && repo.kind === "hosted" && can(repo, "write");

/** Whether the UI offers to delete the versions of the repo: delete; a group has none of its own. */
export const deletes = (repo: Repo) => repo.kind !== "group" && can(repo, "delete");

/** A yank, or an unyank (yanked null), of one version: what it becomes and what it was, which
 * Undo puts back. */
export type YankChange = { version: string; yanked: Yank | null; before: Yank | null; undo?: boolean };

function withYank<T extends { version: string; yanked?: Yank }>(v: T, change: YankChange): T {
  if (v.version !== change.version) return v;
  const { yanked: _, ...rest } = v;
  return (change.yanked ? { ...rest, yanked: change.yanked } : rest) as T;
}

/** Yank and unyank, optimistic in the version list and on the version's page. */
export function useYank(format: string, repo: string, name: string) {
  const list = versionsQuery(format, repo, name).queryKey;
  const mutation = useMutation({
    mutationKey: ["yank", ...list],
    mutationFn: (c: YankChange) =>
      c.yanked ? yankVersion(format, repo, name, c.version, c.yanked.reason) : unyankVersion(format, repo, name, c.version),
    ...optimistic({
      updates: (c: YankChange) => [
        update(list, (versions: VersionSummary[]) => versions.map((v) => withYank(v, c))),
        update(versionQuery(format, repo, name, c.version).queryKey, (d: VersionDetail) => withYank(d, c)),
      ],
      describe: (c) => `${c.yanked ? "Yank" : "Unyank"} ${name} ${c.version}`,
    }),
    onSuccess: (_, c) => {
      notify({
        tone: "success",
        title: `${c.yanked ? "Yanked" : "Unyanked"} ${name} ${c.version}`,
        description: c.yanked ? (c.yanked.reason ? `Reason: ${c.yanked.reason}` : "pip skips it unless a requirement pins it with ==.") : null,
        action: c.undo ? undefined : { label: "Undo", run: () => mutation.mutate({ version: c.version, yanked: c.before, before: c.yanked, undo: true }) },
      });
    },
  });
  return mutation;
}

/** A delete of one version: every variant, if they still have the digests read; `last` when it
 * is the package's only version, whose page then goes too. */
export type VersionDelete = { version: string; digests: string[]; force: boolean; last: boolean };

/** Deletes one version, then leaves its page for the package's, or the repo's after the last
 * version, and fetches the repo's queries again. */
export function useDeleteVersion(format: string, repo: string, name: string) {
  const navigate = useNavigate();
  const { onSuccess: refetch } = realistic(["repos", format, repo]);
  return useMutation({
    mutationFn: (d: VersionDelete) => deleteVersion(format, repo, name, d.version, d.digests, d.force),
    onSuccess: async (data, d, result, context) => {
      notify({ tone: "success", title: `Deleted ${name} ${d.version}` });
      // Away from the version's page first, so that it is not fetched again only to be a 404.
      await navigate(d.last ? { to: "/$format/$repo", params: { format, repo } } : { to: "/$format/$repo/$", params: { format, repo, _splat: name } });
      await refetch(data, d, result, context);
    },
  });
}

/** Deletes versions of a package in a batch; the answer has a result per item. When every one
 * of its `total` versions went, the package is gone: the repo's page shows what is left. */
export function useDeleteVersions(format: string, repo: string, name: string, total: number) {
  const navigate = useNavigate();
  const { onSuccess: refetch } = realistic(["repos", format, repo]);
  return useMutation({
    mutationFn: (items: BatchDeleteRequest["items"]) => deleteVersions(format, repo, { items }),
    onSuccess: async (data, items, result, context) => {
      if (items.length === total && data.results.every((r) => r.status === "deleted")) {
        notify({ tone: "success", title: `Deleted every version of ${name}`, description: "The package is gone with them." });
        await navigate({ to: "/$format/$repo", params: { format, repo } });
      }
      await refetch(data, items, result, context);
    },
  });
}
