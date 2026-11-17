// The changes of a repo (docs/adr/0003-changes-realistic-by-default.md): anonymousRead and the
// policy are optimistic; a create, a proxy's upstream and a group's members are realistic; a
// delete is confirmed, then realistic; a reindex is realistic, and its run is polled.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { optimistic, realistic, update } from "@/api/change";
import { pollsAllowed } from "@/api/idle";
import { createRepo, deleteRepo, startReindex, updateRepo } from "@/api/mutations";
import { reindexQuery, repoQuery, reposQuery } from "@/api/queries";
import type { CreateRepoRequest, PolicyPatch, ReindexRequest, ReindexRun, Repo, RepoPatch } from "@/api/types";
import { useIdle } from "@/app/idle";
import { can } from "@/lib/access";
import { notify } from "@/lib/notices";

import { mergePolicy } from "./repo-form";

/** Whether the UI offers to change, delete and reindex the repo: manage (rbac.md §2). */
export const manages = (repo: Repo) => can(repo, "manage");

/** Whether the UI offers a reindex: manage, and not a group, which holds nothing to reindex. */
export const reindexes = (repo: Repo) => manages(repo) && repo.kind !== "group";

/** A change the screen shows at once: the switch of anonymous read, or a merge patch of the
 * policy. */
export type RepoSetting = { anonymousRead: boolean } | { policy: PolicyPatch };

/** The mutation key of a repo's optimistic changes, for useChanges. */
export const settingKey = (format: string, name: string) => ["repo-setting", format, name];

/** What a change is of, so that each shows its own refusal. */
export const settingOf = (s: RepoSetting) => ("anonymousRead" in s ? "anonymousRead" : "policy");

function applySetting(r: Repo, s: RepoSetting): Repo {
  return "anonymousRead" in s ? { ...r, anonymousRead: s.anonymousRead } : { ...r, policy: mergePolicy(r.policy, s.policy) };
}

/** The options of the optimistic change of anonymousRead or the policy: the repo's page and the
 * list show it at once, and go back to the server's state if it refuses. */
export function settingChange(repo: Pick<Repo, "format" | "name" | "prefix">) {
  return {
    mutationKey: settingKey(repo.format, repo.name),
    mutationFn: (s: RepoSetting) => updateRepo(repo.format, repo.name, s),
    ...optimistic({
      updates: (s: RepoSetting) => [
        update(repoQuery(repo.format, repo.name).queryKey, (r: Repo) => applySetting(r, s)),
        update(reposQuery.queryKey, (list: Repo[]) => list.map((r) => (r.prefix === repo.prefix ? applySetting(r, s) : r))),
      ],
      describe: (s: RepoSetting) =>
        "anonymousRead" in s ? `Turn ${s.anonymousRead ? "on" : "off"} anonymous read of ${repo.prefix}` : `Change the policy of ${repo.prefix}`,
    }),
  };
}

export function useSetting(repo: Repo) {
  return useMutation(settingChange(repo));
}

/** A change of a proxy's upstream or of a group's members: realistic, the form waits for the
 * server and shows its refusal at the field. */
export function useRepoUpdate(repo: Repo) {
  const { onSuccess: refetch } = realistic(["repos"]);
  return useMutation({
    mutationFn: (patch: RepoPatch) => updateRepo(repo.format, repo.name, patch),
    onSuccess: async (data, patch, result, context) => {
      await refetch(data, patch, result, context);
      notify({ tone: "success", title: `Saved the ${patch.upstream ? "upstream" : "members"} of ${repo.prefix}` });
    },
  });
}

/** Creates a repo, realistic: the server assigns nothing but checks every field. The list is
 * fetched again, then the new repo's page opens. */
export function useCreateRepo() {
  const navigate = useNavigate();
  const { onSuccess: refetch } = realistic(["repos"]);
  return useMutation({
    mutationFn: (req: CreateRepoRequest) => createRepo(req),
    onSuccess: async (repo, req, result, context) => {
      await refetch(repo, req, result, context);
      notify({ tone: "success", title: `Created ${repo.prefix}` });
      await navigate({ to: "/$format/$repo", params: { format: repo.format, repo: repo.name } });
    },
  });
}

/** Deletes a repo after the confirmation, realistic; force, one that has versions. Then the list
 * of repos, without it. */
export function useDeleteRepo(repo: Repo) {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (force: boolean) => deleteRepo(repo.format, repo.name, force),
    onSuccess: async (_data, _force, _result, { client }) => {
      notify({ tone: "success", title: `Deleted ${repo.prefix}`, description: repo.kind === "group" ? "Its members stay as they are." : "Its artifacts stay in the registry." });
      // Away from the repo's page first, so that it is not fetched again only to be a 404.
      await navigate({ to: "/" });
      client.removeQueries({ queryKey: ["repos", repo.format, repo.name] });
      await client.invalidateQueries({ queryKey: reposQuery.queryKey });
    },
  });
}

/** Starts a reindex, realistic: the server answers once the run holds its lock; the run is then
 * the repo's latest, which useReindexRun follows. */
export function useStartReindex(repo: Repo) {
  return useMutation({
    mutationFn: (req: ReindexRequest) => startReindex(repo.format, repo.name, req),
    ...realistic(reindexQuery(repo.format, repo.name).queryKey, repoQuery(repo.format, repo.name).queryKey),
  });
}

/** How often a running run is asked for: every second for its first minute, then every five. */
export function pollInterval(run: ReindexRun | null | undefined, now: number): number | false {
  if (run?.state !== "running") return false;
  return now - Date.parse(run.startedAt) < 60_000 ? 1000 : 5000;
}

/** The latest run that covered the repo, polled while it runs (GET …/reindex); when it ends,
 * the repo is fetched again, whose state and counts the run changed. */
export function useReindexRun(repo: Repo) {
  const client = useQueryClient();
  // With an idle bound, the poll stops while nobody is there, and comes back with them: the
  // re-render of useIdle sets the interval again (src/api/idle.ts).
  const { away } = useIdle();
  const run = useQuery({
    ...reindexQuery(repo.format, repo.name),
    refetchInterval: (q) => (!away && pollsAllowed() ? pollInterval(q.state.data, Date.now()) : false),
  });
  const state = run.data?.state;
  const was = useRef(state);
  useEffect(() => {
    if (was.current === "running" && state !== undefined && state !== "running") {
      void client.invalidateQueries({ queryKey: repoQuery(repo.format, repo.name).queryKey, exact: true });
      void client.invalidateQueries({ queryKey: reposQuery.queryKey, exact: true });
    }
    was.current = state;
  }, [state, client, repo.format, repo.name]);
  return run;
}
