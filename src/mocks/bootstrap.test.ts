// The mock's POST /api/v1/bootstrap (docs/api.md, The first admin), through the client's calls and
// msw in node: the refusals of the server in its order, the first admin made once and signed in
// as, and the 404 of a server that has its admin. The tests run in order: the token is used once.

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createFirstAdmin, signInWithPassword } from "@/api/auth";
import { apiGet, apiPath, apiSend } from "@/api/client";
import { getSession, setSession } from "@/api/session";
import type { AuditList, Binding, ServerInfo, User, WhoAmI } from "@/api/types";
import { DEMO_BOOTSTRAP_TOKEN } from "@/app/demo";

import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  vi.useRealTimers();
  setSession(null);
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

const exchange = (body: unknown) => apiSend<User>("POST", apiPath("bootstrap"), { body, authorization: "" });
const right = { token: DEMO_BOOTSTRAP_TOKEN, name: "root", password: "correct horse" };

describe("POST /api/v1/bootstrap in the demo", () => {
  it("refuses the client after 10 wrong tokens within a minute, the right token too, with Retry-After", async () => {
    // A clock that stands two minutes ago, so that the window has closed when it is real again.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 120_000);
    await Promise.all(Array.from({ length: 10 }, () => expect(exchange({ ...right, token: "wrong" })).rejects.toMatchObject({ status: 403 })));
    await expect(exchange({ ...right, name: "Root" })).rejects.toMatchObject({
      status: 429,
      code: "UNAVAILABLE",
      retryAfter: 60,
      message: expect.stringContaining("too many wrong bootstrap tokens"),
    });
    vi.setSystemTime(Date.now() + 61_000);
    // The window has closed: the right token gets to the name again.
    await expect(exchange({ ...right, name: "Root" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a wrong token with the server's message, and a body that is not one", async () => {
    await expect(createFirstAdmin({ ...right, token: "not-the-token" })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "the bootstrap token is refused",
    });
    expect(getSession()).toBeNull();
    await expect(exchange({ ...right, admin: true })).rejects.toMatchObject({ status: 400, message: 'body: unknown field "admin"' });
    await expect(exchange({ ...right, password: 12345678 })).rejects.toMatchObject({ status: 400, message: "password: must not be a JSON number" });
    await expect(exchange([right])).rejects.toMatchObject({ status: 400, message: "body: must be a JSON object" });
    // Fields left out are empty, as the server decodes them: the empty token is a wrong one.
    await expect(exchange({})).rejects.toMatchObject({ status: 403 });
  });

  it("checks the name and the password after the token, and leaves the token valid", async () => {
    for (const [req, text] of [
      [{ ...right, name: "Root" }, 'name: "Root" must be lowercase letters'],
      [{ ...right, name: "" }, "name: must not be empty"],
      [{ ...right, name: "deploy" }, 'name: "deploy" is reserved'],
      [{ ...right, name: "01a1c9a1-8909-7932-b435-6fc48e1e252b" }, "has the form of a uid"],
      [{ ...right, password: "short" }, "password: must be at least 8 bytes"],
      [{ ...right, password: "ljs_pat_looks-like-a-token" }, "password: must not start with ljs_pat_ or ljs_dep_"],
    ] as const) {
      await expect(exchange(req)).rejects.toMatchObject({ status: 400, code: "INVALID", message: expect.stringContaining(text) });
    }
    // A wrong token goes first: its refusal says nothing of the name.
    await expect(exchange({ ...right, token: "x", name: "Root" })).rejects.toMatchObject({ status: 403 });
    // A name taken by a user, a disabled one too.
    await expect(exchange({ ...right, name: "alice" })).rejects.toMatchObject({ status: 409, code: "CONFLICT", message: "user alice already exists" });
    await expect(exchange({ ...right, name: "dave" })).rejects.toMatchObject({ status: 409 });
  });

  it("creates the admin once, with the admin binding on */*, signs in as it, and then answers 404", async () => {
    const user = await createFirstAdmin({ ...right, token: `  ${DEMO_BOOTSTRAP_TOKEN}\n` });
    expect(user).toMatchObject({ name: "root", kind: "local", disabled: false });

    // Signed in as the new admin, with a token of this browser.
    expect(getSession()).toMatchObject({ user: "root", tokenId: expect.any(Number) });
    expect(await apiGet<WhoAmI>(apiPath("whoami"))).toMatchObject({ name: "root", uid: user.uid });
    expect((await apiGet<ServerInfo>(apiPath("info"))).caller).toMatchObject({ name: "root", admin: true });
    const { bindings } = await apiGet<{ bindings: Binding[] }>(apiPath("bindings"), { principal: "user:root" });
    expect(bindings).toEqual([expect.objectContaining({ principal: `user:${user.uid}`, role: "admin", repoMask: "*/*" })]);
    const { users } = await apiGet<{ users: User[] }>(apiPath("users"));
    expect(users.map((u) => u.name)).toEqual(expect.arrayContaining(["admin", "alice", "bob", "carol", "dave", "root"]));

    // One user.create by anonymous, from the bootstrap; no binding.create of its own.
    const audit = await apiGet<AuditList>(apiPath("audit"), { action: "user.create" });
    expect(audit.events.filter((e) => e.subject === `user:${user.uid}`)).toEqual([
      expect.objectContaining({ principal: "anonymous", details: { admin: true, name: "root", source: "bootstrap" } }),
    ]);
    const bindingEvents = await apiGet<AuditList>(apiPath("audit"), { action: "binding.create" });
    expect(bindingEvents.events.filter((e) => e.subject === `user:${user.uid}`)).toEqual([]);

    // The server has an admin now: every request is the 404 of a path that is no endpoint.
    for (const body of [right, { ...right, name: "second" }, { token: "wrong" }]) {
      await expect(exchange(body)).rejects.toMatchObject({
        status: 404,
        code: "NOT_FOUND",
        message: "POST /api/v1/bootstrap is not an endpoint of this version (docs/api.md)",
      });
    }
  });

  it("keeps the demo's accounts, and signs the new admin in with its password only", async () => {
    await signInWithPassword("alice", "alice");
    expect(getSession()?.user).toBe("alice");
    await signInWithPassword("root", "correct horse");
    expect(getSession()?.user).toBe("root");
    await expect(signInWithPassword("root", "root")).rejects.toMatchObject({ name: "SignInError" });
  });
});
