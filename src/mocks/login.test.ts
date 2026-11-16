// Signing in at the mock's POST /api/v1/login through the client's calls and msw in node: a token
// bound to this browser's DPoP key, sent as DPoP with a new proof per request, refused as a
// bearer; the clock set right by the server's Date; sign-out; and the password flow of a server
// without the route.

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signInWithPassword, signInWithToken, signOut } from "@/api/auth";
import { apiGet, apiGetAs, apiPath } from "@/api/client";
import { jwkThumbprint, learnServerClock, publicJwk } from "@/api/dpop";
import { signInKey } from "@/api/dpop-key";
import { getSession } from "@/api/session";
import type { ServerInfo, Token, WhoAmI } from "@/api/types";

import { createToken, revokeToken } from "./auth";
import { serverInfo } from "./data/system";
import { handlers } from "./handlers";

const server = setupServer(...handlers);
/** The requests to the API that reached the mock, in order. */
let sent: Request[] = [];
server.events.on("request:start", ({ request }) => {
  sent.push(request);
});

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
beforeEach(() => {
  sent = [];
});
afterEach(async () => {
  await signOut();
  learnServerClock(new Date().toUTCString());
  server.resetHandlers();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

const to = (path: string) => sent.filter((r) => new URL(r.url).pathname === path);
const whoami = () => apiGet<WhoAmI>(apiPath("whoami"));

/** The token as the admin sees it, with a bearer of its own. */
async function tokenAsAdmin(id: number): Promise<Token | undefined> {
  const admin = createToken({ user: "admin" }, { name: `login test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in admin) throw new Error(admin.message);
  const { tokens } = await apiGetAs<{ tokens: Token[] }>(apiPath("tokens"), `Bearer ${admin.secret}`);
  return tokens.find((t) => t.id === id);
}

describe("signing in at POST /api/v1/login", () => {
  it("binds the token to this browser's key, and sends it as DPoP with a new proof per request", async () => {
    await signInWithPassword(" Alice ", "alice");
    const s = getSession()!;
    expect(s).toMatchObject({ user: "alice", tokenType: "DPoP", tokenId: expect.any(Number), expiresAt: expect.any(String) });
    const hours = (Date.parse(s.expiresAt!) - Date.now()) / 3_600_000;
    expect(hours).toBeCloseTo(serverInfo.login.tokenLifetime / 3600, 1);

    const [login] = to("/api/v1/login");
    expect(login!.headers.get("Authorization")).toBeNull();
    expect(login!.headers.get("DPoP")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    const jkt = await jwkThumbprint(await publicJwk((await signInKey()).publicKey));
    expect(await tokenAsAdmin(s.tokenId!)).toMatchObject({ user: "alice", scopes: [], dpopJkt: jkt, name: expect.stringMatching(/^login \S+Z [0-9a-f]{4}$/) });

    sent = [];
    expect(await whoami()).toMatchObject({ name: "alice" });
    expect(await whoami()).toMatchObject({ name: "alice" });
    expect(sent.map((r) => r.headers.get("Authorization"))).toEqual([`DPoP ${s.token}`, `DPoP ${s.token}`]);
    const proofs = sent.map((r) => r.headers.get("DPoP"));
    expect(proofs[0]).toBeTruthy();
    expect(proofs[0]).not.toBe(proofs[1]);
  });

  it("refuses the bound token as a bearer and in Basic credentials", async () => {
    await signInWithPassword("alice", "alice");
    const { token } = getSession()!;
    await expect(apiGetAs(apiPath("whoami"), `Bearer ${token}`)).rejects.toMatchObject({ status: 401 });
    const res = await fetch("http://localhost/api/v1/whoami", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.headers.get("WWW-Authenticate")).toBe('DPoP error="invalid_token", algs="ES256"');
    const basic = await fetch("http://localhost/api/v1/whoami", { headers: { Authorization: `Basic ${btoa(`alice:${token}`)}` } });
    expect(basic.status).toBe(401);
    // As DPoP with this browser's proof it works.
    expect(await whoami()).toMatchObject({ name: "alice" });
  });

  it("refuses a proof sent twice, and keeps the session", async () => {
    await signInWithPassword("alice", "alice");
    await whoami();
    const first = sent.at(-1)!;
    const replay = await fetch(first.url, { headers: { Authorization: first.headers.get("Authorization")!, DPoP: first.headers.get("DPoP")! } });
    expect(replay.status).toBe(401);
    expect(replay.headers.get("WWW-Authenticate")).toBe('DPoP error="invalid_dpop_proof", error_description="the proof was used already", algs="ES256"');
    expect(getSession()?.user).toBe("alice");
  });

  it("signs again by the server's clock when this browser's is off by more than 5 minutes", async () => {
    // This tab believes the server an hour ahead.
    learnServerClock(new Date(Date.now() + 3_600_000).toUTCString());
    await signInWithPassword("alice", "alice");
    const logins = to("/api/v1/login");
    expect(logins).toHaveLength(2);
    expect(logins[0]!.headers.get("DPoP")).not.toBe(logins[1]!.headers.get("DPoP"));

    learnServerClock(new Date(Date.now() - 3_600_000).toUTCString());
    sent = [];
    expect(await whoami()).toMatchObject({ name: "alice" });
    expect(sent).toHaveLength(2);
    expect(getSession()?.user).toBe("alice");

    // Requests refused together: the first sets the clock right, and each signs again.
    learnServerClock(new Date(Date.now() + 3_600_000).toUTCString());
    sent = [];
    await Promise.all([whoami(), whoami(), apiGet(apiPath("repos"))]);
    expect(sent).toHaveLength(6);
  });

  it("says why a sign-in failed: a wrong password, a proof that is missing", async () => {
    await expect(signInWithPassword("alice", "wrong")).rejects.toMatchObject({
      name: "SignInError",
      message: "Wrong user name or password, or the user is disabled.",
    });
    await expect(signInWithPassword("dave", "dave")).rejects.toMatchObject({ name: "SignInError" });
    const res = await fetch("http://localhost/api/v1/login", { method: "POST", body: JSON.stringify({ username: "alice", password: "alice" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "INVALID", message: "DPoP: the request has no DPoP header" } });
    expect(getSession()).toBeNull();
  });

  it("ends the session when the token is refused: revoked elsewhere", async () => {
    await signInWithPassword("alice", "alice");
    expect(revokeToken({ user: "alice" }, getSession()!.tokenId!)).toBe(true);
    await expect(whoami()).rejects.toMatchObject({ status: 401 });
    expect(sent.at(-1)!.headers.get("Authorization")).toMatch(/^DPoP /);
    expect(getSession()).toBeNull();
  });

  it("signs out: revokes the token and forgets the key", async () => {
    await signInWithPassword("alice", "alice");
    const s = getSession()!;
    const before = await jwkThumbprint(await publicJwk((await signInKey()).publicKey));
    sent = [];
    await signOut();
    expect(getSession()).toBeNull();
    expect(sent.map((r) => `${r.method} ${new URL(r.url).pathname} ${r.headers.get("Authorization")?.split(" ")[0]}`)).toEqual([
      `DELETE /api/v1/users/alice/tokens/${s.tokenId} DPoP`,
    ]);
    expect((await tokenAsAdmin(s.tokenId!))?.revokedAt).not.toBeNull();
    expect(await jwkThumbprint(await publicJwk((await signInKey()).publicKey))).not.toBe(before);
  });
});

describe("a pasted token, and a server without POST /api/v1/login", () => {
  it("sends a pasted token as a bearer", async () => {
    const t = createToken({ user: "bob" }, { name: `pasted ${Math.random()}`, expiresIn: "1h" });
    if ("status" in t) throw new Error(t.message);
    await signInWithToken(t.secret);
    expect(getSession()).toMatchObject({ user: "bob", tokenId: null, tokenType: "Bearer" });
    sent = [];
    await whoami();
    expect(sent[0]!.headers.get("Authorization")).toBe(`Bearer ${t.secret}`);
    expect(sent[0]!.headers.get("DPoP")).toBeNull();
  });

  it("creates the token with the password, a bearer, where info has no login", async () => {
    server.use(
      http.get("*/api/v1/info", () => {
        const { login: _login, ...older } = serverInfo;
        const caller = { principal: "anonymous", kind: "anonymous", name: "anonymous", admin: false } as const;
        return HttpResponse.json({ ...older, caller } satisfies Omit<ServerInfo, "login">);
      }),
    );
    await signInWithPassword("alice", "alice");
    expect(getSession()).toMatchObject({ user: "alice", tokenType: "Bearer", tokenId: expect.any(Number) });
    expect(to("/api/v1/login")).toHaveLength(0);
    expect(to("/api/v1/users/alice/tokens")[0]!.headers.get("Authorization")).toMatch(/^Basic /);
    sent = [];
    await whoami();
    expect(sent[0]!.headers.get("Authorization")).toMatch(/^Bearer ljs_pat_/);
  });
});
