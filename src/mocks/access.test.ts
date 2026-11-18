// The mock's access report and its review (docs/spec/rbac.md §14) through the client's calls and
// msw in node: one canonical document per scope, its flags, and the access.review row.

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiGetBytes, apiPath, apiSend } from "@/api/client";
import { recordAccessReview } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { AccessReport, AuditList } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { createToken } from "./auth";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => vi.useRealTimers());
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string): void {
  const t = createToken({ user }, { name: `access test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const read = (query: Record<string, string | number> = {}) => apiGetBytes(apiPath("access-report"), query);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const doc = async (query: Record<string, string | number> = {}) => JSON.parse(text(await read(query))) as AccessReport;

describe("the access report", () => {
  it("is one compact document, its keys in byte order, its times to the second, a line feed at the end", async () => {
    signIn("admin");
    const t = text(await read());
    expect(t.endsWith("}\n")).toBe(true);
    expect(t.slice(0, -1)).not.toMatch(/\n|": |, "/);
    expect(t).not.toMatch(/\d\.\d{3}Z/);
    const keys = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(keys);
      if (v === null || typeof v !== "object") return;
      const k = Object.keys(v);
      expect(k).toEqual([...k].sort());
      Object.values(v).forEach(keys);
    };
    keys(JSON.parse(t));
  });

  it("is the same bytes for the same rows at the same second", async () => {
    signIn("admin");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-18T12:00:00.250Z"));
    const a = await read();
    vi.setSystemTime(Date.parse("2026-11-18T12:00:00.750Z"));
    const b = await read();
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    expect(JSON.parse(text(a))).toMatchObject({ generatedAt: "2026-11-18T12:00:00Z" });
  });

  it("has the sections of its scope, and the flags a reviewer looks for", async () => {
    signIn("admin");
    const all = await doc();
    expect(all).toMatchObject({ scope: "all", unusedDays: 90, settings: { adminMFA: false, anonymousRead: true } });
    expect(Object.keys(all).sort()).toEqual(["anonymous", "ciPolicies", "deployTokens", "generatedAt", "groups", "scope", "settings", "unusedDays", "users", "workloads"]);
    expect(all.users.map((u) => u.name)).toEqual([...all.users.map((u) => u.name)].sort());
    expect(all.users.find((u) => u.name === "admin")!.flags).toEqual(expect.arrayContaining(["admin", "allRepos"]));
    expect(all.users.find((u) => u.name === "judy")!.flags).toEqual(["unused", "inactive"]);
    const erin = all.users.find((u) => u.name === "erin")!;
    expect(erin.bindings.some((b) => b.via === "group:platform")).toBe(true);
    expect(all.deployTokens!.find((t) => t.expiresAt === null)!.flags).toContain("noExpiry");
    expect(all.deployTokens!.every((t) => t.principal === `token:${t.id}`)).toBe(true);

    const people = await doc({ scope: "people" });
    expect(Object.keys(people)).not.toContain("deployTokens");
    expect(people.groups!.map((g) => g.principal)).toEqual(["group:payments-oncall", "group:platform"]);
    const systems = await doc({ scope: "systems", unusedDays: 30 });
    expect(Object.keys(systems)).not.toContain("groups");
    expect(systems).toMatchObject({ unusedDays: 30, anonymous: { repos: expect.any(Array) } });
  });

  it("is the admin's, with a scope and days in their bounds", async () => {
    signIn("admin");
    await expect(read({ scope: "everyone" })).rejects.toMatchObject({ status: 400, message: 'scope: "everyone" is not all, people or systems' });
    await expect(read({ unusedDays: 0 })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^unusedDays: /) });
    signIn("bob");
    await expect(read()).rejects.toMatchObject({ status: 403 });
  });
});

describe("a review of the report", () => {
  it("is the row access.review that names the report by its sha256", async () => {
    signIn("admin");
    const bytes = await read({ scope: "people" });
    const report = JSON.parse(text(bytes)) as AccessReport;
    const sha256 = sha256Hex(bytes);
    const row = await recordAccessReview({ sha256, generatedAt: report.generatedAt, scope: "people", note: "CHG-2300: quarterly review\nnothing to remove" });
    expect(row).toMatchObject({ action: "access.review", principalName: "admin", subject: `sha256:${sha256}`, details: { sha256, generatedAt: report.generatedAt, scope: "people", note: "CHG-2300: quarterly review\nnothing to remove" } });
    const past = await apiGet<AuditList>(apiPath("audit"), { action: "access.review" });
    expect(past.events[0]!.id).toBe(row.id);
  });

  it("is refused for a field out of its bounds, and takes no reason", async () => {
    signIn("admin");
    const ok = { sha256: "a".repeat(64), generatedAt: new Date().toISOString(), scope: "all" as const, note: "fine" };
    const refused = async (body: object, message: string | RegExp) =>
      expect(apiSend("POST", apiPath("access-reviews"), { body })).rejects.toMatchObject({ status: 400, message: typeof message === "string" ? message : expect.stringMatching(message) });
    await refused({ ...ok, sha256: `sha256:${"a".repeat(64)}` }, "sha256: the 64 hexadecimal digits alone, without sha256:");
    await refused({ ...ok, sha256: "ABC" }, "sha256: 3 characters; want the sha256 of the document's bytes, 64 lowercase hexadecimal digits");
    await refused({ ...ok, note: "" }, /^note: required/);
    await refused({ ...ok, note: "a\ttab" }, /^note: a control character/);
    await refused({ ...ok, generatedAt: new Date(Date.now() + 120_000).toISOString() }, /^generatedAt: .* is after the server's time/);
    await refused({ ...ok, changeReason: "CHG-1" }, 'body: unknown field "changeReason"');
  });
});
