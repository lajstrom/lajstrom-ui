import { useSyncExternalStore } from "react";

import { idleState, onIdleChange, type IdleState } from "@/api/idle";

/** The idle bound of the sign-in (src/api/idle.ts), re-rendering when its phase, its countdown or
 * the person's presence changes. */
export function useIdle(): IdleState {
  return useSyncExternalStore(onIdleChange, idleState);
}

/** Whether polls may go: not while the person is away (src/api/idle.ts), re-rendering only when
 * they go or come back, for the interval of a query that asks again on a timer. */
export function usePollsAllowed(): boolean {
  return useSyncExternalStore(onIdleChange, () => !idleState().away);
}
