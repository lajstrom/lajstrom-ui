import { describe, expect, it } from "vitest";

import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it.each([
    ["/raw/scratch?tab=maintenance", "/raw/scratch?tab=maintenance"],
    ["/tokens", "/tokens"],
    ["/", "/"],
  ])("keeps a path of the UI: %s", (input, want) => {
    expect(safeRedirect(input)).toBe(want);
  });

  it.each([undefined, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "tokens"])(
    "sends anything else home: %s",
    (input) => {
      expect(safeRedirect(input)).toBe("/");
    },
  );
});
