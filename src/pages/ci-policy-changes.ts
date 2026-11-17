// The changes of a CI trust policy (docs/adr/0003-changes-realistic-by-default.md): every one is
// realistic, the screen waits for the server, which checks the rules and the steps of a policy
// that writes, and fetches the policies again. A change is sent as the request it is
// (src/api/mutations.ts, ciPolicyChanges), so that a step-up can keep it across its sign-in and
// send it again when the sign-in comes back (src/api/step-up.ts).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { realistic } from "@/api/change";
import { ApiError, sendChange, type ChangeRequest } from "@/api/client";
import { callerQuery, ciPoliciesKey, ciPolicyQuery, usersQuery } from "@/api/queries";
import { getSession } from "@/api/session";
import { replayRefusal, takePendingChange, type PendingChange } from "@/api/step-up";
import type { CIPolicy } from "@/api/types";
import { notify } from "@/lib/notices";

/** A change of a policy: the request, and what it does in words, for a step-up and its outcome. */
export type CIChange = { request: ChangeRequest; what: string };

/** A change of a policy, realistic: the policies and the policy are fetched again once the
 * server has answered. */
export function useCIChange() {
  return useMutation({
    mutationFn: (c: CIChange) => sendChange<CIPolicy>(c.request),
    ...realistic(ciPoliciesKey),
  });
}

/** Deletes a policy. The panel of the policy is left first, so that it is not fetched again only
 * to be a 404; then the policies are fetched again. */
export function useDeleteCIPolicy(name: string, leave: () => Promise<void>) {
  const { onSuccess: refetch } = realistic(ciPoliciesKey);
  return useMutation({
    mutationFn: (c: CIChange) => sendChange(c.request),
    onSuccess: async (data, variables, result, context) => {
      await leave();
      context.client.removeQueries({ queryKey: ciPolicyQuery(name).queryKey, exact: true });
      await refetch(data, variables, result, context);
      notify({ tone: "success", title: `Deleted the CI trust policy ${name}` });
    },
  });
}

/** Whether the server refused a change because the policy changed since it was read (412). */
export const changedMeanwhile = (err: unknown): err is ApiError => err instanceof ApiError && err.status === 412;

/** The policy of the panel, fetched again: a 412 shows the revision the server has now. */
export function useReadAgain(name: string) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ciPolicyQuery(name).queryKey, exact: true });
}

/** A change kept for a step-up that was not sent: the person did not sign in again, or as
 * someone else, or too late (replayRefusal). */
export class NotSent extends Error {
  constructor(why: string) {
    super(why);
    this.name = "NotSent";
  }
}

/**
 * The change this tab kept for a step-up, sent again once, now that the sign-in has come back to
 * the page: taken at the page's start, whatever then happens (src/api/step-up.ts). The mutation
 * holds it (variables), and its outcome; idle when there was none.
 */
export function useStepUpReplay() {
  const replay = useMutation({
    mutationFn: async (change: PendingChange) => {
      const why = replayRefusal(change, getSession(), Date.now());
      if (why) throw new NotSent(why);
      return sendChange<CIPolicy>(change.request);
    },
    ...realistic(ciPoliciesKey),
  });
  const { mutate } = replay;
  useEffect(() => {
    const change = takePendingChange();
    if (change) mutate(change);
  }, [mutate]);
  return replay;
}

/** The names of the users the admin knows, by principal (user:<uid>), and the caller's. */
export function useNames(): Map<string, string> {
  const who = useQuery(callerQuery);
  const users = useQuery({ ...usersQuery, enabled: who.data?.admin ?? false });
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const u of users.data ?? []) names.set(`user:${u.uid}`, u.name);
    if (who.data?.uid) names.set(`user:${who.data.uid}`, who.data.name);
    return names;
  }, [who.data, users.data]);
}
