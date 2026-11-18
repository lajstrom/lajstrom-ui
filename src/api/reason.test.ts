import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { initReason, keepReason, keptReason, reasonFor, reasonProblem, ReasonNotGiven, setReasonAsker, setReasonRequired, withReason } from "./reason";
import { setSession } from "./session";

const signIn = (user: string) => setSession({ token: `ljs_pat_${user}`, user, tokenId: null, expiresAt: null });

beforeAll(() => {
  signIn("alice");
  initReason();
});

afterEach(() => {
  signIn("alice");
  keepReason(null);
  setReasonRequired(false);
  setReasonAsker(null);
});

describe("the reason of a change (rbac.md §13)", () => {
  it("is checked as the server checks it: 1 to 1024 bytes, no control characters", () => {
    expect(reasonProblem("CHG-1234")).toBeNull();
    expect(reasonProblem("")).toMatch(/1 byte at least/);
    expect(reasonProblem("é".repeat(512))).toBeNull();
    expect(reasonProblem("é".repeat(513))).toBe("1026 bytes, at most 1024.");
    expect(reasonProblem("two\nlines")).toBe("No line breaks or tabs.");
    expect(reasonProblem("a\ttab")).toBe("No line breaks or tabs.");
  });

  it("goes where the route takes it: the body, or ?changeReason= on a route without one", async () => {
    keepReason("CHG-1");
    await expect(withReason("body", { body: { name: "x" } })).resolves.toEqual({ body: { name: "x", changeReason: "CHG-1" } });
    await expect(withReason("body", {})).resolves.toEqual({ body: { changeReason: "CHG-1" } });
    await expect(withReason("query", { query: { force: true } })).resolves.toEqual({ query: { force: true, changeReason: "CHG-1" } });
    // A change that takes none is sent as it is.
    await expect(withReason(undefined, { body: { name: "x" } })).resolves.toEqual({ body: { name: "x" } });
  });

  it("is not sent when none is kept and the server needs none", async () => {
    let asked = 0;
    setReasonAsker(async () => (asked++, "never"));
    await expect(withReason("body", { body: {} })).resolves.toEqual({ body: {} });
    expect(asked).toBe(0);
  });

  it("is asked for when the server needs one and none is kept, once for the changes sent meanwhile", async () => {
    setReasonRequired(true);
    let asked = 0;
    let answer: (r: string | null) => void = () => {};
    setReasonAsker(() => (asked++, new Promise((resolve) => (answer = resolve))));
    const first = reasonFor();
    const second = reasonFor();
    answer("CHG-2");
    await expect(first).resolves.toBe("CHG-2");
    await expect(second).resolves.toBe("CHG-2");
    expect(asked).toBe(1);
  });

  it("is not asked for a change of the person's own credentials", async () => {
    setReasonRequired(true);
    setReasonAsker(async () => "CHG-3");
    await expect(reasonFor(true)).resolves.toBeUndefined();
    keepReason("CHG-4");
    await expect(reasonFor(true)).resolves.toBe("CHG-4");
  });

  it("sends nothing when the person gives none", async () => {
    setReasonRequired(true);
    setReasonAsker(async () => null);
    await expect(withReason("query", {})).rejects.toBeInstanceOf(ReasonNotGiven);
  });

  it("is the signed-in user's: forgotten when another user signs in, or none", () => {
    keepReason("CHG-5");
    expect(keptReason()).toBe("CHG-5");
    signIn("bob");
    expect(keptReason()).toBeNull();
    signIn("alice");
    keepReason("CHG-6");
    setSession(null);
    expect(keptReason()).toBeNull();
    // Signed out, nothing is kept.
    keepReason("CHG-7");
    expect(keptReason()).toBeNull();
  });
});
