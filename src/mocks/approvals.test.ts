// The mock's requests for a second admin (docs/spec/rbac.md §13) through the client's calls and
// msw in node: what waits, who approves with what, what an approval makes, and the rows.

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath } from "@/api/client";
import { isApproval } from "@/api/approvals";
import { approveRequest, createBinding, createMaskToken, rejectRequest, updateUser } from "@/api/mutations";
import { keepReason } from "@/api/reason";
import { setSession } from "@/api/session";
import type { Approval, ApprovalList, AuditList, Binding, CreatedApproval, ServerInfo, Token, User } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { createToken } from "./auth";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  keepReason(null);
  vi.useRealTimers();
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string): void {
  const t = createToken({ user }, { name: `approvals test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const uidOf = (name: string) => apiGet<User>(apiPath("users", name)).then((u) => u.uid);
const requests = (state?: string) => apiGet<ApprovalList>(apiPath("approvals"), { state }).then((r) => r.approvals);
const bindingsOf = (principal: string) => apiGet<{ bindings: Binding[] }>(apiPath("bindings"), { principal }).then((r) => r.bindings);
const rows = (action: string) => apiGet<AuditList>(apiPath("audit"), { action }).then((r) => r.events);
const asOscar = { user: "oscar", password: "oscar" };

async function ask(req: Parameters<typeof createBinding>[0]): Promise<CreatedApproval> {
  const made = await createBinding(req);
  if (!isApproval(made)) throw new Error("the binding was made, not asked for");
  return made;
}

describe("requests for a second admin", () => {
  it("are what an admin binding and a binding on */* make, with auth.approval second-admin", async () => {
    signIn("admin");
    expect(await apiGet<ServerInfo>(apiPath("info"))).toMatchObject({ approval: "second-admin" });
    keepReason("CHG-3001: carol runs the registry on call");
    const carol = await uidOf("carol");
    const a = await ask({ principal: "user:carol", role: "admin", repoMask: "*/*" });
    expect(a).toMatchObject({ kind: "binding", state: "pending", change: { principal: `user:${carol}`, role: "admin", repoMask: "*/*" }, changeReason: "CHG-3001: carol runs the registry on call" });
    expect(Date.parse(a.expiresAt) - Date.parse(a.requestedAt)).toBe(7 * 86_400_000);
    expect((await bindingsOf("user:carol")).some((b) => b.role === "admin")).toBe(false);
    expect((await rows("approval.request"))[0]).toMatchObject({ principalName: "admin", subject: `approval:${a.id}`, details: { kind: "binding", changeReason: "CHG-3001: carol runs the registry on call" } });
    // The same change pending twice is 409; a binding elsewhere is made at once.
    await expect(createBinding({ principal: "user:carol", role: "admin", repoMask: "*/*" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/^the same change waits for a second admin already/),
    });
    const made = await createBinding({ principal: "user:carol", role: "reader", repoMask: "npm/*" });
    expect(isApproval(made)).toBe(false);
  });

  it("are approved by another admin with the admin's password, which makes the change with both reasons in its rows", async () => {
    signIn("admin");
    const carol = await uidOf("carol");
    const a = (await requests("pending")).find((r) => r.change.principal === `user:${carol}` && r.change.role === "admin")!;
    await expect(approveRequest(a.id, { user: "admin", password: "admin" })).rejects.toMatchObject({ status: 403, message: `request ${a.id}: the admin who made it does not approve it: another admin does` });
    signIn("oscar");
    await expect(approveRequest(a.id)).rejects.toMatchObject({ status: 403, message: "a request is approved with the admin's password or a web UI's fresh sign-in through OIDC, not with a token" });
    keepReason("CHG-3001 checked by oscar");
    const approved = await approveRequest(a.id, asOscar);
    expect(approved).toMatchObject({ state: "approved", decisionReason: "CHG-3001 checked by oscar", result: expect.stringMatching(/^binding:\d+$/) });
    expect((await bindingsOf("user:carol")).some((b) => b.role === "admin")).toBe(true);
    const made = (await rows("binding.create"))[0]!;
    expect(made).toMatchObject({ principalName: "oscar", details: { changeReason: "CHG-3001: carol runs the registry on call", approval: { id: a.id } } });
    expect((await rows("approval.approve"))[0]).toMatchObject({ principalName: "oscar", details: { changeReason: "CHG-3001 checked by oscar" } });
    await expect(approveRequest(a.id, asOscar)).rejects.toMatchObject({ status: 409, message: `request ${a.id} is approved: it was decided` });
  });

  it("are rejected by any admin, the requester withdrawing its own", async () => {
    signIn("admin");
    const bob = (await requests("pending")).find((r) => r.change.role === "maintainer")!;
    const rejected = await rejectRequest(bob.id);
    expect(rejected).toMatchObject({ state: "rejected", decidedBy: `user:${await uidOf("admin")}` });
    await expect(approveRequest(bob.id, asOscar)).rejects.toMatchObject({ status: 409 });
    const mine = await ask({ principal: "group:platform", role: "maintainer", repoMask: "*/*" });
    expect(await rejectRequest(mine.id)).toMatchObject({ state: "rejected" });
    expect((await rows("approval.reject")).map((e) => e.subject)).toEqual(expect.arrayContaining([`approval:${bob.id}`, `approval:${mine.id}`]));
  });

  it("of a deploy token over a mask that publishes answer its secret, which works once approved", async () => {
    signIn("admin");
    const made = await createMaskToken({ repoMask: "npm/*", name: "approvals test", scopes: ["write"] }, { user: "admin", password: "admin" });
    if (!isApproval(made)) throw new Error("the token was made, not asked for");
    expect(made).toMatchObject({ kind: "deploy-token", change: { repoMask: "npm/*", name: "approvals test", scopes: ["write"] } });
    const secret = made.secret!;
    expect(secret).toMatch(/^ljs_dep_/);
    const overNpm = () => apiGet<{ tokens: Token[] }>(apiPath("deploy-tokens"), { repoMask: "npm/*" }).then((r) => r.tokens.find((t) => t.name === "approvals test"));
    expect(await overNpm()).toBeUndefined();
    // One that only reads is made at once.
    const reads = await createMaskToken({ repoMask: "npm/*", name: "approvals test reads", scopes: ["read"] }, { user: "admin", password: "admin" });
    expect(isApproval(reads)).toBe(false);
    signIn("oscar");
    const approved = await approveRequest(made.id, asOscar);
    expect(approved.result).toMatch(/^token:\d+$/);
    // The token the approval made has the secret the requester was shown.
    expect(await overNpm()).toMatchObject({ id: Number(approved.result!.slice(6)), hashPrefix: sha256Hex(secret).slice(0, 8) });
    expect(approved).not.toHaveProperty("secret");
  });

  it("are not approved once their requester is no enabled admin", async () => {
    signIn("oscar");
    const a = await ask({ principal: "user:bob", role: "admin", repoMask: "*/*" });
    signIn("admin");
    await updateUser(await uidOf("oscar"), { disabled: true });
    await expect(approveRequest(a.id, { user: "admin", password: "admin" })).rejects.toMatchObject({ status: 409, message: `request ${a.id}: its requester oscar is disabled` });
    expect((await requests("pending")).map((r) => r.id)).toContain(a.id);
    await updateUser(await uidOf("oscar"), { disabled: false });
    await rejectRequest(a.id);
  });

  it("expire 7 days after they were made, each with its row", async () => {
    signIn("admin");
    const a = await ask({ principal: "user:dave", role: "admin", repoMask: "*/*" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 7 * 86_400_000 + 1000);
    signIn("admin");
    const got = await apiGet<Approval>(apiPath("approvals", a.id));
    expect(got).toMatchObject({ state: "expired", decidedBy: "anonymous" });
    expect((await rows("approval.expire")).find((e) => e.subject === `approval:${a.id}`)).toMatchObject({ principal: "anonymous", details: { source: "expiry" } });
    await expect(rejectRequest(a.id)).rejects.toMatchObject({ status: 409 });
  });

  it("are listed newest first by state, the admin's only", async () => {
    signIn("admin");
    const all = await requests();
    expect(all.map((r) => r.id)).toEqual([...all.map((r) => r.id)].sort((x, y) => y - x));
    expect((await requests("rejected")).every((r) => r.state === "rejected")).toBe(true);
    await expect(requests("waiting")).rejects.toMatchObject({ status: 400 });
    const first = await apiGet<ApprovalList>(apiPath("approvals"), { limit: 2 });
    expect(first.approvals).toHaveLength(2);
    const second = await apiGet<ApprovalList>(apiPath("approvals"), { limit: 2, cursor: first.next });
    expect(second.approvals[0]!.id).toBeLessThan(first.approvals[1]!.id);
    signIn("bob");
    await expect(requests()).rejects.toMatchObject({ status: 403 });
  });
});
