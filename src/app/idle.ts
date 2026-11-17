import { useSyncExternalStore } from "react";

import { idleState, onIdleChange, type IdleState } from "@/api/idle";

/** The idle bound of the sign-in (src/api/idle.ts), re-rendering when its phase, its countdown or
 * the person's presence changes. */
export function useIdle(): IdleState {
  return useSyncExternalStore(onIdleChange, idleState);
}
