// The mock's CI trust policies (docs/api.md, CI trust policies; docs/spec/rbac.md §11) through
// the client's calls and msw in node: the admin's only, the configuration's read-only, the
// rules by field, revisions, and the steps of a policy that writes: a fresh sign-in with a
// second factor, the repos it may write to, a second admin, and its expiry and renewal.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { signInWithPassword, signOut } from "@/api/auth";
import { apiGet, apiGetTagged, apiPath, sendChange, type ChangeRequest } from "@/api/client";
import { ciPolicyChanges, createUser, type CIPolicyBody } from "@/api/mutations";
import { getSession, setSession } from "@/api/session";
import { needsStepUp } from "@/api/step-up";
import type { AuditList, CIPolicy, CIPolicyList, WhoAmI } from "@/api/types";

import { createToken, recordSignIn } from "./auth";
import { handlers } from "./handlers";

const server = setupServer(...handlers);
// Each request waits the mock's latency, up to 310 ms: a test of many needs more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(async () => {
  await signOut();
  server.close();
  vi.unstubAllGlobals();
});

/** Signs in with a personal access token, a credential that is no sign-in at the IdP. */
function withToken(user: string) {
  const t = createToken({ user }, { name: `ci test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

/** Signs in as a web UI does, and gives the token the sign-in of an OIDC login: authenticated
 * at the IdP minutesAgo, with the methods of amr. */
async function withSignIn(user: string, minutesAgo = 0, amr = ["pwd", "otp"]) {
  await signInWithPassword(user, user === "frank" ? "correct horse" : user);
  recordSignIn(getSession()!.tokenId!, { at: Date.now() - minutesAgo * 60_000, amr });
}

const list = () => apiGet<CIPolicyList>(apiPath("ci", "policies"));
const one = (name: string) => apiGetTagged<CIPolicy>(apiPath("ci", "policies", name));
const send = (req: ChangeRequest) => sendChange<CIPolicy>(req);
const audit = (subject: string) => apiGet<AuditList>(apiPath("audit")).then((r) => r.events.filter((e) => e.subject === subject));

const reader = (name: string): CIPolicyBody => ({
  name,
  issuer: "github",
  claims: { repository_id: ["123"], ref: ["refs/heads/*"] },
  grants: [{ role: "reader", mask: "pypi/internal" }],
});

const writer = (name: string): CIPolicyBody => ({
  name,
  issuer: "gitlab",
  claims: { project_id: ["77"], ref_path: ["refs/heads/main"] },
  grants: [{ role: "writer", mask: "pypi/payments" }],
});

const days = (iso: string | undefined) => (Date.parse(iso!) - Date.now()) / 86_400_000;

describe("the list", () => {
  it("has the configuration's first, then the API's by id, with their states and the issuers", async () => {
    withToken("admin");
    const { policies, issuers } = await list();
    expect(policies.slice(0, 2).map((p) => [p.name, p.source, p.state])).toEqual([
      ["release-agent", "config", "active"],
      ["docs-read", "config", "active"],
    ]);
    expect(policies[0]!.createdBy).toBeUndefined();
    const api = policies.filter((p) => p.source === "api");
    expect(Object.fromEntries(api.map((p) => [p.name, p.state]))).toMatchObject({
      "pipelines-read": "active",
      "payments-publish": "active",
      "web-publish": "active",
      "billing-publish": "pending",
      "agent-nightly-publish": "expired",
    });
    expect(api.find((p) => p.name === "web-publish")!.renewal?.expiresAt).toBeDefined();
    expect(api.find((p) => p.name === "pipelines-read")!.expiresAt).toBeUndefined();
    expect(api[0]!.updatedBy).toMatch(/^user:[0-9a-f-]{36}$/);
    expect(issuers).toEqual([
      { name: "github", platform: "github" },
      { name: "gitlab", platform: "gitlab" },
    ]);
  });

  it("is the admin's: 401 without credentials, 403 for anyone else", async () => {
    setSession(null);
    await expect(list()).rejects.toMatchObject({ status: 401 });
    withToken("alice");
    await expect(list()).rejects.toMatchObject({ status: 403 });
    await expect(send(ciPolicyChanges.create(reader("by-alice")))).rejects.toMatchObject({ status: 403 });
  });
});

describe("a policy that reads", () => {
  it("is made, changed and deleted at once, each change on the revision it read", async () => {
    withToken("admin");
    const made = await send(ciPolicyChanges.create(reader("lib-read")));
    expect(made.data).toMatchObject({ name: "lib-read", source: "api", state: "active", grants: [{ role: "reader", mask: "pypi/internal" }] });
    expect(made.data.expiresAt).toBeUndefined();
    expect(made.etag).toMatch(/^"[A-Za-z0-9_-]{16}"$/);
    expect((await one("lib-read")).etag).toBe(made.etag);

    const body = { ...reader("lib-read"), grants: [{ role: "reader" as const, mask: "pypi/*" }] };
    const changed = await send(ciPolicyChanges.replace("lib-read", body, made.etag));
    expect(changed.data.grants).toEqual([{ role: "reader", mask: "pypi/*" }]);
    expect(changed.etag).not.toBe(made.etag);

    // The revision read is gone: nothing changes, and the answer has the ETag now.
    const res = await fetch("http://localhost/api/v1/ci/policies/lib-read", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${getSession()!.token}`, "If-Match": made.etag! },
    });
    expect(res.status).toBe(412);
    expect(res.headers.get("ETag")).toBe(changed.etag);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/^CI trust policy lib-read changed since it was read: its ETag is now "/);
    await expect(send(ciPolicyChanges.replace("lib-read", body, made.etag))).rejects.toMatchObject({ status: 412, code: "CONFLICT" });

    await send(ciPolicyChanges.remove("lib-read", changed.etag));
    await expect(one("lib-read")).rejects.toMatchObject({ status: 404, message: "policy lib-read does not exist" });

    withToken("admin");
    expect((await audit("lib-read")).map((e) => e.action)).toEqual(["ci.policy.delete", "ci.policy.update", "ci.policy.create"]);
  });

  it("answers 304 to an If-None-Match of its revision", async () => {
    withToken("admin");
    const { etag } = await one("pipelines-read");
    const res = await fetch("http://localhost/api/v1/ci/policies/pipelines-read", {
      headers: { Authorization: `Bearer ${getSession()!.token}`, "If-None-Match": etag! },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(etag);
  });

  it("does not expire: an expiry is refused, and so is its renewal", async () => {
    withToken("admin");
    await expect(send(ciPolicyChanges.create({ ...reader("dated-read"), expiresAt: new Date(Date.now() + 86_400_000).toISOString() }))).rejects.toMatchObject({
      status: 400,
      message: "expiresAt: a policy that grants reader only does not expire",
    });
    await expect(send(ciPolicyChanges.renew("pipelines-read", undefined, null))).rejects.toMatchObject({
      status: 409,
      message: "policy pipelines-read grants reader only: it does not expire",
    });
  });
});

