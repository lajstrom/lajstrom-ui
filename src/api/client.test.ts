import { describe, expect, it } from "vitest";

import { ApiError, basicAuth, isUnavailable, isUnreachable } from "./client";

/** base64 of the UTF-8 bytes, computed independently of basicAuth. */
const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));

describe("basicAuth", () => {
  it("encodes user:secret as RFC 7617 says", () => {
    expect(basicAuth("alice", "pass word")).toBe("Basic YWxpY2U6cGFzcyB3b3Jk");
  });

  it("encodes UTF-8, which btoa alone cannot", () => {
    expect(basicAuth("alice", "pässwörd✓")).toBe(`Basic ${b64("alice:pässwörd✓")}`);
    expect(basicAuth("alice", "pässwörd✓")).toBe("Basic YWxpY2U6cMOkc3N3w7ZyZOKckw==");
  });
});

describe("isUnavailable", () => {
  it("is true for an endpoint the server does not have", () => {
    const msg = "GET /api/v1/repos/raw/scratch/packages is not in this version; later";
    expect(isUnavailable(new ApiError(404, "NOT_FOUND", msg))).toBe(true);
    expect(isUnavailable(new ApiError(501, "UNAVAILABLE", "reindex comes later"))).toBe(true);
  });

  it("is false for a resource that does not exist, and for anything else", () => {
    expect(isUnavailable(new ApiError(404, "NOT_FOUND", "repo raw/nope not found"))).toBe(false);
    expect(isUnavailable(new ApiError(403, "FORBIDDEN", "not in this version"))).toBe(false);
    expect(isUnavailable(new Error("GET /api/v1/x is not in this version"))).toBe(false);
    expect(isUnavailable(null)).toBe(false);
  });
});

describe("isUnreachable", () => {
  it("is true when no Lajstrom server answered", () => {
    expect(isUnreachable(new ApiError(0, "UNAVAILABLE", "cannot be reached", false))).toBe(true);
    expect(isUnreachable(new ApiError(502, "UNAVAILABLE", "502 Bad Gateway", false))).toBe(true);
    expect(isUnreachable(new ApiError(500, "UNAVAILABLE", "500 Internal Server Error", false))).toBe(true);
  });

  it("is false for an answer of the server itself", () => {
    expect(isUnreachable(new ApiError(500, "INTERNAL", "Internal Server Error"))).toBe(false);
    expect(isUnreachable(new ApiError(501, "UNAVAILABLE", "comes later"))).toBe(false);
    expect(isUnreachable(new ApiError(404, "NOT_FOUND", "x", false))).toBe(false);
  });
});
