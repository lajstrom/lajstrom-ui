// How the UI changes something on the server (docs/adr/0003-changes.md). Realistic by default:
// the screen shows what the server confirmed, and a change in flight shows as pending. Optimistic
// where it is safe: the screen shows the change at once and goes back to the server's state if the
// server refuses it. Both are callbacks of TanStack Query's useMutation.

import { hashKey, useMutationState, type MutationFunctionContext, type MutationKey, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";

import { errorText } from "@/lib/errors";
import { notify } from "@/lib/notices";

/**
 * The callback of a realistic change: once the server has answered, fetch the queries that show
 * the change again, and stay pending until they are, so that the screen goes from the old state
 * to the server's new one.
 */
export function realistic(...queryKeys: QueryKey[]) {
  return {
    onSuccess: (_data: unknown, _variables: unknown, _onMutateResult: unknown, { client }: MutationFunctionContext) =>
      Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey }))),
  };
}

/** One query's data as a change makes it (update). */
export type Update = { queryKey: QueryKey; apply: (data: unknown) => unknown };

/** What a change does to the data of one query; a query without data stays without. */
export function update<TData>(queryKey: QueryKey, apply: (data: TData) => TData): Update {
  return { queryKey, apply: (data) => (data === undefined ? data : apply(data as TData)) };
}

/** The optimistic changes of one query's data: the data before the first of them, the changes
 * since then in their order, and how many are still in flight. */
type InFlight = { before: unknown; changes: Update[]; pending: number };

const inFlight = new WeakMap<QueryClient, Map<string, InFlight>>();

function queriesOf(client: QueryClient): Map<string, InFlight> {
  let queries = inFlight.get(client);
  if (!queries) inFlight.set(client, (queries = new Map()));
  return queries;
}

type OptimisticOptions<TVariables> = {
  /** What the change does to each query that shows it: the list, and the page of the thing. */
  updates: (variables: TVariables) => Update[];
  /** The change, for the notice of a refusal: "Revoke laptop". */
  describe: (variables: TVariables) => string;
};

/**
 * The callbacks of an optimistic change: cancel the fetches of the queries that show it and apply
 * the change to their data at once. When the server refuses it, each query's data goes back to
 * what it was with the other changes still applied, so that two changes of one list in flight do
 * not undo each other, and a notice says so. When the last change of a query settles, the query
 * is fetched again.
 */
export function optimistic<TVariables>({ updates, describe }: OptimisticOptions<TVariables>) {
  return {
    onMutate: async (variables: TVariables, { client }: MutationFunctionContext): Promise<Update[]> => {
      const changes = updates(variables);
      // Exact keys: a query below one, such as a version's attachments, goes on loading.
      await Promise.all(changes.map(({ queryKey }) => client.cancelQueries({ queryKey, exact: true })));
      const queries = queriesOf(client);
      for (const change of changes) {
        const key = hashKey(change.queryKey);
        const state = queries.get(key) ?? { before: client.getQueryData(change.queryKey), changes: [], pending: 0 };
        queries.set(key, state);
        state.changes.push(change);
        state.pending++;
        client.setQueryData(change.queryKey, change.apply);
      }
      return changes;
    },
    onError: (error: Error, variables: TVariables, changes: Update[] | undefined, { client }: MutationFunctionContext) => {
      for (const change of changes ?? []) {
        const state = queriesOf(client).get(hashKey(change.queryKey));
        if (!state) continue;
        state.changes = state.changes.filter((c) => c !== change);
        client.setQueryData(
          change.queryKey,
          state.changes.reduce((data, c) => c.apply(data), state.before),
        );
      }
      notify({ tone: "danger", title: `${describe(variables)}: refused`, description: errorText(error) });
    },
    onSettled: async (_data: unknown, _error: Error | null, _variables: TVariables, changes: Update[] | undefined, { client }: MutationFunctionContext) => {
      const queries = queriesOf(client);
      const settled = (changes ?? []).filter((change) => {
        const key = hashKey(change.queryKey);
        const state = queries.get(key);
        if (!state || --state.pending > 0) return false;
        queries.delete(key);
        return true;
      });
      await Promise.all(settled.map(({ queryKey }) => client.invalidateQueries({ queryKey, exact: true })));
    },
  };
}

export type ChangeState = { pending: boolean; error: Error | null };

/**
 * The last change of each thing under mutationKey, by the id of its variables: in flight, or
 * refused with the server's error, to show next to the thing. A thing whose last change went
 * through is not in the map.
 */
export function useChanges<TVariables>(mutationKey: MutationKey, id: (variables: TVariables) => string | number): Map<string | number, ChangeState> {
  const mutations = useMutationState({
    filters: { mutationKey },
    select: (m) => ({ variables: m.state.variables as TVariables, status: m.state.status, error: m.state.error, at: m.state.submittedAt }),
  });
  return useMemo(() => {
    const last = new Map<string | number, (typeof mutations)[number]>();
    for (const m of mutations) {
      const k = id(m.variables);
      if ((last.get(k)?.at ?? -1) <= m.at) last.set(k, m);
    }
    const changes = new Map<string | number, ChangeState>();
    for (const [k, m] of last) {
      if (m.status === "pending" || m.status === "error") changes.set(k, { pending: m.status === "pending", error: m.error });
    }
    return changes;
  }, [mutations, id]);
}
