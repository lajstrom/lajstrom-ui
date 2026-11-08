import { describe, expect, it } from "vitest";

import { sessionTokenName } from "./auth";

describe("sessionTokenName", () => {
  it("names the minute in UTC and a random suffix", () => {
    const name = sessionTokenName(new Date("2026-11-08T09:41:27.123Z"), new Uint8Array([0x0a, 0xbc, 0xff]));
    expect(name).toBe("web UI 2026-11-08 09:41 UTC 0abc");
  });

  it("fits the server's limit of 64 bytes", () => {
    const name = sessionTokenName(new Date("2026-12-31T23:59:59Z"), new Uint8Array([255, 255]));
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(64);
  });
});
