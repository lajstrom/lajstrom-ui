import { describe, expect, it } from "vitest";

import { authenticate, createToken, revokeToken } from "./auth";

const basic = (user: string, secret: string) =>
  `Basic ${btoa(Array.from(new TextEncoder().encode(`${user}:${secret}`), (b) => String.fromCharCode(b)).join(""))}`;
const req = (authorization?: string) =>
  new Request("http://localhost/api/v1/whoami", authorization ? { headers: { Authorization: authorization } } : {});

describe("authenticate (docs/auth.md)", () => {
  it("lets a request without credentials go on as anonymous", () => {
    expect(authenticate(req())).toEqual({ principal: "anonymous" });
  });

  it("takes the user's name as the password, of a user that is not disabled", () => {
    expect(authenticate(req(basic("alice", "alice")))).toEqual({ principal: "alice" });
    expect(authenticate(req(basic("alice", "wrong")))).toEqual({ refused: true });
    expect(authenticate(req(basic("alice", "")))).toEqual({ refused: true });
    expect(authenticate(req(basic("dave", "dave")))).toEqual({ refused: true });
    expect(authenticate(req(basic("nobody", "nobody")))).toEqual({ refused: true });
  });

  it("refuses a bearer it does not know, and a deploy token as bearer", () => {
    expect(authenticate(req("Bearer ljs_pat_unknown"))).toEqual({ refused: true });
    expect(authenticate(req("Bearer ljs_dep_anything"))).toEqual({ refused: true });
    expect(authenticate(req("Bearer some-jwt"))).toEqual({ principal: "anonymous" });
  });

  it("accepts a token it created until it is revoked", () => {
    const t = createToken({ user: "bob" }, { name: "auth test", expiresIn: "1h" });
    if ("status" in t) throw new Error(t.message);
    expect(authenticate(req(`Bearer ${t.secret}`))).toEqual({ principal: "bob" });
    expect(authenticate(req(basic("bob", t.secret)))).toEqual({ principal: "bob" });
    expect(authenticate(req(basic("alice", t.secret)))).toEqual({ refused: true });
    expect(revokeToken({ user: "bob" }, t.id)).toBe(true);
    expect(authenticate(req(`Bearer ${t.secret}`))).toEqual({ refused: true });
  });
});

describe("createToken (docs/api.md, Tokens)", () => {
  it("gives a personal access token 90 days by default and a secret with its prefix", () => {
    const t = createToken({ user: "carol" }, { name: "default expiry" });
    if ("status" in t) throw new Error(t.message);
    expect(t.secret.startsWith("ljs_pat_")).toBe(true);
    expect(t.hashPrefix).toMatch(/^[0-9a-f]{8}$/);
    const days = (Date.parse(t.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it("lets a deploy token live without expiry, and needs scopes for it", () => {
    const t = createToken({ repo: "raw/assets" }, { name: "ci forever", scopes: ["write"] });
    if ("status" in t) throw new Error(t.message);
    expect(t.expiresAt).toBeNull();
    expect(t.secret.startsWith("ljs_dep_")).toBe(true);
    expect(createToken({ repo: "raw/assets" }, { name: "no scopes" })).toMatchObject({ status: 400 });
  });

  it.each([
    [{ name: "" }, 400],
    [{ name: "x".repeat(65) }, 400],
    [{ name: "ok", scopes: ["delete"] }, 400],
    [{ name: "ok", expiresIn: "400d" }, 400],
    [{ name: "ok", expiresIn: "30d", expiresAt: "2030-01-01T00:00:00Z" }, 400],
    [{ name: "ok", expiresAt: "2000-01-01T00:00:00Z" }, 400],
    [{ name: "ok", color: "blue" }, 400],
  ])("refuses %j with %i", (body, status) => {
    expect(createToken({ user: "alice" }, body)).toMatchObject({ status });
  });

  it("refuses a name taken by a live token of the same owner with 409", () => {
    const first = createToken({ user: "alice" }, { name: "twice" });
    expect("status" in first).toBe(false);
    expect(createToken({ user: "alice" }, { name: "twice" })).toMatchObject({ status: 409 });
    expect("status" in createToken({ user: "bob" }, { name: "twice" })).toBe(false);
  });
});
