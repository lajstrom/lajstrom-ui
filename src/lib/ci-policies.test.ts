import { describe, expect, it } from "vitest";

import type { CIPolicy } from "@/api/types";

import { approvalRefusal, bodyOf, claimKind, draftOf, expiryText, fieldErrors, newDraft, platformOf, renewable, waiting } from "./ci-policies";

const DAY = 86_400_000;
const now = Date.parse("2026-11-17T12:00:00Z");

const policy = (p: Partial<CIPolicy>): CIPolicy => ({
  name: "web-publish",
  issuer: "github",
  claims: { repository_id: ["7"], ref: ["refs/heads/main"] },
  grants: [{ role: "writer", mask: "npm/internal" }],
  source: "api",
  state: "active",
  updatedBy: "user:erin",
  ...p,
});

describe("the claims of a platform (rbac.md §11)", () => {
  it("knows each claim's kind, and none of the other platform's", () => {
    expect(claimKind("github", "repository_id")).toBe("id");
    expect(claimKind("github", "ref")).toBe("pattern");
    expect(claimKind("github", "event_name")).toBe("value");
    expect(claimKind("github", "project_path")).toBeNull();
    expect(claimKind("gitlab", "project_path")).toBe("name");
    expect(claimKind("gitlab", "ref_path")).toBe("pattern");
  });

  it("finds an issuer's platform in the server's issuers, or in the ids its policies name", () => {
    const policies = [policy({ issuer: "gl", claims: { project_id: ["1"] } }), policy({ issuer: "gh" })];
    expect(platformOf("gh", [{ name: "gh", platform: "gitlab" }], policies)).toBe("gitlab");
    expect(platformOf("gl", undefined, policies)).toBe("gitlab");
    expect(platformOf("gh", undefined, policies)).toBe("github");
    expect(platformOf("other", undefined, policies)).toBeNull();
  });
});

describe("what waits, and who approves it", () => {
  it("is a pending policy or the renewal of one that counts", () => {
    expect(waiting(policy({ state: "pending" }))).toBe("policy");
    expect(waiting(policy({ renewal: { expiresAt: "2027-05-01T00:00:00Z" } }))).toBe("renewal");
    expect(waiting(policy({}))).toBeNull();
    expect(waiting(policy({ state: "expired", renewal: { expiresAt: "2027-05-01T00:00:00Z" } }))).toBeNull();
    expect(waiting(policy({ source: "config", state: "pending" }))).toBeNull();
  });

  it("is approved by an admin other than the one who made the change", () => {
    expect(approvalRefusal(policy({ state: "pending" }), "user:admin")).toBeNull();
    expect(approvalRefusal(policy({ state: "pending" }), "user:erin")).toBe("You made the change that waits: another admin approves it.");
    expect(approvalRefusal(policy({}), "user:admin")).toBe("Nothing waits for an approval.");
  });

  it("renews a policy of the API that writes, unless it waits", () => {
    expect(renewable(policy({}))).toBe(true);
    expect(renewable(policy({ state: "expired" }))).toBe(true);
    expect(renewable(policy({ state: "pending" }))).toBe(false);
    expect(renewable(policy({ grants: [{ role: "reader", mask: "*/*" }] }))).toBe(false);
    expect(renewable(policy({ source: "config" }))).toBe(false);
  });
});

describe("expiryText", () => {
  it("counts whole days, ahead and past", () => {
    const at = (ms: number) => new Date(now + ms).toISOString();
    expect(expiryText(at(12 * DAY + 3600_000), now)).toBe("expires in 12 days");
    expect(expiryText(at(DAY + 1), now)).toBe("expires tomorrow");
    expect(expiryText(at(3600_000), now)).toBe("expires today");
    expect(expiryText(at(-3600_000), now)).toBe("expired today");
    expect(expiryText(at(-DAY - 1), now)).toBe("expired yesterday");
    expect(expiryText(at(-3 * DAY - 1), now)).toBe("expired 3 days ago");
  });
});

