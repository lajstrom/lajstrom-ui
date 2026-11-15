// The mock's users and bindings (docs/api.md, Users and Bindings) through the client's calls and
// msw in node: the admin's only, what each change does to sign-in, tokens and bindings, the last
// admin kept, and the server's errors.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiGetAs, apiPath, basicAuth } from "@/api/client";
import { createBinding, createUser, deleteBinding, deleteUser, revokeUserToken, setUserPassword, updateUser } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { AuditList, Binding, Token, User, WhoAmI } from "@/api/types";

import { createToken } from "./auth";
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
    await expect(updateUser("bob", {})).rejects.toMatchObject({ status: 400, message: "body: nothing to change; the fields are name and disabled" });
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
    await expect(setUserPassword("alice", "short")).rejects.toMatchObject({ status: 400, message: "password: must be at least 8 bytes" });
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