describe("the rules", () => {
  it("refuse each problem naming its field, joined by semicolons", async () => {
    withToken("admin");
    const broken: CIPolicyBody = {
      name: "Bad Name",
      issuer: "github",
      claims: { project_id: ["1"], repository_owner: ["acme*"], actor_id: ["12a"], ref: [] },
      grants: [
        { role: "admin" as never, mask: "pypi" },
        { role: "writer", mask: "*/*" },
      ],
    };
    await expect(send(ciPolicyChanges.create(broken))).rejects.toMatchObject({
      status: 400,
      code: "INVALID",
      message: [
        'name: "Bad Name" is not lowercase letters and digits with single hyphens, at most 63 bytes',
        'claims.actor_id: "12a" is not an id, decimal digits',
        "claims.project_id: is not a claim a policy of github names",
        "claims.ref: must have a value",
        'claims.repository_owner: "acme*" has *, a wildcard in ref, environment and workflow claims only',
        "claims: must name the project by an id, repository_id or repository_owner_id: a name can be registered again by anyone",
        "grants[0].role: admin is not for a CI token: reader, writer or maintainer",
        'grants[0].mask: "pypi" is not <format>/<repo>',
      ].join("; "),
    });
  });

  it("refuse an issuer the configuration does not have, and a write policy of pull requests", async () => {
    withToken("admin");
    await expect(send(ciPolicyChanges.create({ ...reader("x"), issuer: "jenkins" }))).rejects.toMatchObject({
      status: 400,
      message: 'issuer: "jenkins" is no issuer of auth.ci.issuers',
    });
    const prs = { ...writer("x"), claims: { project_id: ["7"], pipeline_source: ["merge_request_event"] } };
    await expect(send(ciPolicyChanges.create(prs))).rejects.toMatchObject({
      status: 400,
      message:
        "claims: a policy that grants writer or maintainer needs ref, ref_path, environment: without it every branch and pull request publishes; claims.pipeline_source: names only pull requests, which never write",
    });
  });

  it("keep the configuration's read-only: 409", async () => {
    withToken("admin");
    const { data, etag } = await one("release-agent");
    expect(data.source).toBe("config");
    expect(etag).toBeNull();
    const declared = "policy release-agent is declared in the configuration (auth.ci.policies): it changes there";
    await expect(send(ciPolicyChanges.replace("release-agent", reader("release-agent"), null))).rejects.toMatchObject({ status: 409, message: declared });
    await expect(send(ciPolicyChanges.remove("release-agent", null))).rejects.toMatchObject({ status: 409, message: declared });
    await expect(send(ciPolicyChanges.renew("release-agent", undefined, null))).rejects.toMatchObject({ status: 409 });
    await expect(send(ciPolicyChanges.approve("release-agent", '"x"'))).rejects.toMatchObject({ status: 409 });
    await expect(send(ciPolicyChanges.create(reader("release-agent")))).rejects.toMatchObject({
      status: 409,
      message: "policy release-agent is a policy of the configuration (auth.ci.policies)",
    });
  });
});

