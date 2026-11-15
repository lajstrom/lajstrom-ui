import { describe, expect, it } from "vitest";

import { maskMatches, maskSuggestions, parseMask } from "./masks";

describe("repo masks", () => {
  it("match whole segments only", () => {
    expect(maskMatches("*/*", "raw/assets")).toBe(true);
    expect(maskMatches("raw/*", "raw/assets")).toBe(true);
    expect(maskMatches("*/payments", "pypi/payments")).toBe(true);
    expect(maskMatches("*/payments", "pypi/payments-old")).toBe(false);
    expect(maskMatches("pypi/payments", "maven/payments")).toBe(false);
    expect(maskMatches("ra*/assets", "raw/assets")).toBe(false);
  });

  it("are two non-empty segments", () => {
    expect(parseMask("raw/*")).toEqual(["raw", "*"]);
    for (const m of ["", "raw", "raw/", "/x", "a/b/c"]) {
      expect(parseMask(m)).toBeNull();
      expect(maskMatches(m, "raw/assets")).toBe(false);
    }
  });

  it("are suggested from the widest", () => {
    expect(maskSuggestions(["pypi/payments", "maven/payments", "raw/assets"])).toEqual([
      "*/*",
      "maven/*",
      "pypi/*",
      "raw/*",
      "*/assets",
      "*/payments",
      "maven/payments",
      "pypi/payments",
      "raw/assets",
    ]);
  });
});
