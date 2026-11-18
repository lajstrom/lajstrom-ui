// The mock's deploy tokens over a mask (docs/api.md): the admin's only, created with the admin's
// password and never with a token; listed whole or by the mask as written; revoked by id.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath } from "@/api/client";
import { createMaskToken, revokeMaskToken } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { Token } from "@/api/types";

import { createToken } from "./auth";
import { serverInfo } from "./data/system";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
  // A token is made at once, as by default (auth.approval none); approvals.test.ts has the rest.
  serverInfo.approval = "none";
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

/** Signs in with a personal access token; the demo's password of a user is its name. */
function signIn(user: string) {
  const t = createToken({ user }, { name: `mask test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const list = (repoMask = "") => apiGet<{ tokens: Token[] }>(apiPath("deploy-tokens"), { repoMask: repoMask || undefined }).then((r) => r.tokens);

describe("deploy tokens over a mask", () => {
  it("are created with the admin's password, listed by the mask as written, and revoked", async () => {
    signIn("admin");
    const created = await createMaskToken({ repoMask: "pypi/*", name: "wheel mirror", scopes: ["read"] }, { user: "admin", password: "admin" });
    expect(created).toMatchObject({ kind: "deploy", repoMask: "pypi/*", name: "wheel mirror", scopes: ["read"] });
    // Without an expiry, it expires at auth.deployTokens.maxTTL, 180 days in the mock.
    expect(Date.parse(created.expiresAt!) - Date.now()).toBeGreaterThan(179 * 86_400_000);
    expect(created.secret).toMatch(/^ljs_dep_/);
    expect(created).not.toHaveProperty("repo");

    expect((await list()).map((t) => t.id)).toContain(created.id);
    // The seed's token over */payments has no expiry: it was made before the bound.
    expect((await list("*/payments")).find((t) => t.name === "payments audit mirror")).toMatchObject({ beyondMaxTTL: true });
    expect((await list("pypi/*")).find((t) => t.id === created.id)).not.toHaveProperty("beyondMaxTTL");
    expect((await list("pypi/*")).map((t) => t.id)).toEqual([created.id]);
    expect((await list("*/*")).map((t) => t.id)).not.toContain(created.id);

    await revokeMaskToken(created.id);
    await revokeMaskToken(created.id);
    expect((await list("pypi/*"))[0]!.revokedAt).not.toBeNull();
    // A repo's own deploy token is revoked under its repo.
    await expect(revokeMaskToken(12)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a token as the credential of a create, and anyone but the admin", async () => {
    signIn("admin");
    // The session's personal access token, as Basic: the admin's, still not a password.
    const session = createToken({ user: "admin" }, { name: `mask test pat ${Math.random()}`, expiresIn: "1h" });
    if ("status" in session) throw new Error(session.message);
    await expect(createMaskToken({ repoMask: "*/payments", name: "x", scopes: ["read"] }, { user: "admin", password: session.secret })).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("admin's password"),
    });

    await expect(createMaskToken({ repoMask: "*/payments", name: "x", scopes: ["read"] }, { user: "alice", password: "alice" })).rejects.toMatchObject({ status: 403 });
    signIn("alice");
    await expect(list()).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a mask that is not one, and a name taken over the same mask", async () => {
    signIn("admin");
    for (const repoMask of ["payments", "npmx/*", "*/Bad_Name", "a/b/c"]) {
      await expect(createMaskToken({ repoMask, name: "x", scopes: ["read"] }, { user: "admin", password: "admin" })).rejects.toMatchObject({ status: 400 });
    }
    // Every format of the server, npm and rpm too, and oci, which needs no plugin.
    for (const repoMask of ["npm/*", "rpm/el9", "oci/*"]) {
      await expect(createMaskToken({ repoMask, name: `over ${repoMask}`, scopes: ["read"] }, { user: "admin", password: "admin" })).resolves.toMatchObject({ repoMask });
    }
    await createMaskToken({ repoMask: "raw/*", name: "twice", scopes: ["write"] }, { user: "admin", password: "admin" });
    await expect(createMaskToken({ repoMask: "raw/*", name: "twice", scopes: ["write"] }, { user: "admin", password: "admin" })).rejects.toMatchObject({ status: 409 });
  });
});
