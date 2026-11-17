// The mock's users and bindings (docs/api.md, Users and Bindings) through the client's calls and
// msw in node: the admin's only, what each change does to sign-in, tokens and bindings, the last
// admin kept, and the server's errors.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiGetAs, apiPath, basicAuth } from "@/api/client";
import { changeOwnPassword } from "@/api/auth";
import { createBinding, createUser, deleteBinding, deleteUser, revokeUserToken, setUserPassword, unlockUser, updateUser } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { AuditList, Binding, Token, User, WhoAmI } from "@/api/types";

import { createToken } from "./auth";
import { config, users as seeded } from "./data/system";
import { MUST_CHANGE, userView } from "./db";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

/** Signs in with a personal access token; returns its secret. */
function signIn(user: string): string {
  const t = createToken({ user }, { name: `users test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
  return t.secret;
}

/** Who a password or a token signs in as, outside the session; rejects when it is refused. */
const whoAs = (user: string, secret: string) => apiGetAs<WhoAmI>(apiPath("whoami"), basicAuth(user, secret));

const users = () => apiGet<{ users: User[] }>(apiPath("users")).then((r) => r.users);
const bindingsOf = (principal: string) => apiGet<{ bindings: Binding[] }>(apiPath("bindings"), { principal }).then((r) => r.bindings);
const tokensOf = (user: string) => apiGet<{ tokens: Token[] }>(apiPath("users", user, "tokens")).then((r) => r.tokens);
const audit = (action: string) => apiGet<AuditList>(apiPath("audit"), { action }).then((r) => r.events);

describe("users", () => {
  it("are created by the admin with a password the user then signs in with", async () => {
    signIn("admin");
    const created = await createUser({ name: "frank", password: "correct horse" });
    expect(created).toMatchObject({ name: "frank", kind: "local", disabled: false });
    expect(created.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect((await users()).map((u) => u.name)).toEqual([...(await users()).map((u) => u.name)].sort());
    expect(await apiGet<User>(apiPath("users", "frank"))).toEqual(created);
    expect(await apiGet<User>(apiPath("users", created.uid))).toEqual(created);
    await expect(whoAs("frank", "correct horse")).resolves.toMatchObject({ name: "frank", principal: `user:${created.uid}` });
    await expect(whoAs("frank", "frank")).rejects.toMatchObject({ status: 401 });
    expect(await bindingsOf("user:frank")).toEqual([]);

    const event = (await audit("user.create"))[0]!;
    expect(event).toMatchObject({ principalName: "admin", subject: `user:${created.uid}`, details: { name: "frank", admin: false } });
  });

  it("with admin, get the admin role on */* in the same step", async () => {
    signIn("admin");
    const created = await createUser({ name: "grace", password: "s3cret-enough", admin: true });
    expect(await bindingsOf(`user:${created.uid}`)).toMatchObject([{ principal: `user:${created.uid}`, name: "grace", role: "admin", repoMask: "*/*" }]);
    // admin is the only admin again, for the tests of the last admin.
    await deleteUser(created.uid);
  });

  it("refuse a name or a password that breaks its rule, and a name taken", async () => {
    signIn("admin");
    for (const name of ["", "Frank", "-x", "deploy", "a".repeat(65), "01a1c136-51a6-7883-a350-b1cf6000a23f"]) {
      await expect(createUser({ name, password: "long enough" })).rejects.toMatchObject({ status: 400, code: "INVALID", message: expect.stringMatching(/^name: /) });
    }
    for (const password of ["short", "ljs_pat_0123456789"]) {
      await expect(createUser({ name: "heidi", password })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^password: /) });
    }
    await expect(createUser({ name: "alice", password: "long enough" })).rejects.toMatchObject({ status: 409, message: "user alice already exists" });
    await expect(createUser({ name: "heidi", password: "long enough", role: "admin" } as never)).rejects.toMatchObject({ status: 400, message: 'body: unknown field "role"' });
  });

  it("are the admin's only", async () => {
    signIn("alice");
    await expect(users()).rejects.toMatchObject({ status: 403 });
    await expect(createUser({ name: "ivan", password: "long enough" })).rejects.toMatchObject({ status: 403 });
    await expect(updateUser("bob", { disabled: true })).rejects.toMatchObject({ status: 403 });
    await expect(deleteUser("bob")).rejects.toMatchObject({ status: 403 });
    await expect(setUserPassword("bob", "long enough")).rejects.toMatchObject({ status: 403 });
    await expect(createBinding({ principal: "user:alice", role: "admin", repoMask: "*/*" })).rejects.toMatchObject({ status: 403 });
    await expect(deleteBinding(1)).rejects.toMatchObject({ status: 403 });
    setSession(null);
    await expect(createUser({ name: "ivan", password: "long enough" })).rejects.toMatchObject({ status: 401 });
  });

  it("disabled are refused, with their tokens, until enabled; the last admin is not disabled", async () => {
    const bobs = signIn("bob");
    signIn("admin");
    const disabled = await updateUser("bob", { disabled: true });
    expect(disabled.disabled).toBe(true);
    await expect(whoAs("bob", "bob")).rejects.toMatchObject({ status: 401 });
    await expect(whoAs("bob", bobs)).rejects.toMatchObject({ status: 401 });
    // The same value again changes nothing: no second row.
    await updateUser("bob", { disabled: true });
    expect((await audit("user.disable")).filter((e) => e.details?.name === "bob")).toHaveLength(1);

    expect((await updateUser("bob", { disabled: false })).disabled).toBe(false);
    await expect(whoAs("bob", bobs)).resolves.toMatchObject({ name: "bob" });

    await expect(updateUser("admin", { disabled: true })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("last enabled user with an admin binding") });
    await expect(updateUser("bob", {})).rejects.toMatchObject({ status: 400, message: "body: nothing to change; the fields are name, disabled and mustChange" });
    await expect(updateUser("nobody", { disabled: true })).rejects.toMatchObject({ status: 404, message: "user nobody does not exist" });
  });

  it("renamed keep their uid, password, bindings and tokens", async () => {
    signIn("admin");
    const carol = (await users()).find((u) => u.name === "carol")!;
    const before = await bindingsOf("user:carol");
    const renamed = await updateUser(carol.uid, { name: "caroline" });
    expect(renamed).toMatchObject({ uid: carol.uid, name: "caroline" });
    await expect(apiGet(apiPath("users", "carol"))).rejects.toMatchObject({ status: 404 });
    expect((await bindingsOf("user:caroline")).map((b) => [b.id, b.name])).toEqual(before.map((b) => [b.id, "caroline"]));
    expect((await tokensOf("caroline")).map((t) => t.user)).toContain("caroline");
    await expect(whoAs("caroline", "carol")).resolves.toMatchObject({ principal: `user:${carol.uid}` });
    expect((await audit("user.rename"))[0]).toMatchObject({ subject: `user:${carol.uid}`, details: { from: "carol", name: "caroline" } });

    await expect(updateUser(carol.uid, { name: "alice" })).rejects.toMatchObject({ status: 409, message: "user alice already exists" });
    await expect(updateUser(carol.uid, { name: "Carol" })).rejects.toMatchObject({ status: 400 });
    await updateUser(carol.uid, { name: "carol" });
  });

  it("get a new password, and the old one fails", async () => {
    signIn("admin");
    await setUserPassword("alice", "a new passphrase");
    await expect(whoAs("alice", "alice")).rejects.toMatchObject({ status: 401 });
    await expect(whoAs("alice", "a new passphrase")).resolves.toMatchObject({ name: "alice" });
    await expect(setUserPassword("alice", "short")).rejects.toMatchObject({ status: 400, message: "password: must be at least 8 characters (auth.passwords.minLength)" });
    expect((await audit("user.password"))[0]).toMatchObject({ details: { name: "alice" } });
    // An OIDC user has no password until one is set.
    await expect(whoAs("erin", "erin")).rejects.toMatchObject({ status: 401 });
  });

  it("deleted lose their tokens and bindings, and free the name; the last admin is not deleted", async () => {
    signIn("admin");
    const dave = (await users()).find((u) => u.name === "dave")!;
    const daves = createToken({ user: "dave" }, { name: "before delete", expiresIn: "1h" });
    if ("status" in daves) throw new Error(daves.message);
    await deleteUser(dave.uid);
    expect((await users()).map((u) => u.name)).not.toContain("dave");
    await expect(apiGet(apiPath("users", dave.uid))).rejects.toMatchObject({ status: 404 });
    expect(await bindingsOf(`user:${dave.uid}`)).toEqual([]);
    const all = await apiGet<{ tokens: Token[] }>(apiPath("tokens")).then((r) => r.tokens);
    expect(all.find((t) => t.id === daves.id)?.revokedAt).not.toBeNull();
    expect((await audit("user.delete"))[0]).toMatchObject({ subject: `user:${dave.uid}`, details: { name: "dave", tokensRevoked: 1, bindingsDeleted: 1 } });

    // The name is free; the new user is another one and inherits nothing.
    const again = await createUser({ name: "dave", password: "another one" });
    expect(again.uid).not.toBe(dave.uid);
    expect(await tokensOf("dave")).toEqual([]);

    await expect(deleteUser("admin")).rejects.toMatchObject({ status: 409 });
    await expect(deleteUser("nobody")).rejects.toMatchObject({ status: 404 });
  });

  it("show the groups of an OIDC login", async () => {
    signIn("admin");
    expect((await users()).find((u) => u.name === "erin")).toMatchObject({ kind: "oidc", groups: ["platform", "payments-oncall"] });
  });

  it("record their last activity, to the minute", async () => {
    const seen = async (name: string) => (await users()).find((u) => u.name === name)!.lastSeenAt;
    signIn("admin");
    seeded.find((u) => u.name === "bob")!.lastSeenAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const before = await seen("bob");
    await whoAs("bob", "bob");
    const after = await seen("bob");
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!));
    expect(Date.now() - Date.parse(after!)).toBeLessThan(60_000);
    // Within a minute, no second record.
    await whoAs("bob", "bob");
    expect(await seen("bob")).toBe(after);
    expect((await users()).find((u) => u.name === "bob")).not.toHaveProperty("inactive");
  });

  it("inactive are disabled by their next authentication, and enabling restarts the clock", async () => {
    signIn("admin");
    const judy = (await users()).find((u) => u.name === "judy")!;
    expect(judy).toMatchObject({ disabled: false, inactive: true });
    await expect(whoAs("judy", "judy")).rejects.toMatchObject({ status: 401 });
    const disabled = await apiGet<User>(apiPath("users", "judy"));
    expect(disabled.disabled).toBe(true);
    expect(disabled).not.toHaveProperty("inactive");
    expect(disabled.lastSeenAt).toBe(judy.lastSeenAt);
    expect((await audit("user.disable"))[0]).toMatchObject({
      principal: "anonymous",
      subject: `user:${judy.uid}`,
      details: { name: "judy", source: "inactivity", reason: "inactive", lastSeenAt: judy.lastSeenAt, after: "2160h" },
    });

    const enabled = await updateUser("judy", { disabled: false });
    expect(enabled.disabled).toBe(false);
    expect(enabled).not.toHaveProperty("inactive");
    expect(Date.now() - Date.parse(enabled.lastSeenAt!)).toBeLessThan(60_000);
    await expect(whoAs("judy", "judy")).resolves.toMatchObject({ name: "judy" });
  });

  it("inactive, the last enabled admin is answered so, and its next authentication makes it active again", async () => {
    // The admin's own requests are its activity, so the answer is read without one.
    const admin = seeded.find((u) => u.name === "admin")!;
    admin.lastSeenAt = new Date(Date.now() - 100 * 86_400_000).toISOString();
    expect(userView(admin)).toMatchObject({ inactive: true });
    await expect(whoAs("admin", "admin")).resolves.toMatchObject({ name: "admin" });
    expect(admin.disabled).toBe(false);
    expect(Date.now() - Date.parse(admin.lastSeenAt)).toBeLessThan(60_000);
    expect(userView(admin)).not.toHaveProperty("inactive");
  });
});

describe("passwords (rbac.md §1, Local passwords)", () => {
  const user = (name: string) => apiGet<User>(apiPath("users", name));
  const refusedMessage = "the user name or the password was refused: 10 wrong passwords in a row lock a password for 30m";

  it("are locked by 10 wrong ones in a row, until an admin unlocks them; the tokens keep working", async () => {
    signIn("admin");
    await createUser({ name: "lockme", password: "the right one" });
    const token = createToken({ user: "lockme" }, { name: "kept", expiresIn: "1h" });
    if ("status" in token) throw new Error(token.message);
    // A right password sets the count back: 9, a right one, then 9 more lock nothing.
    for (let i = 0; i < 9; i++) await expect(whoAs("lockme", `wrong ${i}`)).rejects.toMatchObject({ status: 401, message: refusedMessage });
    await expect(whoAs("lockme", "the right one")).resolves.toMatchObject({ name: "lockme" });
    for (let i = 0; i < 9; i++) await expect(whoAs("lockme", `wrong ${i}`)).rejects.toMatchObject({ status: 401 });
    expect(await user("lockme")).not.toHaveProperty("lockedUntil");
    await expect(whoAs("lockme", "the tenth")).rejects.toMatchObject({ status: 401 });

    const locked = await user("lockme");
    expect(Date.parse(locked.lockedUntil!) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect((await audit("login.block"))[0]).toMatchObject({ principal: "anonymous", details: { name: "lockme", limit: "lockout", until: locked.lockedUntil } });
    // The right password is refused as a wrong one, and the token is not locked.
    await expect(whoAs("lockme", "the right one")).rejects.toMatchObject({ status: 401, message: refusedMessage });
    await expect(whoAs("lockme", token.secret)).resolves.toMatchObject({ name: "lockme" });

    await unlockUser("lockme");
    expect(await user("lockme")).not.toHaveProperty("lockedUntil");
    expect((await audit("user.unlock"))[0]).toMatchObject({ principalName: "admin", details: { name: "lockme", lockedUntil: locked.lockedUntil } });
    await expect(whoAs("lockme", "the right one")).resolves.toMatchObject({ name: "lockme" });
    // Unlocking a user that is not locked writes no row.
    const rows = (await audit("user.unlock")).length;
    await unlockUser("lockme");
    expect(await audit("user.unlock")).toHaveLength(rows);
    // Some 30 requests, each with the mock's latency.
  }, 30_000);

  it("are unlocked by an admin's new password too, and the seed's victor is locked", async () => {
    signIn("admin");
    expect(await user("victor")).toHaveProperty("lockedUntil");
    await expect(whoAs("victor", "victor")).rejects.toMatchObject({ status: 401 });
    await setUserPassword("victor", "a new one, handed over");
    expect(await user("victor")).not.toHaveProperty("lockedUntil");
    expect((await audit("user.unlock"))[0]).toMatchObject({ details: { name: "victor" } });
    await expect(whoAs("victor", "a new one, handed over")).resolves.toMatchObject({ name: "victor" });
  });

  it("that must be changed authenticate their own change only: 403 elsewhere, then the change", async () => {
    signIn("admin");
    await createUser({ name: "changeme", password: "from the admin" });
    await updateUser("changeme", { mustChange: true });
    expect(await user("changeme")).toMatchObject({ mustChange: true });
    expect((await audit("user.mustchange"))[0]).toMatchObject({ details: { name: "changeme", mustChange: true } });
    await expect(whoAs("changeme", "from the admin")).rejects.toMatchObject({ status: 403, message: MUST_CHANGE });
    // A wrong password is a 401 as always, so that only the holder of the password learns it.
    await expect(whoAs("changeme", "a guess")).rejects.toMatchObject({ status: 401 });

    await expect(changeOwnPassword("changeme", "a guess", "my own passphrase")).rejects.toMatchObject({ status: 401, message: refusedMessage });
    await expect(changeOwnPassword("changeme", "from the admin", "short")).rejects.toMatchObject({ status: 400 });
    await expect(changeOwnPassword("changeme", "from the admin", "from the admin")).rejects.toMatchObject({
      status: 400,
      message: "password: was used before: choose one that is none of your last 4 passwords",
    });
    await changeOwnPassword("changeme", "from the admin", "my own passphrase");
    expect(await user("changeme")).not.toHaveProperty("mustChange");
    expect((await audit("user.password"))[0]).toMatchObject({ principalName: "changeme", details: { name: "changeme" } });
    await expect(whoAs("changeme", "my own passphrase")).resolves.toMatchObject({ name: "changeme" });

    // None of the last four: the admin's, then two more, then the admin's again is still refused;
    // a fifth back is taken.
    await changeOwnPassword("changeme", "my own passphrase", "the third one");
    await changeOwnPassword("changeme", "the third one", "the fourth one");
    await expect(changeOwnPassword("changeme", "the fourth one", "from the admin")).rejects.toMatchObject({ status: 400 });
    await changeOwnPassword("changeme", "the fourth one", "the fifth one");
    await changeOwnPassword("changeme", "the fifth one", "from the admin");
  });

  it("must be changed at first use of the seed's nina, and of an admin's with changeAtFirstUse", async () => {
    signIn("admin");
    await expect(whoAs("nina", "nina")).rejects.toMatchObject({ status: 403, message: MUST_CHANGE });
    config.changeAtFirstUse = true;
    try {
      expect(await createUser({ name: "firstuse", password: "from the admin" })).toMatchObject({ mustChange: true });
      await changeOwnPassword("firstuse", "from the admin", "chosen by me");
      await setUserPassword("firstuse", "from the admin again");
      expect(await user("firstuse")).toMatchObject({ mustChange: true });
    } finally {
      config.changeAtFirstUse = false;
    }
    // Without the setting, an admin's new password clears it.
    await setUserPassword("firstuse", "and once more");
    expect(await user("firstuse")).not.toHaveProperty("mustChange");
    // A user without a password has none to change.
    await expect(updateUser("erin", { mustChange: true })).rejects.toMatchObject({ status: 400, message: "mustChange: user erin has no password" });
  });
});

describe("bindings", () => {
  it("are created for a user by name or uid, and for a group, and deleted", async () => {
    signIn("admin");
    const bob = (await users()).find((u) => u.name === "bob")!;
    const byName = await createBinding({ principal: "user:bob", role: "reader", repoMask: "pypi/*" });
    expect(byName).toMatchObject({ principal: `user:${bob.uid}`, name: "bob", role: "reader", repoMask: "pypi/*" });
    const byUid = await createBinding({ principal: `user:${bob.uid}`, role: "writer", repoMask: "maven/releases" });
    expect(byUid.name).toBe("bob");
    const group = await createBinding({ principal: "group:release managers", role: "maintainer", repoMask: "*/*" });
    expect(group).toMatchObject({ principal: "group:release managers", role: "maintainer" });
    expect(group.name).toBeUndefined();
    expect((await audit("binding.create"))[0]).toMatchObject({ subject: "group:release managers", details: { id: group.id, role: "maintainer", repoMask: "*/*" } });

    await expect(createBinding({ principal: "user:bob", role: "reader", repoMask: "pypi/*" })).rejects.toMatchObject({ status: 409 });

    for (const b of [byName, byUid, group]) await deleteBinding(b.id);
    expect((await bindingsOf("user:bob")).map((b) => b.id)).not.toContain(byName.id);
    expect((await audit("binding.delete"))[0]).toMatchObject({ details: { id: group.id } });
    await expect(deleteBinding(byName.id)).rejects.toMatchObject({ status: 404, message: `binding ${byName.id} does not exist` });
  });

  it("refuse what cannot be bound, a role or a mask that is not one, and an admin binding not on */*", async () => {
    signIn("admin");
    const refused = [
      { principal: "user:nobody", role: "reader", repoMask: "*/*" },
      { principal: "token:12", role: "reader", repoMask: "*/*" },
      { principal: "anonymous", role: "reader", repoMask: "*/*" },
      { principal: "team:ops", role: "reader", repoMask: "*/*" },
      { principal: "group: ops", role: "reader", repoMask: "*/*" },
      { principal: "user:alice", role: "owner", repoMask: "*/*" },
      { principal: "user:alice", role: "reader", repoMask: "payments" },
      { principal: "user:alice", role: "reader", repoMask: "npmx/*" },
      { principal: "user:alice", role: "admin", repoMask: "raw/*" },
    ] as const;
    for (const req of refused) await expect(createBinding(req as never)).rejects.toMatchObject({ status: 400, code: "INVALID" });
  });

  it("keep the last admin binding of an enabled user", async () => {
    signIn("admin");
    await expect(deleteBinding(1)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("last admin binding") });
    // With another admin, it goes; and the other one's is the last then.
    const other = await createBinding({ principal: "user:bob", role: "admin", repoMask: "*/*" });
    await deleteBinding(1);
    const bobs = signIn("bob");
    await expect(deleteBinding(other.id)).rejects.toMatchObject({ status: 409 });
    await createBinding({ principal: "user:admin", role: "admin", repoMask: "*/*" });
    await deleteBinding(other.id);
    expect(bobs).toMatch(/^ljs_pat_/);
    await expect(apiGet(apiPath("bindings"))).rejects.toMatchObject({ status: 403 });
  });

  it("refuse an id that is not one", async () => {
    signIn("admin");
    await expect(apiGet(apiPath("bindings", "x"))).rejects.toMatchObject({ status: 404 });
    await expect(deleteBinding("x" as never)).rejects.toMatchObject({ status: 400, message: 'id: "x" is not the id of a binding' });
  });

  it("of a group reach a repo through its OIDC members", async () => {
    signIn("admin");
    const erin = createToken({ user: "erin" }, { name: "oidc test", expiresIn: "1h" });
    if ("status" in erin) throw new Error(erin.message);
    setSession({ token: erin.secret, user: "erin", tokenId: erin.id, expiresAt: null });
    const repo = await apiGet<{ permissions?: string[] }>(apiPath("repos", "raw", "scratch"));
    expect(repo.permissions).toEqual(["read", "write", "delete", "manage"]);
    await revokeUserToken("erin", erin.id);
  });
});