describe("the draft of the form", () => {
  it("starts a new policy with the platform's first id and a ref", () => {
    expect(newDraft("gitlab", "gitlab").claims.map((c) => c.claim)).toEqual(["project_id", "ref"]);
  });

  it("sends the claims with values as lists, merged by claim, and every grant row", () => {
    const d = {
      ...newDraft("github", "github"),
      name: " web-publish ",
      claims: [
        { claim: "repository_id", values: " 7 \n\n" },
        { claim: "ref", values: "refs/heads/main\nrefs/tags/v*" },
        { claim: "ref", values: "refs/heads/main\nrefs/heads/release" },
        { claim: "environment", values: "" },
        { claim: "", values: "lost" },
      ],
      grants: [
        { role: "reader" as const, mask: " npm/* " },
        { role: "writer" as const, mask: "" },
      ],
    };
    expect(bodyOf(d, now)).toEqual({
      name: "web-publish",
      issuer: "github",
      claims: { repository_id: ["7"], ref: ["refs/heads/main", "refs/tags/v*", "refs/heads/release"] },
      grants: [
        { role: "reader", mask: "npm/*" },
        { role: "writer", mask: "" },
      ],
    });
  });

  it("asks an expiry for a policy that writes only, and leaves the server's 180 days out", () => {
    const d = { ...newDraft("github", "github"), grants: [{ role: "maintainer" as const, mask: "raw/*" }] };
    expect(bodyOf(d, now).expiresAt).toBeUndefined();
    expect(bodyOf({ ...d, days: "30" }, now).expiresAt).toBe("2026-12-17T12:00:00Z");
    expect(bodyOf({ ...d, days: "30", grants: [{ role: "reader", mask: "raw/*" }] }, now).expiresAt).toBeUndefined();
  });

  it("edits a policy as its claims and grants are", () => {
    const d = draftOf(policy({ claims: { repository_id: ["7"], ref: ["a", "b"] } }), "github");
    expect(d.claims).toEqual([
      { claim: "repository_id", values: "7" },
      { claim: "ref", values: "a\nb" },
    ]);
    expect(bodyOf(d, now)).toMatchObject({ claims: { repository_id: ["7"], ref: ["a", "b"] }, grants: [{ role: "writer", mask: "npm/internal" }] });
  });
});

describe("fieldErrors", () => {
  it("files each problem of a refusal under its field", () => {
    const msg = [
      'name: "Bad" is not lowercase letters and digits with single hyphens, at most 63 bytes',
      "claims.ref: must have a value",
      "claims: must name the project by an id, repository_id or repository_owner_id: a name can be registered again by anyone",
      "grants[1].mask: \"x\" is not <format>/<repo>",
      "grants[1].role: admin is not for a CI token: reader, writer or maintainer",
    ].join("; ");
    expect(Object.fromEntries(fieldErrors(msg))).toEqual({
      name: ['"Bad" is not lowercase letters and digits with single hyphens, at most 63 bytes'],
      "claims.ref": ["must have a value"],
      claims: ["must name the project by an id, repository_id or repository_owner_id: a name can be registered again by anyone"],
      "grants.1": ['"x" is not <format>/<repo>', "admin is not for a CI token: reader, writer or maintainer"],
    });
  });

  it("keeps a part without a field with the one before, or with the form", () => {
    const repos = "grants[0]: writer on maven/x is outside auth.ci.apiWriteRepos, */payments; write to other repos in the configuration (auth.ci.policies)";
    expect(Object.fromEntries(fieldErrors(repos))).toEqual({
      "grants.0": ["writer on maven/x is outside auth.ci.apiWriteRepos, */payments; write to other repos in the configuration (auth.ci.policies)"],
    });
    expect(Object.fromEntries(fieldErrors("policy x exists already"))).toEqual({ "": ["policy x exists already"] });
    expect(Object.fromEntries(fieldErrors("expiresAt: must be in the future"))).toEqual({ expiresAt: ["must be in the future"] });
  });
});