describe("a policy that writes", () => {
  it("needs a fresh sign-in with a second factor: a token, a stale sign-in or one factor is refused", async () => {
    withToken("admin");
    const err = await send(ciPolicyChanges.create(writer("needs-mfa"))).catch((e: unknown) => e);
    expect(err).toMatchObject({
      status: 403,
      message:
        "a policy of the API that grants write: this needs a sign-in with a second factor within the last 10 minutes, and the request's credential is a personal access token, or a web UI's token of a password or of a login without auth_time: sign in again in a web UI through OIDC (prompt=login), with a second factor",
    });
    expect(needsStepUp(err)).toBe(true);

    await signInWithPassword("admin", "admin");
    await expect(send(ciPolicyChanges.create(writer("needs-mfa")))).rejects.toMatchObject({ status: 403, message: expect.stringContaining("a web UI's token of a password") });
    await withSignIn("admin", 12);
    await expect(send(ciPolicyChanges.create(writer("needs-mfa")))).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("this sign-in authenticated at the identity provider 12m0s ago"),
    });
    await withSignIn("admin", 0, ["pwd"]);
    await expect(send(ciPolicyChanges.create(writer("needs-mfa")))).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining("this sign-in's amr (pwd) shows none"),
    });
    // The rules and the repos come first: the form shows them before any sign-in.
    await expect(send(ciPolicyChanges.create({ ...writer("needs-mfa"), name: "" }))).rejects.toMatchObject({ status: 400 });
    await expect(send(ciPolicyChanges.create({ ...writer("needs-mfa"), grants: [{ role: "maintainer", mask: "maven/releases" }] }))).rejects.toMatchObject({
      status: 403,
      message: "grants[0]: maintainer on maven/releases is outside auth.ci.apiWriteRepos, */payments, npm/*, raw/*; write to other repos in the configuration (auth.ci.policies)",
    });
    await expect(send(ciPolicyChanges.create({ ...writer("needs-mfa"), expiresAt: new Date(Date.now() + 181 * 86_400_000).toISOString() }))).rejects.toMatchObject({
      status: 400,
      message: "expiresAt: must be at most 180 days ahead, a policy that grants write is renewed",
    });
  });

  it("waits for another admin, who approves the revision read", async () => {
    await withSignIn("admin");
    const made = await send(ciPolicyChanges.create(writer("billing-deploy")));
    expect(made.data).toMatchObject({ state: "pending", updatedBy: made.data.createdBy });
    expect(days(made.data.expiresAt)).toBeCloseTo(180, 1);
    await expect(send(ciPolicyChanges.approve("billing-deploy", made.etag!))).rejects.toMatchObject({
      status: 403,
      message: "policy billing-deploy: the admin who made the change that waits does not approve it: another admin does",
    });
    await createUser({ name: "frank", password: "correct horse", admin: true });

    await withSignIn("frank");
    const frank = await apiGet<WhoAmI>(apiPath("whoami"));
    await expect(send({ ...ciPolicyChanges.approve("billing-deploy", made.etag!), ifMatch: undefined })).rejects.toMatchObject({
      status: 400,
      message: "If-Match: an approval names the revision it approves: send the ETag of the policy as you read it",
    });
    await expect(send(ciPolicyChanges.approve("billing-deploy", "*"))).rejects.toMatchObject({ status: 400 });

    // Changed meanwhile: an approval names what it approves.
    await withSignIn("admin");
    const changed = await send(ciPolicyChanges.replace("billing-deploy", { ...writer("billing-deploy"), claims: { project_id: ["77"], ref_path: ["refs/tags/*"] } }, made.etag));
    await withSignIn("frank");
    await expect(send(ciPolicyChanges.approve("billing-deploy", made.etag!))).rejects.toMatchObject({ status: 412 });
    const approved = await send(ciPolicyChanges.approve("billing-deploy", changed.etag!));
    expect(approved.data).toMatchObject({ state: "active", approvedBy: frank.principal, claims: { ref_path: ["refs/tags/*"] } });
    await expect(send(ciPolicyChanges.approve("billing-deploy", approved.etag!))).rejects.toMatchObject({ status: 409, message: "policy billing-deploy waits for no approval" });

    // A renewal waits beside it; the policy keeps its expiry until another admin approves it.
    await expect(send(ciPolicyChanges.renew("billing-pending", undefined, null))).rejects.toMatchObject({ status: 404 });
    const asked = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const renewed = await send(ciPolicyChanges.renew("billing-deploy", asked, approved.etag));
    expect(renewed.data).toMatchObject({ state: "active", expiresAt: approved.data.expiresAt, updatedBy: frank.principal });
    expect(days(renewed.data.renewal?.expiresAt)).toBeCloseTo(90, 1);
    await withSignIn("admin");
    const done = await send(ciPolicyChanges.approve("billing-deploy", renewed.etag!));
    expect(done.data.renewal).toBeUndefined();
    expect(days(done.data.expiresAt)).toBeCloseTo(90, 1);

    // A change to read only counts at once, without an expiry.
    const narrowed = await send(ciPolicyChanges.replace("billing-deploy", { ...writer("billing-deploy"), grants: [{ role: "reader", mask: "pypi/payments" }] }, done.etag));
    expect(narrowed.data).toMatchObject({ state: "active" });
    expect(narrowed.data.expiresAt).toBeUndefined();
    expect(narrowed.data.approvedBy).toBeUndefined();

    expect((await audit("billing-deploy")).map((e) => e.action)).toEqual([
      "ci.policy.update",
      "ci.policy.approve",
      "ci.policy.renew",
      "ci.policy.approve",
      "ci.policy.update",
      "ci.policy.create",
    ]);
  });

  it("renews an expired one pending, and refuses to renew a pending one", async () => {
    await withSignIn("admin");
    const expired = await one("agent-nightly-publish");
    expect(expired.data.state).toBe("expired");
    const renewed = await send(ciPolicyChanges.renew("agent-nightly-publish", undefined, expired.etag));
    expect(renewed.data).toMatchObject({ state: "pending" });
    expect(renewed.data.approvedBy).toBeUndefined();
    expect(days(renewed.data.expiresAt)).toBeCloseTo(180, 1);
    await expect(send(ciPolicyChanges.renew("billing-publish", undefined, null))).rejects.toMatchObject({
      status: 409,
      message: "policy billing-publish waits for an admin's approval: approve it, or change it with its new expiresAt",
    });
  });
});
