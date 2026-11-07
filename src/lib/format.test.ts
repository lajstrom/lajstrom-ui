import { describe, expect, it } from "vitest";

import { formatBytes, formatRelative, shortDigest } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1.00 KiB"],
    [1258496, "1.20 MiB"],
    [5 * 1024 ** 3, "5.00 GiB"],
  ])("%d → %s", (n, s) => {
    expect(formatBytes(n)).toBe(s);
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  it.each([
    ["2026-11-06T11:59:50Z", "just now"],
    ["2026-11-06T09:00:00Z", "3 hours ago"],
    ["2026-11-05T12:00:00Z", "yesterday"],
    ["2026-10-06T12:00:00Z", "last month"],
  ])("%s → %s", (iso, s) => {
    expect(formatRelative(iso, now)).toBe(s);
  });
});

describe("shortDigest", () => {
  it("keeps the algorithm and the first 12 hex digits", () => {
    expect(shortDigest("sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")).toBe(
      "sha256:44136fa355b3",
    );
  });
});
