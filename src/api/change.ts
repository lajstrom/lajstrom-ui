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

type Change = { apply: (data: unknown) => unknown };

/** The optimistic changes of one query's data: the data before the first of them, the changes
 * since then in their order, and how many are still in flight. */
type InFlight = { before: unknown; changes: Change[]; pending: number };

const inFlight = new WeakMap<QueryClient, Map<string, InFlight>>();

function queriesOf(client: QueryClient): Map<string, InFlight> {
  let queries = inFlight.get(client);
  if (!queries) inFlight.set(client, (queries = new Map()));
  return queries;
}

type OptimisticOptions<TData, TVariables> = {
  /** The query whose data shows the change. */
  queryKey: QueryKey;
  /** The data as the server will have it once it has made the change. */
  apply: (data: TData, variables: TVariables) => TData;
  /** The change, for the notice of a refusal: "Revoke laptop". */
  describe: (variables: TVariables) => string;
};

/**
 * The callbacks of an optimistic change: cancel the query's fetches and apply the change to its
 * data at once. When the server refuses it, the data goes back to what it was with the other
 * changes still applied, so that two changes of one list in flight do not undo each other, and a
 * notice says so. When the last change of the query settles, the query is fetched again.
 */
export function optimistic<TData, TVariables>({ queryKey, apply, describe }: OptimisticOptions<TData, TVariables>) {
  const key = hashKey(queryKey);
  return {
    onMutate: async (variables: TVariables, { client }: MutationFunctionContext): Promise<Change> => {
      await client.cancelQueries({ queryKey });
      const queries = queriesOf(client);
      const state = queries.get(key) ?? { before: client.getQueryData(queryKey), changes: [], pending: 0 };
      queries.set(key, state);
      const change: Change = { apply: (data) => (data === undefined ? data : apply(data as TData, variables)) };
      state.changes.push(change);
      state.pending++;
      client.setQueryData(queryKey, change.apply);
      return change;
    },
    onError: (error: Error, variables: TVariables, change: Change | undefined, { client }: MutationFunctionContext) => {
      const state = queriesOf(client).get(key);
      if (state && change) {
        state.changes = state.changes.filter((c) => c !== change);
        client.setQueryData(
          queryKey,
          state.changes.reduce((data, c) => c.apply(data), state.before),
        );
      }
      notify({ tone: "danger", title: `${describe(variables)}: refused`, description: errorText(error) });
    },
    onSettled: async (_data: unknown, _error: Error | null, _variables: TVariables, change: Change | undefined, { client }: MutationFunctionContext) => {
      const queries = queriesOf(client);
      const state = queries.get(key);
      if (!state || !change || --state.pending > 0) return;
      queries.delete(key);
      await client.invalidateQueries({ queryKey });
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
