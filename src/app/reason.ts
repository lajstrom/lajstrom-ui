import { useSyncExternalStore } from "react";

import { keptReason, onReasonChange } from "@/api/reason";

/** The reason kept for the changes of this tab (src/api/reason.ts), re-rendering when it changes. */
export function useKeptReason(): string | null {
  return useSyncExternalStore(onReasonChange, keptReason);
}

const openers = new Set<() => void>();

/** Opens the dialog of the reason for changes, from the user menu. */
export function openReasonDialog(): void {
  for (const fn of openers) fn();
}

export function onOpenReasonDialog(fn: () => void): () => void {
  openers.add(fn);
  return () => openers.delete(fn);
}
