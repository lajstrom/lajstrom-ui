// The reason of a change in the mock (docs/spec/rbac.md §13, A reason) through the client's calls
// and msw in node: where it goes, what the audit rows keep, and auth.requireReason.

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath, apiSend } from "@/api/client";
import { createBinding, createUserToken, deleteBinding, revokeUserToken, updateUser } from "@/api/mutations";
import { keepReason } from "@/api/reason";
import { setSession } from "@/api/session";
import type { AuditList, Binding, User } from "@/api/types";

import { createToken } from "./auth";
import { serverInfo } from "./data/system";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  serverInfo.requireReason = false;
  keepReason(null);
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string): void {
  const t = createToken({ user }, { name: `reason test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

/** The admin's password, which a token's creation takes (rbac.md §12). */
const admin = { user: "admin", password: "admin" };
const latest = (action: string) => apiGet<AuditList>(apiPath("audit"), { action }).then((r) => r.events[0]!);
const uidOf = (name: string) => apiGet<User>(apiPath("users", name)).then((u) => u.uid);

describe("a reason with each change of the control plane", () => {
  it("is kept in the change's audit row, from the body or from the query", async () => {
    signIn("admin");
    keepReason("CHG-1001: carol reads raw");
    const binding = await createBinding({ principal: "user:carol", role: "reader", repoMask: "raw/*" });
    expect((await latest("binding.create")).details).toMatchObject({ id: binding.id, changeReason: "CHG-1001: carol reads raw" });
    keepReason("CHG-1002: no longer");
    await deleteBinding(binding.id);
    expect((await latest("binding.delete")).details).toMatchObject({ id: binding.id, changeReason: "CHG-1002: no longer" });
  });

  it("is in no row of a change made without one", async () => {
    signIn("admin");
    await updateUser(await uidOf("carol"), { disabled: true });
    await updateUser(await uidOf("carol"), { disabled: false });
    expect((await latest("user.enable")).details).not.toHaveProperty("changeReason");
  });

  it("is kept with a token's creation and its revocation", async () => {
    signIn("admin");
    keepReason("CHG-1003");
    const t = await createUserToken("carol", { name: "reason test", scopes: ["read"] }, admin);
    await revokeUserToken("carol", t.id);
    const rows = await apiGet<AuditList>(apiPath("audit"), { subject: "user:carol" }).then((r) => r.events);
    const created = rows.find((e) => e.action === "token.create" && e.details?.token === t.id);
    const revoked = rows.find((e) => e.action === "token.revoke" && e.details?.token === t.id);
    expect(created?.details).toMatchObject({ changeReason: "CHG-1003" });
    expect(revoked?.details).toMatchObject({ changeReason: "CHG-1003" });
  });

  it("is refused as the server refuses it", async () => {
    signIn("admin");
    const bind = (changeReason: string) => apiSend("POST", apiPath("bindings"), { body: { principal: "user:carol", role: "reader", repoMask: "raw/*", changeReason } });
    await expect(bind("")).rejects.toMatchObject({ status: 400, message: "changeReason: empty: a ticket or a sentence, 1 byte at least" });
    await expect(bind("x".repeat(1025))).rejects.toMatchObject({ status: 400, message: "changeReason: 1025 bytes, at most 1024" });
    await expect(bind("two\nlines")).rejects.toMatchObject({ status: 400, message: "changeReason: a control character (a line break, a tab)" });
    await expect(
      apiSend("POST", apiPath("bindings"), { body: { principal: "user:carol", role: "reader", repoMask: "raw/*", changeReason: "a" }, query: { changeReason: "b" } }),
    ).rejects.toMatchObject({ status: 400, message: "changeReason: in the body or in the query, not both" });
    await expect(apiSend("DELETE", apiPath("bindings", 999), { query: { changeReason: ["a", "b"] } })).rejects.toMatchObject({
      status: 400,
      message: "changeReason: once in the query",
    });
  });

  describe("with auth.requireReason", () => {
    it("is answered by info, and a change without one is 400 naming it, after the role", async () => {
      serverInfo.requireReason = true;
      signIn("admin");
      expect(await apiGet(apiPath("info"))).toMatchObject({ requireReason: true });
      await expect(createBinding({ principal: "user:carol", role: "reader", repoMask: "raw/*" })).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/^changeReason: required \(auth\.requireReason\)/),
      });
      await expect(deleteBinding(1)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^changeReason: required/) });
      // The role first: carol is no admin.
      signIn("carol");
      await expect(createBinding({ principal: "user:carol", role: "admin", repoMask: "*/*" })).rejects.toMatchObject({ status: 403 });
    });

    it("never needs one for a person's own tokens, and does for another user's", async () => {
      serverInfo.requireReason = true;
      signIn("carol");
      const own = await createUserToken("carol", { name: "own, no reason", scopes: ["read"] }, { user: "carol", password: "carol" });
      await revokeUserToken("carol", own.id);
      signIn("admin");
      await expect(createUserToken("carol", { name: "by the admin", scopes: ["read"] }, admin)).rejects.toMatchObject({ status: 400 });
      keepReason("CHG-1004");
      const theirs = await createUserToken("carol", { name: "by the admin", scopes: ["read"] }, admin);
      expect(theirs.name).toBe("by the admin");
      await revokeUserToken("carol", theirs.id);
    });

    it("takes the change with one, and writes nothing without", async () => {
      serverInfo.requireReason = true;
      signIn("admin");
      const before = await apiGet<{ bindings: Binding[] }>(apiPath("bindings")).then((r) => r.bindings.length);
      await expect(createBinding({ principal: "user:carol", role: "writer", repoMask: "npm/*" })).rejects.toMatchObject({ status: 400 });
      expect(await apiGet<{ bindings: Binding[] }>(apiPath("bindings")).then((r) => r.bindings.length)).toBe(before);
      keepReason("CHG-1005");
      const made = await createBinding({ principal: "user:carol", role: "writer", repoMask: "npm/*" });
      await deleteBinding(made.id);
    });
  });
});
