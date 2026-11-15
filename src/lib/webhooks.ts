// What the UI says about webhooks (docs/spec/webhooks.md): the types of events, masks, and the
// state of a delivery.

import type { Delivery, WebhookEvent } from "@/api/types";

/** The types a webhook may ask for, in the order of webhooks.md §1, and when each is sent. */
export const webhookEvents: { type: WebhookEvent; when: string }[] = [
  { type: "version.published", when: "a version published, or fetched by a proxy" },
  { type: "version.deleted", when: "a version deleted, one event per variant" },
  { type: "repo.created", when: "a repo created" },
  { type: "repo.deleted", when: "a repo deleted" },
];

/** Whether a mask names one repo, as opposed to a wildcard (rbac.md §3). */
export const isExactMask = (mask: string) => !mask.split("/").includes("*");

/** Whether a mask matches the repo <format>/<name> (rbac.md §3). */
export function maskMatches(mask: string, repo: string): boolean {
  const [mf, mr] = mask.split("/");
  const [f, r] = repo.split("/");
  return (mf === "*" || mf === f) && (mr === "*" || mr === r);
}

/** The host of a webhook's URL: what the audit log names, and a short label. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const deliveryTone: Record<Delivery["state"], "success" | "warning" | "danger"> = {
  delivered: "success",
  pending: "warning",
  failed: "danger",
};

/** What happened to a delivery, in a few words: the receiver's status or Lajstrom's words. */
export function deliveryOutcome(d: Delivery): string {
  if (d.state === "delivered") return d.lastStatus ? `answered ${d.lastStatus}` : "delivered";
  if (d.attempts === 0) return "not sent yet";
  return d.lastError ?? (d.lastStatus ? `answered ${d.lastStatus}` : "no answer");
}
