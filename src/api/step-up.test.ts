import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import type { Session } from "./session";
import { keepPendingChange, needsStepUp, pendingChange, replayRefusal, STEP_UP_WINDOW, takePendingChange } from "./step-up";

/** sessionStorage of one tab. */
function storage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

const HOW = "sign in again in a web UI through OIDC (prompt=login), with a second factor";

describe("needsStepUp", () => {
  it("is the 403 of the vendored server, by the end of its message", () => {
    const msg = `a policy of the API that grants write: this needs a sign-in with a second factor within the last 10 minutes, and the request's credential is a password: ${HOW}`;
    expect(needsStepUp(new ApiError(403, "FORBIDDEN", msg))).toBe(true);
    expect(needsStepUp(new ApiError(403, "FORBIDDEN", `an approval: ${HOW}.`))).toBe(true);
    expect(needsStepUp(new ApiError(403, "FORBIDDEN", "grants[0]: writer on maven/x is outside auth.ci.apiWriteRepos"))).toBe(false);
    expect(needsStepUp(new ApiError(400, "INVALID", `x: ${HOW}`))).toBe(false);
  });

  it("is the 401 of RFC 9470, by its challenge: insufficient_user_authentication", () => {
    const asked = { error: "insufficient_user_authentication", description: "a sign-in within the last 10 minutes" };
    expect(needsStepUp(new ApiError(401, "UNAUTHENTICATED", "a fresh sign-in", true, null, asked))).toBe(true);
    expect(needsStepUp(new ApiError(401, "UNAUTHENTICATED", HOW, true, null, { error: "invalid_token", description: "" }))).toBe(false);
    expect(needsStepUp(new ApiError(401, "UNAUTHENTICATED", HOW))).toBe(false);
    expect(needsStepUp(new Error(HOW))).toBe(false);
    expect(needsStepUp(null)).toBe(false);
  });
});

const session: Session = { token: "ljs_pat_before", user: "erin", tokenId: 4, expiresAt: null, tokenType: "DPoP" };
const request = { method: "POST" as const, path: "/api/v1/ci/policies/web-publish/approve", ifMatch: '"abc"' };

describe("a change kept for its step-up", () => {
  it("is taken once, and leaves the tab whatever it holds", () => {
    const tab = storage();
    const change = pendingChange({ request, what: "Approve web-publish", page: "/access?tab=ci&policy=web-publish" }, session, 1000);
    expect(change).toMatchObject({ user: "erin", at: 1000, token: expect.stringMatching(/^[0-9a-f]{16}$/) });
    expect(JSON.stringify(change)).not.toContain("ljs_pat_before");
    keepPendingChange(change, tab);
    expect(takePendingChange(tab)).toEqual(change);
    expect(takePendingChange(tab)).toBeNull();

    // What is not a change of this UI is dropped all the same.
    keepPendingChange({ ...change, request: { ...request, path: "https://evil.example/x" } }, tab);
    const key = tab.key(0)!;
    expect(takePendingChange(tab)).toBeNull();
    tab.setItem(key, "{not json");
    expect(takePendingChange(tab)).toBeNull();
    expect(tab.length).toBe(0);
  });

  it("is sent by the same user, after a new sign-in, within the window", () => {
    const change = pendingChange({ request, what: "Approve web-publish", page: "/access" }, session, 1000);
    const after = { ...session, token: "ljs_pat_after", tokenId: 5 };
    expect(replayRefusal(change, after, 1000 + 60_000)).toBeNull();
    expect(replayRefusal(change, session, 2000)).toBe("The sign-in did not complete.");
    expect(replayRefusal(change, { ...after, user: "admin" }, 2000)).toBe("You signed in as admin, and the change was erin's.");
    expect(replayRefusal(change, after, 1000 + STEP_UP_WINDOW + 1)).toBe("The sign-in took longer than 15 minutes.");
    expect(replayRefusal(change, null, 2000)).toBe("You are not signed in.");
  });
});
