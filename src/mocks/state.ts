// What the demo keeps between visits, in this browser's localStorage only (src/app/demo.ts):
// the parts of the mock that the visitor can change register here, and every change saves them
// all. Nothing here imports those parts, so that they can import this module.

import { DEMO_STATE } from "@/app/demo";

type Part = {
  save(): unknown;
  load(data: unknown): void;
};

const parts = new Map<string, Part>();
let restoring = false;

/** Registers a part of the mock that the demo keeps; called once by the module that owns it. */
export function keep(name: string, part: Part): void {
  parts.set(name, part);
}

type Stored = { version: 2; parts: Record<string, unknown> };

/** Saves every part; called after each change. */
export function persist(): void {
  if (restoring || typeof window === "undefined") return; // tests: no browser, nothing to keep
  const state: Stored = { version: 2, parts: Object.fromEntries([...parts].map(([name, p]) => [name, p.save()])) };
  try {
    localStorage.setItem(DEMO_STATE, JSON.stringify(state));
  } catch {
    // Storage full or disabled: the changes last until the page is reloaded.
  }
}

/** Puts back what the demo kept; called once when the mock starts. */
export function restoreDemoState(): void {
  if (typeof window === "undefined") return;
  let raw: unknown;
  try {
    raw = JSON.parse(localStorage.getItem(DEMO_STATE) ?? "null");
  } catch {
    return;
  }
  const state = raw as { version?: number; parts?: Record<string, unknown>; tokens?: unknown; secrets?: unknown; nextId?: unknown } | null;
  restoring = true;
  try {
    if (state?.version === 2 && state.parts) {
      for (const [name, part] of parts) if (name in state.parts) part.load(state.parts[name]);
    } else if (state?.version === 1) {
      // The first demo kept its tokens only, at the top level.
      parts.get("tokens")?.load({ tokens: state.tokens, secrets: state.secrets, nextId: state.nextId });
    }
  } finally {
    restoring = false;
  }
}
