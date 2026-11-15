import { describe, expect, it } from "vitest";

import { deliveriesQuery, webhooksQuery } from "@/api/queries";
import type { Delivery } from "@/api/types";
import { listsOf } from "@/pages/webhook-changes";

import { deliveryOutcome, isExactMask, maskMatches } from "./webhooks";

describe("masks", () => {
  it("tell one repo from a wildcard, and match as rbac.md §3 does", () => {
    expect(isExactMask("apt/ubuntu-internal")).toBe(true);
    expect(isExactMask("apt/*")).toBe(false);
    expect(isExactMask("*/payments")).toBe(false);
    expect(maskMatches("*/payments", "pypi/payments")).toBe(true);
    expect(maskMatches("apt/*", "pypi/payments")).toBe(false);
    expect(maskMatches("*/*", "oci/talos")).toBe(true);
  });
});

describe("the lists a change of a webhook updates", () => {
  it("are every mask's, and the repo's when the mask is one repo, with the logs below them", () => {
    const repo = { format: "apt", repo: "ubuntu-internal" };
    expect(listsOf("apt/ubuntu-internal")).toEqual([webhooksQuery(null).queryKey, webhooksQuery(repo).queryKey]);
    expect(listsOf("apt/*")).toEqual([webhooksQuery(null).queryKey]);
    // A delivery log is below its list, so that a change of the list fetches it again.
    expect(deliveriesQuery(repo, 3, "x").queryKey.slice(0, 4)).toEqual(webhooksQuery(repo).queryKey);
  });
});

describe("a delivery's outcome", () => {
  const base: Delivery = { id: 1, eventId: "e", eventType: "version.published", state: "pending", attempts: 0, createdAt: "2026-11-14T12:00:00Z" };
  it("is the receiver's status, Lajstrom's words, or not sent yet", () => {
    expect(deliveryOutcome(base)).toBe("not sent yet");
    expect(deliveryOutcome({ ...base, attempts: 2, lastStatus: 503, lastError: "answered 503" })).toBe("answered 503");
    expect(deliveryOutcome({ ...base, state: "failed", attempts: 8, lastError: "connection refused" })).toBe("connection refused");
    expect(deliveryOutcome({ ...base, state: "delivered", attempts: 1, lastStatus: 202 })).toBe("answered 202");
  });
});
