// The required attachments of a repo in the mock (docs/spec/policy.md §11) through the client's
// calls and msw in node: the key of the policy checked as the server checks it, and what
// ?unmet=&signedBy= lists. acme-cli of npm/internal has a verified provenance on 1.0.0 only.

import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { apiGet, apiPath } from "@/api/client";
import { updateRepo } from "@/api/mutations";
import { setSession } from "@/api/session";
import type { VersionSummary } from "@/api/types";

import { createToken } from "./auth";
import { handlers } from "./handlers";

const server = setupServer(...handlers);

beforeAll(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function signIn(user: string): void {
  const t = createToken({ user }, { name: `requirements test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

const PROVENANCE = "https://slsa.dev/provenance";
const SIGNATURE = "https://sigstore.dev/cosign/sign/v1";
const require1 = (predicateType: string, signedBy: string[]) => ({ policy: { requireAttachments: [{ predicateType, signedBy }] } });
const unmet = (predicateType: string, signedBy: string[]) =>
  apiGet<{ versions: VersionSummary[] }>(apiPath("repos", "npm", "internal", "packages", "acme-cli", "versions"), { unmet: predicateType, signedBy }).then((r) =>
    r.versions.map((v) => v.version),
  );

describe("the required attachments of a repo", () => {
  it("are a key of its policy, set and lifted by whoever manages it", async () => {
    signIn("admin");
    const set = await updateRepo("npm", "internal", require1(PROVENANCE, ["release-key"]));
    expect(set.policy?.requireAttachments).toEqual([{ predicateType: PROVENANCE, signedBy: ["release-key"] }]);
    const lifted = await updateRepo("npm", "internal", { policy: { requireAttachments: null } });
    expect(lifted.policy?.requireAttachments).toBeUndefined();
  });

  it("are refused with the server's messages, naming the key path", async () => {
    signIn("admin");
    const refused = (format: string, repo: string, body: object, message: string | RegExp) =>
      expect(updateRepo(format, repo, body)).rejects.toMatchObject({ status: 400, message: typeof message === "string" ? message : expect.stringMatching(message) });
    await refused("npm", "internal", require1(PROVENANCE, ["nobody"]), 'policy.requireAttachments[0].signedBy[0]: "nobody" is neither a key of attachments.trust nor an identity of attachments.keyless.identities');
    await refused("npm", "internal", require1(PROVENANCE, ["lajstrom"]), 'policy.requireAttachments[0].signedBy[0]: "lajstrom" is the policy key, which verifies verdicts only');
    await refused("npm", "internal", require1(PROVENANCE, []), "policy.requireAttachments[0].signedBy: must be a list of 1 to 16 names");
    await refused("npm", "internal", require1("sbom", ["release-key"]), 'policy.requireAttachments[0].predicateType: "sbom" is not an absolute URI (RFC 3986, with a scheme)');
    await refused("npm", "internal", require1("https://lajstrom.dev/verdict/v1", ["release-key"]), /^policy\.requireAttachments\[0\]\.predicateType: .* matches the predicate type of verdicts/);
    await refused("npm", "internal", { policy: { requireAttachments: [] } }, "policy.requireAttachments: must be a list of 1 to 16 requirements");
    await refused("npm", "internal", { policy: { requireAttachments: [{ predicateType: PROVENANCE, signedBy: ["release-key"] }, { predicateType: PROVENANCE, signedBy: ["release-key"] }] } }, "policy.requireAttachments[1]: is the same as requireAttachments[0]");
    await refused("npm", "internal", { policy: { requireAttachments: [{ predicateType: PROVENANCE }] , x: 1 } }, /^policy\.x is not a policy key/);
    await refused("npm", "internal", { policy: { requireAttachments: [{ predicateType: 1, signedBy: ["release-key"] }] } }, "policy.requireAttachments[0].predicateType: must be a string, an absolute URI");
    await refused("npm", "npmjs", require1(PROVENANCE, ["release-key"]), "policy.requireAttachments: a proxy repo cannot require attachments: a version it fetches has none yet, so it would fetch none");
    await refused("oci", "internal", require1(PROVENANCE, ["release-key"]), "policy.requireAttachments: an oci repo indexes no attachments, and its consumers verify them (ADR 0008)");
  });
});

describe("?unmet=&signedBy= of a version list", () => {
  it("keeps the versions a requirement would refuse, set or not", async () => {
    signIn("admin");
    expect(await unmet(PROVENANCE, ["release-key"])).toEqual(["1.1.0-rc.1", "0.9.0"]);
    // A longer version of the type is met by the same attachment; a signer the trust lacks meets nothing.
    expect(await unmet(`${PROVENANCE}/v1`, ["release-key"])).toEqual(["1.1.0-rc.1", "0.9.0"]);
    expect(await unmet(PROVENANCE, ["someone"])).toEqual(["1.1.0-rc.1", "1.0.0", "0.9.0"]);
    // The demo's signatures are keyless, unsupported: none verifies.
    expect(await unmet(SIGNATURE, ["release-key"])).toHaveLength(3);
  });

  it("is refused without its other half, twice, or with a type that is no URI", async () => {
    signIn("admin");
    const list = (query: Record<string, string | string[]>) => apiGet(apiPath("repos", "npm", "internal", "packages", "acme-cli", "versions"), query);
    await expect(list({ unmet: PROVENANCE })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^unmet: with signedBy/) });
    await expect(list({ signedBy: "release-key" })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/^signedBy: only with unmet/) });
    await expect(list({ unmet: [PROVENANCE, SIGNATURE], signedBy: "release-key" })).rejects.toMatchObject({ status: 400, message: "unmet: once" });
    await expect(list({ unmet: "provenance", signedBy: "release-key" })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not an absolute URI/) });
  });
});
