// The mock's webhooks (docs/api.md, Webhooks) through the client's calls and msw in node: the
// routes of a repo and those of every mask, who may use them, the server's errors, the delivery
// log and its cursor, and a server without a master key.

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath } from "@/api/client";
import { createWebhook, deleteWebhook, rotateWebhookSecret, testWebhook, updateWebhook } from "@/api/mutations";
import { webhooksPath, type WebhookScope } from "@/api/queries";
import { setSession } from "@/api/session";
import type { AuditList, DeliveryList, Webhook } from "@/api/types";

import { createToken } from "./auth";
import { handlers } from "./handlers";
import { setMasterKey } from "./webhooks";

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
afterEach(() => setMasterKey(true));

/** Signs in with a personal access token; null signs out. */
function signIn(user: string | null) {
  if (!user) return setSession(null);
  const t = createToken({ user }, { name: `webhooks test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const apt: WebhookScope = { format: "apt", repo: "ubuntu-internal" };
const list = (scope: WebhookScope) => apiGet<{ webhooks: Webhook[] }>(webhooksPath(scope)).then((r) => r.webhooks);
const one = (scope: WebhookScope, id: number) => apiGet<Webhook>(webhooksPath(scope, id));
const log = (scope: WebhookScope, id: number, query: Record<string, string | number> = {}) => apiGet<DeliveryList>(webhooksPath(scope, id, "deliveries"), query);

describe("a repo's webhooks", () => {
  it("are created with a secret shown once, changed, given a new secret and deleted with their log", async () => {
    signIn("bob"); // maintainer of apt/*
    const created = await createWebhook(apt, { url: "https://ci.example.com/hooks/apt", events: ["version.published", "version.deleted", "version.published"] });
    expect(created).toMatchObject({ mask: "apt/ubuntu-internal", active: true, description: "", events: ["version.deleted", "version.published"] });
    expect(created.secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(created.createdBy).toMatch(/^user:[0-9a-f-]{36}$/);

    const listed = await list(apt);
    expect(listed.map((w) => w.id)).toContain(created.id);
    expect(JSON.stringify(listed)).not.toContain("secret");
    expect(JSON.stringify(await one(apt, created.id))).not.toContain(created.secret);

    const changed = await updateWebhook(apt, created.id, { url: "https://ci2.example.com/x", events: [], active: false, description: "mirror" });
    expect(changed).toMatchObject({ url: "https://ci2.example.com/x", events: [], active: false, description: "mirror", mask: created.mask });
    expect(await one(apt, created.id)).toEqual(changed);

    const rotated = await rotateWebhookSecret(apt, created.id);
    expect(rotated.secret).toMatch(/^whsec_/);
    expect(rotated.secret).not.toBe(created.secret);

    // A ping goes to an inactive webhook too, and is the newest row of its log.
    const ping = await testWebhook(apt, created.id);
    expect(ping).toMatchObject({ eventType: "webhook.ping", state: "delivered", attempts: 1, lastStatus: 200 });
    expect(ping.deliveredAt).toBeDefined();
    expect((await log(apt, created.id)).deliveries[0]).toEqual(ping);

    await deleteWebhook(apt, created.id);
    await expect(one(apt, created.id)).rejects.toMatchObject({ status: 404, message: `webhook ${created.id} does not exist` });
    await expect(log(apt, created.id)).rejects.toMatchObject({ status: 404 });
    await expect(deleteWebhook(apt, created.id)).rejects.toMatchObject({ status: 404 });

    signIn("admin");
    const audit = await apiGet<AuditList>(apiPath("audit"), { repo: "apt/ubuntu-internal" });
    const rows = audit.events.filter((e) => e.subject === `webhook:${created.id}`);
    expect(rows.map((e) => e.action).sort()).toEqual(["webhook.create", "webhook.delete", "webhook.secret", "webhook.update"]);
    expect(rows[0]!.details).toMatchObject({ mask: "apt/ubuntu-internal", urlHost: "ci2.example.com" });
    expect(JSON.stringify(rows)).not.toMatch(/whsec_|\/x"/);
  });

  it("refuses a field that breaks its rule, naming it", async () => {
    signIn("bob");
    const { id } = await createWebhook(apt, { url: "https://ci.example.com/hooks/rules" });
    for (const [req, message] of [
      [{ mask: "apt/ubuntu-internal" }, "mask: cannot change"],
      [{ url: "http://ci.example.com/" }, "url: must be https"],
      [{ url: "https://169.254.169.254/x" }, "url: names an address that is not public"],
      [{ url: "https://10.0.0.7/x" }, "url: names an address that is not public"],
      [{ url: "https://u:p@ci.example.com" }, "url: must not hold user information"],
      [{ url: "https://ci.example.com/#x" }, "url: must not have a fragment"],
      [{ url: "ftp://ci.example.com/" }, "url: must be an http or https URL"],
      [{ events: ["push"] }, 'events: "push" is not one of'],
      [{ description: "x".repeat(257) }, "description: longer than 256 bytes"],
      [{ active: "yes" }, "active: must not be a JSON string"],
      [{ secret: "whsec_x" }, 'body: unknown field "secret"'],
    ] as const) {
      await expect(updateWebhook(apt, id, req as never), JSON.stringify(req)).rejects.toMatchObject({ status: 400, code: "INVALID", message: expect.stringContaining(message) });
    }
    // An allowed host is reached over http, at any address.
    expect((await updateWebhook(apt, id, { url: "http://ci.internal:8080/hooks" })).url).toBe("http://ci.internal:8080/hooks");

    await expect(createWebhook(apt, {})).rejects.toMatchObject({ status: 400, message: "url: required" });
    await expect(createWebhook(apt, { mask: "apt/*", url: "https://x.example.com/" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("mask: a webhook of this route has the mask apt/ubuntu-internal"),
    });
    // The same mask as the route's may be named.
    expect((await createWebhook(apt, { mask: "apt/ubuntu-internal", url: "https://x.example.com/" })).mask).toBe("apt/ubuntu-internal");
  });

  it("need manage on the repo: 401, then 404 for a repo the caller cannot read, 403 for one it can", async () => {
    signIn(null);
    await expect(list(apt)).rejects.toMatchObject({ status: 401 });
    signIn("bob");
    // bob reads no pypi repo, and writes raw/assets without managing it.
    await expect(list({ format: "pypi", repo: "internal" })).rejects.toMatchObject({ status: 404 });
    await expect(list({ format: "raw", repo: "assets" })).rejects.toMatchObject({ status: 403 });
    await expect(createWebhook({ format: "raw", repo: "assets" }, { url: "https://x.example.com/" })).rejects.toMatchObject({ status: 403 });
    signIn("alice"); // reader of every repo
    await expect(list(apt)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(log(apt, 3)).rejects.toMatchObject({ status: 403 });
    await expect(testWebhook(apt, 3)).rejects.toMatchObject({ status: 403 });
    signIn("admin");
    await expect(list({ format: "raw", repo: "absent" })).rejects.toMatchObject({ status: 404 });
  });

  it("lists only the webhooks whose mask is the repo, and answers 404 for another mask's", async () => {
    signIn("admin");
    const payments = { format: "pypi", repo: "payments" };
    // */payments matches the repo, but is not the repo's.
    expect((await list(payments)).map((w) => w.mask)).not.toContain("*/payments");
    await expect(one(payments, 2)).rejects.toMatchObject({ status: 404 });
    await expect(deleteWebhook(payments, 2)).rejects.toMatchObject({ status: 404 });
    await expect(one(apt, 0)).rejects.toMatchObject({ status: 404 });
    expect((await one(null, 2)).mask).toBe("*/payments");
  });
});

describe("the webhooks of every mask", () => {
  it("are the admin's: a wildcard mask is created and listed with every other", async () => {
    signIn("admin");
    for (const mask of ["oci/*", "*/*"]) {
      const created = await createWebhook(null, { mask, url: "https://audit.example.com/all", events: ["repo.created", "repo.deleted"] });
      expect(created).toMatchObject({ mask, events: ["repo.created", "repo.deleted"] });
      expect(created.secret).toMatch(/^whsec_/);
    }
    const all = await list(null);
    expect(all.map((w) => w.mask)).toEqual(expect.arrayContaining(["oci/*", "*/*", "apt/ubuntu-internal", "raw/assets"]));
    expect(all.map((w) => w.id)).toEqual([...all.map((w) => w.id)].sort((a, b) => a - b));
    // bob's webhook of his repo is the admin's to read too, by its route.
    expect((await one(null, 3)).mask).toBe("apt/ubuntu-internal");
  });

  it("refuses a mask that is not one, and a request without a mask", async () => {
    signIn("admin");
    await expect(createWebhook(null, { url: "https://x.example.com/" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("mask: required") });
    for (const mask of ["payments", "a/b/c", "/x"]) {
      await expect(createWebhook(null, { mask, url: "https://x.example.com/" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("want <format>/<repo>") });
    }
    await expect(createWebhook(null, { mask: "npmx/*", url: "https://x.example.com/" })).rejects.toMatchObject({
      status: 400,
      message: 'mask: "npmx" is not a format of this build',
    });
  });

  it("refuse anyone but the admin, a maintainer too, before the body is read", async () => {
    signIn(null);
    await expect(list(null)).rejects.toMatchObject({ status: 401 });
    signIn("bob");
    await expect(list(null)).rejects.toMatchObject({ status: 403 });
    await expect(createWebhook(null, { mask: "apt/*", url: "https://x.example.com/" })).rejects.toMatchObject({ status: 403 });
    await expect(one(null, 3)).rejects.toMatchObject({ status: 403 });
  });
});

describe("the delivery log", () => {
  it("pages newest first with the server's cursor, and refuses one that is not", async () => {
    signIn("admin");
    const raw = { format: "raw", repo: "assets" };
    const first = await log(raw, 1, { limit: 10 });
    expect(first.deliveries).toHaveLength(10);
    expect(first.next).toBeDefined();
    const second = await log(raw, 1, { limit: 10, cursor: first.next! });
    const ids = [...first.deliveries, ...second.deliveries].map((d) => d.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(new Set(ids).size).toBe(20);

    const all = (await log(raw, 1)).deliveries;
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((d) => d.state))).toEqual(new Set(["delivered", "failed", "pending"]));
    for (const d of all) {
      if (d.state === "pending") expect(d.nextAt).toBeDefined();
      else expect(d.nextAt).toBeUndefined();
      if (d.state === "delivered") expect(d.deliveredAt).toBeDefined();
    }

    await expect(log(raw, 1, { cursor: "x" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("cursor") });
    await expect(log(raw, 1, { limit: 0 })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("limit") });
  });

  it("has a failed row for a ping the receiver did not answer", async () => {
    signIn("bob");
    // The apt mirror's receiver refuses connections in the demo.
    const ping = await testWebhook(apt, 3);
    expect(ping).toMatchObject({ state: "failed", attempts: 1, lastError: "connection refused" });
    expect(ping.lastStatus).toBeUndefined();
    expect(ping.deliveredAt).toBeUndefined();
  });
});

describe("a server without a master key", () => {
  it("neither creates, rotates nor tests a webhook: 501; it still lists, changes and deletes", async () => {
    signIn("bob");
    const { id } = await createWebhook(apt, { url: "https://ci.example.com/hooks/nokey" });
    setMasterKey(false);
    await expect(createWebhook(apt, { url: "https://ci.example.com/hooks/x" })).rejects.toMatchObject({
      status: 501,
      code: "UNAVAILABLE",
      message: expect.stringContaining("keys.masterKeyEnv"),
    });
    await expect(rotateWebhookSecret(apt, id)).rejects.toMatchObject({ status: 501 });
    await expect(testWebhook(apt, id)).rejects.toMatchObject({ status: 501 });
    expect((await list(apt)).map((w) => w.id)).toContain(id);
    expect((await updateWebhook(apt, id, { active: false })).active).toBe(false);
    await deleteWebhook(apt, id);
    // A webhook that is not there is 404 first.
    await expect(rotateWebhookSecret(apt, id)).rejects.toMatchObject({ status: 404 });
  });
});
