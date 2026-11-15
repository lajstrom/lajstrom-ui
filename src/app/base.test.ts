import { describe, expect, it } from "vitest";

import { baseOf } from "./base";

describe("baseOf", () => {
  it("is the directory that holds assets/, below /ui/ or at the root", () => {
    expect(baseOf("https://art.example.com/ui/assets/index-DxF8zIUb.js")?.href).toBe("https://art.example.com/ui/");
    expect(baseOf("https://ui.example.com/assets/index-DxF8zIUb.js")?.href).toBe("https://ui.example.com/");
    expect(baseOf("https://example.github.io/lajstrom-ui/assets/browser-BgwhwPcf.js")?.pathname).toBe("/lajstrom-ui/");
  });

  it("takes the last assets/ of the path", () => {
    expect(baseOf("https://h/assets/ui/assets/index.js")?.pathname).toBe("/assets/ui/");
  });

  it("is null for a module outside a build, as on the dev server", () => {
    expect(baseOf("http://localhost:5173/ui/src/app/base.ts")).toBeNull();
  });
});
