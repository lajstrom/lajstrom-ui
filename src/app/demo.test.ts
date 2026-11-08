import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiConfig } from "./config";
import { initDemo } from "./demo";

const cfg = (over: Partial<UiConfig>): UiConfig => ({ apiBaseUrl: "", mock: false, demo: true, title: "Lajstrom", ...over });

/** A browser enough for initDemo: localStorage, history and a location. */
function browser(href: string, stored: Record<string, string> = {}) {
  const items = new Map(Object.entries(stored));
  const replaced: string[] = [];
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    },
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => void replaced.push(url) },
  });
  return { location: { href } as Location, items, replaced };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initDemo", () => {
  it("is the real API by default", () => {
    const b = browser("http://localhost/ui/");
    expect(initDemo(cfg({}), b.location)).toEqual({ active: false, forced: false, offered: true });
  });

  it("is always the demo when config.json says mock", () => {
    const b = browser("http://localhost/ui/?demo=0");
    expect(initDemo(cfg({ mock: true, demo: false }), b.location)).toEqual({ active: true, forced: true, offered: true });
  });

  it("enters with ?demo=1, keeps the choice and takes the parameter out of the address", () => {
    const b = browser("http://localhost/ui/raw/scratch?demo=1&tab=details");
    expect(initDemo(cfg({}), b.location).active).toBe(true);
    expect(b.items.get("lajstrom.demo")).toBe("1");
    expect(b.replaced).toEqual(["/ui/raw/scratch?tab=details"]);
  });

  it("leaves with ?demo=0", () => {
    const b = browser("http://localhost/ui/?demo=0", { "lajstrom.demo": "1" });
    expect(initDemo(cfg({}), b.location).active).toBe(false);
    expect(b.items.has("lajstrom.demo")).toBe(false);
  });

  it("is not entered when the demo is not offered", () => {
    const b = browser("http://localhost/ui/?demo=1", { "lajstrom.demo": "1" });
    expect(initDemo(cfg({ demo: false }), b.location)).toEqual({ active: false, forced: false, offered: false });
  });
});
