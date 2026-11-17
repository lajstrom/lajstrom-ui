// The idle bound of a sign-in (#75): with the server's auth.login.idleTimeout, a token of
// POST /api/v1/login that no request has used for that long is refused, 401 with the DPoP
// challenge error_description="idle", and revoked (docs/spec/rbac.md §10 of the server, Idle).
// Every request with the token is a use, so the UI makes none on a timer while the person does
// nothing: polls stop once nobody has touched the UI for a minute, in any tab, and resume with
// the next touch (pollsAllowed). The UI counts the idle time itself, from its last request with
// the token in any tab (localStorage): it warns two minutes before its bound and signs out at it
// (src/app/idle-guard.tsx), before the server refuses.

import { getSession, onSessionChange, sessionStorageKey } from "./session";

/** The server keeps a token's last use to the minute, so it refuses the token between a minute
 * short of idleTimeout and idleTimeout after that use: the UI's bound is the earlier. */
const SERVER_SLACK = 60_000;
/** How long before its bound the UI warns. */
export const WARN_BEFORE = 120_000;
/** Nobody has touched the UI for this long: the person is away, and polls stop. */
export const AWAY_AFTER = 60_000;
/** Writes to localStorage are this far apart at least: other tabs are at most that far behind. */
const SHARE_EVERY = 5_000;

export type IdlePhase = "active" | "warning" | "over";

/** When the UI ends a sign-in last used at lastUse, idleTimeout in seconds. */
export function idleDeadline(lastUse: number, idleTimeout: number): number {
  return lastUse + idleTimeout * 1000 - SERVER_SLACK;
}

/** Where a sign-in last used at lastUse stands at now: active, warned, or over. */
export function idlePhase(lastUse: number, idleTimeout: number, now: number): IdlePhase {
  const deadline = idleDeadline(lastUse, idleTimeout);
  return now >= deadline ? "over" : now >= deadline - WARN_BEFORE ? "warning" : "active";
}

/** Seconds left as a clock shows them: 1:05. */
export function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What the app shows of the bound: off (no bound, or no sign-in it holds for), or the phase
 * with the deadline and the whole seconds left; away is whether polls have stopped. */
export type IdleState = { bound: number; phase: IdlePhase | "off"; deadline: number; left: number; away: boolean };

/** The bound in seconds, 0 when off: info.login.idleTimeout while a DPoP sign-in is on. */
let bound = 0;
let state: IdleState = { bound: 0, phase: "off", deadline: 0, left: 0, away: false };
const listeners = new Set<() => void>();
let phaseTimer: ReturnType<typeof setTimeout> | undefined;
let awayTimer: ReturnType<typeof setTimeout> | undefined;

const usedKey = () => `${sessionStorageKey()}.used`;
const touchedKey = () => `${sessionStorageKey()}.touched`;

/** The last use of the session's token in this tab, by token id, and the last touch. */
let used: { id: number | null; at: number } | null = null;
let touched = Date.now();
const shared = { used: 0, touched: 0 };

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled: each tab counts its own.
  }
}

/** The last use of the session's token, in this tab or another one; null when none is known. */
export function lastTokenUse(): number | null {
  const id = getSession()?.tokenId ?? null;
  const stored = readJson(usedKey()) as { id?: unknown; at?: unknown } | null;
  const there = stored?.id === id && typeof stored.at === "number" ? stored.at : null;
  const here = used?.id === id ? used.at : null;
  if (there === null) return here;
  return here === null ? there : Math.max(here, there);
}

/** The last touch of the UI, a key or the pointer, in this tab or another one. */
function lastTouch(): number {
  const stored = readJson(touchedKey());
  return typeof stored === "number" ? Math.max(touched, stored) : touched;
}

/** A request is about to go with the session's token (src/api/client.ts), or the sign-in made
 * one: the bound starts over. */
export function noteTokenUse(now = Date.now()): void {
  recordUse(now);
  if (bound) update();
}

function recordUse(now: number): void {
  used = { id: getSession()?.tokenId ?? null, at: now };
  if (now - shared.used >= SHARE_EVERY) {
    shared.used = now;
    write(usedKey(), used);
  }
}

/** Someone touched the UI: polls go on, or come back. */
export function notePresence(now = Date.now()): void {
  touched = now;
  if (now - shared.touched >= SHARE_EVERY) {
    shared.touched = now;
    write(touchedKey(), now);
  }
  if (bound && state.away) update();
}

/** Whether a request the UI makes on its own, a poll or a refetch, may go now: always without a
 * bound; with one, only while someone has touched the UI within the last minute. */
export function pollsAllowed(now = Date.now()): boolean {
  return bound === 0 || now - lastTouch() < AWAY_AFTER;
}

function update(): void {
  clearTimeout(phaseTimer);
  clearTimeout(awayTimer);
  const now = Date.now();
  let next: IdleState;
  if (bound === 0) {
    next = { bound: 0, phase: "off", deadline: 0, left: 0, away: false };
  } else {
    let last = lastTokenUse();
    if (last === null) {
      // A sign-in from before this tab counted: it counts from now, and the server from its
      // own record, which refuses it first if it was idle.
      recordUse(now);
      last = now;
    }
    const deadline = idleDeadline(last, bound);
    const phase = idlePhase(last, bound, now);
    const sinceTouch = now - lastTouch();
    next = { bound, phase, deadline, left: Math.max(0, Math.ceil((deadline - now) / 1000)), away: sinceTouch >= AWAY_AFTER };
    // The countdown ticks each second while it shows; otherwise the next wake is the warning.
    if (phase === "warning") phaseTimer = setTimeout(update, Math.min(1000, deadline - now));
    else if (phase === "active") phaseTimer = setTimeout(update, deadline - WARN_BEFORE - now);
    if (!next.away) awayTimer = setTimeout(update, AWAY_AFTER - sinceTouch);
  }
  if (
    next.bound !== state.bound ||
    next.phase !== state.phase ||
    next.deadline !== state.deadline ||
    next.left !== state.left ||
    next.away !== state.away
  ) {
    state = next;
    for (const fn of listeners) fn();
  }
}

/** Sets the bound, in seconds; 0 or undefined turns it off. The app sets it from info while a
 * DPoP sign-in is on. */
export function setIdleBound(seconds: number | undefined): void {
  const next = seconds && seconds > 0 ? seconds : 0;
  if (next === bound) return;
  bound = next;
  update();
}

/** The state of the bound; the same object until it changes, as useSyncExternalStore needs. */
export function idleState(): IdleState {
  return state;
}

export function onIdleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const TOUCHES = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

/** Listens for touches of the UI and for what other tabs share; once, at start-up. A hidden tab's
 * timers may run late, and a sleeping computer's not at all: the state is checked again when the
 * tab shows. */
export function watchIdle(): void {
  const touch = () => notePresence();
  for (const type of TOUCHES) window.addEventListener(type, touch, { passive: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (bound && document.visibilityState === "visible") update();
  });
  window.addEventListener("storage", (e) => {
    if (bound && (e.key === usedKey() || e.key === touchedKey())) update();
  });
  onSessionChange(() => {
    if (bound) update();
  });
}
