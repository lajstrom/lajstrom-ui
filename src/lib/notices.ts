// Notices: what the UI says about a change once the screen has moved on, such as a change that
// the screen showed at once and the server then refused (docs/adr/0003-changes.md). The store
// lives outside React, so that the callbacks of a mutation can add to it; <Notices /> shows it.

export type Notice = {
  id: number;
  tone: "success" | "danger" | "neutral";
  title: string;
  description?: string | null;
  /** A button of the notice, such as Undo; clicking it also closes the notice. */
  action?: { label: string; run: () => void };
};

/** How many notices show at once: a new one pushes the oldest out. */
const MAX = 3;

let notices: readonly Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: readonly Notice[]) {
  notices = next;
  for (const fn of listeners) fn();
}

/** Shows a notice; returns its id. */
export function notify(notice: Omit<Notice, "id">): number {
  const id = nextId++;
  set([...notices, { ...notice, id }].slice(-MAX));
  return id;
}

export function dismiss(id: number): void {
  if (notices.some((n) => n.id === id)) set(notices.filter((n) => n.id !== id));
}

/** The notices shown, oldest first; the same array until they change (useSyncExternalStore). */
export function getNotices(): readonly Notice[] {
  return notices;
}

export function subscribeNotices(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
