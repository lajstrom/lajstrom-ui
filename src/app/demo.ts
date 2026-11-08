// Demo mode: the UI on generated data, answered in the browser by the mock of src/mocks (MSW).
// Nothing reaches a server: a service worker answers /api/v1, and what the visitor changes
// (tokens, for now) is kept in this browser's localStorage, apart from the real session.
//
// config.json decides. "mock": true makes the demo the only mode: a deployment without a server,
// and the image's smoke test. "demo": true, the default, offers it next to a server: "Open the
// demo" or ?demo=1 enters it, "Exit demo" or ?demo=0 leaves it. Both reload the page, so that the
// mock starts before the first request, and stops for good.

import type { UiConfig } from "./config";

const FLAG = "lajstrom.demo";
/** The mock's changes: tokens and their secrets (src/mocks/auth.ts). */
export const DEMO_STATE = "lajstrom.demo.state";
/** The demo's own session, so that a real one is neither sent to the mock nor lost. */
export const DEMO_SESSION = "lajstrom.demo.session";
export const REAL_SESSION = "lajstrom.session";

export type DemoMode = {
  /** The mock answers the API. */
  active: boolean;
  /** config.json has "mock": true: there is no server to go back to. */
  forced: boolean;
  /** The demo may be entered. */
  offered: boolean;
};

let mode: DemoMode = { active: false, forced: false, offered: false };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Decides the mode at start-up from config.json, ?demo=1|0 and the choice kept in the browser. */
export function initDemo(cfg: UiConfig, location: Location = window.location): DemoMode {
  const forced = cfg.mock;
  const offered = forced || cfg.demo;
  const ls = storage();
  const url = new URL(location.href);
  const param = url.searchParams.get("demo");
  if (param === "1" || param === "0") {
    if (offered && param === "1") ls?.setItem(FLAG, "1");
    if (param === "0") ls?.removeItem(FLAG);
    url.searchParams.delete("demo");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  mode = { active: forced || (offered && ls?.getItem(FLAG) === "1"), forced, offered };
  return mode;
}

export function demoMode(): DemoMode {
  return mode;
}

function reload(): void {
  window.location.assign(import.meta.env.BASE_URL);
}

export function enterDemo(): void {
  storage()?.setItem(FLAG, "1");
  reload();
}

export function exitDemo(): void {
  storage()?.removeItem(FLAG);
  reload();
}

/** Forgets what was done in the demo; it starts again from the generated data. */
export function resetDemo(): void {
  storage()?.removeItem(DEMO_STATE);
  storage()?.removeItem(DEMO_SESSION);
  reload();
}

/** The accounts of the demo (src/mocks/data/system.ts); each one's password is its name. */
export const demoUsers: { name: string; description: string }[] = [
  { name: "admin", description: "admin on every repository" },
  { name: "alice", description: "reads everything, publishes to */payments" },
  { name: "bob", description: "maintains apt/*, publishes to raw/*" },
  { name: "carol", description: "reads everything, publishes to two repos" },
];
