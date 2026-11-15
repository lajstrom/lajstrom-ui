// The changes the UI makes, against the endpoints the server has (docs/api.md).

import { apiPath, apiSend, basicAuth } from "./client";
import { webhooksPath, type WebhookScope } from "./queries";
import type { BatchDeleteRequest, BatchDeleteResult, CreatedToken, MaskTokenRequest, TokenRequest } from "./types";
import type { CreatedWebhook, Delivery, Webhook, WebhookRequest, WebhookSecret } from "./types";

export function createUserToken(user: string, req: TokenRequest): Promise<CreatedToken> {
  return apiSend<CreatedToken>("POST", apiPath("users", user, "tokens"), { body: req });
}

export function revokeUserToken(user: string, id: number): Promise<void> {
  return apiSend("DELETE", apiPath("users", user, "tokens", id));
}

export function createDeployToken(format: string, repo: string, req: TokenRequest): Promise<CreatedToken> {
  return apiSend<CreatedToken>("POST", apiPath("repos", format, repo, "deploy-tokens"), { body: req });
}

export function revokeDeployToken(format: string, repo: string, id: number): Promise<void> {
  return apiSend("DELETE", apiPath("repos", format, repo, "deploy-tokens", id));
}

/** Creates a deploy token over a mask. The server takes the admin's password only, not a token,
 * as the request's credential: Basic, the session's bearer left out. */
export function createMaskToken(req: MaskTokenRequest, user: string, password: string): Promise<CreatedToken> {
  return apiSend<CreatedToken>("POST", apiPath("deploy-tokens"), { body: req, authorization: basicAuth(user, password) });
}

export function revokeMaskToken(id: number): Promise<void> {
  return apiSend("DELETE", apiPath("deploy-tokens", id));
}

/** Yanks a pypi version, with a reason or none; yanking it again with another reason replaces it. */
export function yankVersion(format: string, repo: string, name: string, version: string, reason: string): Promise<void> {
  return apiSend("PUT", apiPath("repos", format, repo, "packages", name, "versions", version, "yank"), { body: { reason: reason || null } });
}

export function unyankVersion(format: string, repo: string, name: string, version: string): Promise<void> {
  return apiSend("DELETE", apiPath("repos", format, repo, "packages", name, "versions", version, "yank"));
}

/** Deletes every variant of a version, if they still have the digests the client read
 * (If-Match: 412 when the version changed); force deletes a version that pointers name. */
export function deleteVersion(format: string, repo: string, name: string, version: string, digests: string[], force = false): Promise<void> {
  return apiSend("DELETE", apiPath("repos", format, repo, "packages", name, "versions", version), {
    query: { force: force || undefined },
    headers: { "If-Match": digests.map((d) => `"${d}"`).join(", ") },
  });
}

/** Deletes versions in a batch: each item on its own, with a result per item. */
export function deleteVersions(format: string, repo: string, req: BatchDeleteRequest): Promise<BatchDeleteResult> {
  return apiSend<BatchDeleteResult>("POST", `${apiPath("repos", format, repo)}/versions:delete`, { body: req });
}

// Webhooks (docs/api.md, Webhooks): under a repo, or under /api/v1/webhooks (WebhookScope).

/** Creates a webhook; the answer has its secret, the one time it is shown. Under /api/v1/webhooks
 * the request names the mask. */
export function createWebhook(scope: WebhookScope, req: WebhookRequest): Promise<CreatedWebhook> {
  return apiSend<CreatedWebhook>("POST", webhooksPath(scope), { body: req });
}

/** Changes the fields given of url, events, active and description; the mask never changes. */
export function updateWebhook(scope: WebhookScope, id: number, req: WebhookRequest): Promise<Webhook> {
  return apiSend<Webhook>("PATCH", webhooksPath(scope, id), { body: req });
}

/** Deletes a webhook and its delivery log; its pending deliveries are not sent. */
export function deleteWebhook(scope: WebhookScope, id: number): Promise<void> {
  return apiSend("DELETE", webhooksPath(scope, id));
}

/** Gives a webhook a new secret, answered this once; the old one signs nothing from then on. */
export function rotateWebhookSecret(scope: WebhookScope, id: number): Promise<WebhookSecret> {
  return apiSend<WebhookSecret>("POST", webhooksPath(scope, id, "secret"));
}

/** Sends a webhook.ping now, once, active or not; the answer is its row of the delivery log. */
export function testWebhook(scope: WebhookScope, id: number): Promise<Delivery> {
  return apiSend<Delivery>("POST", webhooksPath(scope, id, "test"));
}
