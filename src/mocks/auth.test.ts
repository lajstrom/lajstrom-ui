import { describe, expect, it } from "vitest";

import type { Token } from "@/api/types";

import { authenticate, createToken, revokeToken, tokenView } from "./auth";
import { config } from "./data/system";

const basic = (user: string, secret: string) =>
  `Basic ${btoa(Array.from(new TextEncoder().encode(`${user}:${secret}`), (b) => String.fromCharCode(b)).join(""))}`;
const req = (authorization?: string) =>
  new Request("http://localhost/api/v1/whoami", authorization ? { headers: { Authorization: authorization } } : {});

describe("authenticate (docs/auth.md)", () => {
  it("lets a request without credentials go on as anonymous", async () => {
    expect(await authenticate(req())).toEqual({ principal: "anonymous", credential: { kind: "none" } });
  });

  it("takes the user's name as the password, of a user that is not disabled", async () => {
    expect(await authenticate(req(basic("alice", "alice")))).toEqual({ principal: "alice", credential: { kind: "password" } });
    expect(await authenticate(req(basic("alice", "wrong")))).toEqual({ refused: true });
    expect(await authenticate(req(basic("alice", "")))).toEqual({ refused: true });
    expect(await authenticate(req(basic("dave", "dave")))).toEqual({ refused: true });
    expect(await authenticate(req(basic("nobody", "nobody")))).toEqual({ refused: true });
  });

  it("refuses a bearer it does not know, and a deploy token as bearer", async () => {
    expect(await authenticate(req("Bearer ljs_pat_unknown"))).toEqual({ refused: true });
    expect(await authenticate(req("Bearer ljs_dep_anything"))).toEqual({ refused: true });
    expect(await authenticate(req("Bearer some-jwt"))).toEqual({ principal: "anonymous", credential: { kind: "none" } });
  });

  it("accepts a token it created until it is revoked", async () => {
    const t = createToken({ user: "bob" }, { name: "auth test", expiresIn: "1h" });
    if ("status" in t) throw new Error(t.message);
    expect(await authenticate(req(`Bearer ${t.secret}`))).toEqual({ principal: "bob", credential: { kind: "token" } });
    expect(await authenticate(req(basic("bob", t.secret)))).toEqual({ principal: "bob", credential: { kind: "token" } });
    expect(await authenticate(req(basic("alice", t.secret)))).toEqual({ refused: true });
    expect(revokeToken({ user: "bob" }, t.id)).toBe(true);
    expect(await authenticate(req(`Bearer ${t.secret}`))).toEqual({ refused: true });
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

  it("gives a deploy token without an expiry the bound of auth.deployTokens.maxTTL, and needs scopes for it", () => {
    const t = createToken({ repo: "raw/assets" }, { name: "ci bounded", scopes: ["write"] });
    if ("status" in t) throw new Error(t.message);
    const days = (Date.parse(t.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179.9);
    expect(days).toBeLessThan(180.1);
    expect(t.secret.startsWith("ljs_dep_")).toBe(true);
    expect(tokenView(t)).not.toHaveProperty("beyondMaxTTL");
    expect(createToken({ repo: "raw/assets" }, { name: "no scopes" })).toMatchObject({ status: 400 });
  });

  it("refuses a deploy token's expiry beyond the bound, naming the field, the bound and the latest expiry", () => {
    expect(createToken({ repo: "raw/assets" }, { name: "the bound", scopes: ["write"], expiresIn: "180d" })).not.toHaveProperty("status");
    expect(createToken({ repo: "raw/assets" }, { name: "longer", scopes: ["write"], expiresIn: "365d" })).toMatchObject({
      status: 400,
      message: expect.stringMatching(/^expiresIn: a deploy token expires at most 4320h0m0s ahead \(auth\.deployTokens\.maxTTL\), at \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ at the latest$/),
    });
    expect(createToken({ repo: "raw/assets" }, { name: "later", scopes: ["write"], expiresAt: "2999-01-01T00:00:00Z" })).toMatchObject({
      status: 400,
      message: expect.stringMatching(/^expiresAt: /),
    });
  });

  it("lets a deploy token live without expiry while no bound is set", () => {
    const was = config.deployTokensMaxTTLHours;
    config.deployTokensMaxTTLHours = 0;
    try {
      const t = createToken({ repo: "raw/assets" }, { name: "ci forever", scopes: ["write"] });
      if ("status" in t) throw new Error(t.message);
      expect(t.expiresAt).toBeNull();
      expect(tokenView(t)).not.toHaveProperty("beyondMaxTTL");
      expect(createToken({ repo: "raw/assets" }, { name: "two years", scopes: ["write"], expiresIn: "730d" })).not.toHaveProperty("status");
    } finally {
      config.deployTokensMaxTTLHours = was;
    }
  });

  it("answers a live deploy token beyond the bound beyondMaxTTL: without an expiry, or a later one", () => {
    const now = Date.now();
    const day = 86_400_000;
    const at = (ms: number) => new Date(ms).toISOString();
    const deploy: Omit<Token, "createdAt" | "expiresAt"> = { id: 1, kind: "deploy", name: "old", repo: "raw/assets", scopes: ["read"], lastUsedAt: null, revokedAt: null, hashPrefix: "00000000" };
    expect(tokenView({ ...deploy, createdAt: at(now - 400 * day), expiresAt: null })).toMatchObject({ beyondMaxTTL: true });
    expect(tokenView({ ...deploy, createdAt: at(now - 10 * day), expiresAt: at(now + 200 * day) })).toMatchObject({ beyondMaxTTL: true });
    expect(tokenView({ ...deploy, createdAt: at(now - 10 * day), expiresAt: at(now + 160 * day) })).not.toHaveProperty("beyondMaxTTL");
    // Revoked or expired, it is not live; a personal access token has no such bound here.
    expect(tokenView({ ...deploy, createdAt: at(now - 400 * day), expiresAt: null, revokedAt: at(now - day) })).not.toHaveProperty("beyondMaxTTL");
    expect(tokenView({ ...deploy, kind: "pat", repo: undefined, user: "alice", createdAt: at(now - 400 * day), expiresAt: null })).not.toHaveProperty("beyondMaxTTL");
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
