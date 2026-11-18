// What takes a password in the mock (docs/spec/rbac.md §12, A fresh sign-in in place of a
// password), and the admin mode (auth.admin.requireMFA), through the client's calls and msw in
// node. The demo has no OIDC login, so no sign-in of it stands for a password or has a second
// factor.

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath } from "@/api/client";
import { createMaskToken, createUserToken } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { ServerInfo } from "@/api/types";

import { createToken } from "./auth";
import { serverInfo } from "./data/system";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  delete serverInfo.adminMFA;
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string): void {
  const t = createToken({ user }, { name: `fresh test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

describe("a creation that takes a password", () => {
  it("of a personal access token is refused with a token, and made with the password", async () => {
    signIn("carol");
    await expect(createUserToken("carol", { name: "with the session" })).rejects.toMatchObject({
      status: 403,
      message: "a personal access token is created with a password or a web UI's fresh sign-in through OIDC, not with a token",
    });
    await expect(createUserToken("carol", { name: "with a password" }, { user: "carol", password: "carol" })).resolves.toMatchObject({ name: "with a password", user: "carol" });
  });

  it("of a deploy token over a mask is refused with a token", async () => {
    signIn("admin");
    await expect(createMaskToken({ repoMask: "npm/*", name: "with the session", scopes: ["read"] })).rejects.toMatchObject({
      status: 403,
      message: "a deploy token over a mask is created with the admin's password or a web UI's fresh sign-in through OIDC, not with a token",
    });
  });
});

describe("the admin mode", () => {
  it("leaves an admin binding out for any credential but a sign-in through OIDC with a second factor, and says so", async () => {
    serverInfo.adminMFA = true;
    signIn("admin");
    const info = await apiGet<ServerInfo>(apiPath("info"));
    expect(info).toMatchObject({ adminMFA: true, caller: { name: "admin", admin: false, adminNeedsMFA: true } });
    await expect(apiGet(apiPath("users"))).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/^the admin role counts only for a web UI's sign-in through OIDC with a second factor \(auth\.admin\.requireMFA\): /),
    });
    // The admin's one binding is admin: it does what anonymous does on the repos.
    const repos = await apiGet<{ repos: { permissions: string[]; anonymousRead: boolean }[] }>(apiPath("repos")).then((r) => r.repos);
    expect(repos.length).toBeGreaterThan(0);
    expect(repos.every((r) => r.anonymousRead && r.permissions.join() === "read")).toBe(true);
    // A user without an admin binding needs nothing more.
    signIn("bob");
    expect((await apiGet<ServerInfo>(apiPath("info"))).caller).not.toHaveProperty("adminNeedsMFA");
    await expect(apiGet(apiPath("users"))).rejects.toMatchObject({ status: 403, message: "this needs the admin role (system resource, rbac.md §2)" });
  });

  it("is off by default: info answers no adminMFA, and the admin is the admin", async () => {
    signIn("admin");
    const info = await apiGet<ServerInfo>(apiPath("info"));
    expect(info).not.toHaveProperty("adminMFA");
    expect(info.caller).toMatchObject({ admin: true });
    expect(info.caller).not.toHaveProperty("adminNeedsMFA");
  });
});
