import { useSyncExternalStore } from "react";

import { getSession, onSessionChange, type Session } from "@/api/session";

/** The browser session, re-rendering on sign-in and sign-out in this tab or another one. */
export function useSession(): Session | null {
  return useSyncExternalStore(onSessionChange, getSession);
}
