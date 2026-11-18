// The changes the UI makes, against the endpoints the server has (docs/api.md). A change of the
// control plane carries the reason of src/api/reason.ts, in its body or its query (reason).

import { apiPath, apiSend, basicAuth, type ChangeRequest } from "./client";
import { normalizeRepo, webhooksPath, type WebhookScope } from "./queries";
import { getSession } from "./session";
import type { BatchDeleteRequest, BatchDeleteResult, CreatedToken, MaskTokenRequest, PrefetchRequest, PrefetchResult, TokenRequest } from "./types";
import type { AccessReviewRequest, Approval, AuditEvent, Binding, BindingRequest, CreatedApproval, User, UserPatch, UserRequest } from "./types";
import type { CreateRepoRequest, ReindexRequest, ReindexRun, Repo, RepoPatch } from "./types";
import type { CIPolicy, CreatedWebhook, Delivery, Webhook, WebhookRequest, WebhookSecret } from "./types";

/** Whether user, a name or a uid, is the signed-in user: a change of its own tokens takes a reason
 * and never needs one. */
const own = (user: string) => user === getSession()?.user;

/** The password of a creation that takes one, sent as Basic in place of the session: a personal
 * access token, a deploy token over a mask, an approval. A sign-in through OIDC stands for it when
 * it is fresh, and none is given then (docs/spec/rbac.md §12). */
export type Password = { user: string; password: string };

const withPassword = (password: Password | undefined) => (password ? { authorization: basicAuth(password.user, password.password) } : {});

/** Creates a personal access token: the server takes it with a password, or a web UI's fresh
 * sign-in through OIDC, never with another token. */
export function createUserToken(user: string, req: TokenRequest, password?: Password): Promise<CreatedToken> {
  return apiSend<CreatedToken>("POST", apiPath("users", user, "tokens"), { body: req, reason: "body", own: own(user), ...withPassword(password) });
}

export function revokeUserToken(user: string, id: number): Promise<void> {
  return apiSend("DELETE", apiPath("users", user, "tokens", id), { reason: "query", own: own(user) });
}

// Users and bindings, the admin's (docs/api.md, Users and Bindings). A user in a path is its
// name or its uid; the UI sends the uid, which a rename does not change.

export function createUser(req: UserRequest): Promise<User> {
  return apiSend<User>("POST", apiPath("users"), { body: req, reason: "body" });
}

/** Changes the name, disabled and mustChange: disabled first, then mustChange, then the name. */
export function updateUser(user: string, patch: UserPatch): Promise<User> {
  return apiSend<User>("PATCH", apiPath("users", user), { body: patch, reason: "body" });
}

/** Sets the password: the old one fails from the next request on; the user's tokens stay. It
 * ends a lock of the lockout, and with auth.passwords.changeAtFirstUse the user must change it. */
export function setUserPassword(user: string, password: string): Promise<void> {
  return apiSend("POST", apiPath("users", user, "password"), { body: { password }, reason: "body" });
}

/** Ends the lock of a user's password and its count of wrong passwords (the lockout). */
export function unlockUser(user: string): Promise<void> {
  return apiSend("POST", apiPath("users", user, "unlock"), { reason: "query" });
}

/** Deletes a user: its tokens are revoked and its bindings deleted. It is not undone. */
export function deleteUser(user: string): Promise<void> {
  return apiSend("DELETE", apiPath("users", user), { reason: "query" });
}

/** Creates a binding; with auth.approval second-admin, one of the role admin or on *\/* is a
 * request for a second admin in its place (202). */
export function createBinding(req: BindingRequest): Promise<Binding | CreatedApproval> {
  return apiSend<Binding | CreatedApproval>("POST", apiPath("bindings"), { body: req, reason: "body" });
}

export function deleteBinding(id: number): Promise<void> {
  return apiSend("DELETE", apiPath("bindings", id), { reason: "query" });
}

export function createDeployToken(format: string, repo: string, req: TokenRequest): Promise<CreatedToken> {
  return apiSend<CreatedToken>("POST", apiPath("repos", format, repo, "deploy-tokens"), { body: req, reason: "body" });
}

export function revokeDeployToken(format: string, repo: string, id: number): Promise<void> {
  return apiSend("DELETE", apiPath("repos", format, repo, "deploy-tokens", id), { reason: "query" });
}

/** Creates a deploy token over a mask, with the admin's password, or a web UI's fresh sign-in
 * through OIDC in its place, never with another token. With auth.approval second-admin, one whose
 * scopes hold write is a request for a second admin in its place (202), with the token's secret,
 * no credential until another admin approves it. */
export function createMaskToken(req: MaskTokenRequest, password?: Password): Promise<CreatedToken | CreatedApproval> {
  return apiSend<CreatedToken | CreatedApproval>("POST", apiPath("deploy-tokens"), { body: req, reason: "body", ...withPassword(password) });
}

export function revokeMaskToken(id: number): Promise<void> {
  return apiSend("DELETE", apiPath("deploy-tokens", id), { reason: "query" });
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
  return apiSend<CreatedWebhook>("POST", webhooksPath(scope), { body: req, reason: "body" });
}

/** Changes the fields given of url, events, active and description; the mask never changes. */
export function updateWebhook(scope: WebhookScope, id: number, req: WebhookRequest): Promise<Webhook> {
  return apiSend<Webhook>("PATCH", webhooksPath(scope, id), { body: req, reason: "body" });
}

/** Deletes a webhook and its delivery log; its pending deliveries are not sent. */
export function deleteWebhook(scope: WebhookScope, id: number): Promise<void> {
  return apiSend("DELETE", webhooksPath(scope, id), { reason: "query" });
}

/** Gives a webhook a new secret, answered this once; the old one signs nothing from then on. */
export function rotateWebhookSecret(scope: WebhookScope, id: number): Promise<WebhookSecret> {
  return apiSend<WebhookSecret>("POST", webhooksPath(scope, id, "secret"), { reason: "query" });
}

/** Sends a webhook.ping now, once, active or not; the answer is its row of the delivery log. */
export function testWebhook(scope: WebhookScope, id: number): Promise<Delivery> {
  return apiSend<Delivery>("POST", webhooksPath(scope, id, "test"));
}

// Proxy repos (docs/api.md): both answer when the server is done, with no job to follow.

/** Drops a proxy's cache of its upstream's documents, or of one name; what it fetched stays. */
export function purgeUpstreamCache(format: string, repo: string, name?: string): Promise<void> {
  return apiSend("DELETE", apiPath("repos", format, repo, "upstream-cache"), { query: { name: name || undefined } });
}

/** Fetches versions of names, or images of an oci proxy, before a client asks for them. */
export function prefetch(format: string, repo: string, req: PrefetchRequest): Promise<PrefetchResult> {
  return apiSend<PrefetchResult>("POST", apiPath("repos", format, repo, "prefetch"), { body: req });
}

// Repos (docs/api.md, Repos): the admin creates them; manage changes, deletes and reindexes.

/** Creates a repo; the answer is the resource, as GET answers it. */
export function createRepo(req: CreateRepoRequest): Promise<Repo> {
  return apiSend<Omit<Repo, "prefix">>("POST", apiPath("repos"), { body: req, reason: "body" }).then(normalizeRepo);
}

/** Changes a repo; the answer is the resource as it is then. */
export function updateRepo(format: string, repo: string, patch: RepoPatch): Promise<Repo> {
  return apiSend<Omit<Repo, "prefix">>("PATCH", apiPath("repos", format, repo), { body: patch, reason: "body" }).then(normalizeRepo);
}

/** Deletes a repo from the index; force, one that has versions. Its artifacts stay in the
 * registry. */
export function deleteRepo(format: string, repo: string, force: boolean): Promise<void> {
  return apiSend("DELETE", apiPath("repos", format, repo), { query: { force: force || undefined }, reason: "query" });
}

/** Starts a reindex of the repo; the answer is the run, which GET …/reindex follows. */
export function startReindex(format: string, repo: string, req: ReindexRequest): Promise<ReindexRun> {
  return apiSend<ReindexRun>("POST", apiPath("repos", format, repo, "reindex"), { body: req });
}

// CI trust policies (docs/api.md, CI trust policies): each change as the request it sends, which a
// step-up keeps across its sign-in and sends again (src/api/step-up.ts, sendChange); etag, the
// revision the change was made on, goes as If-Match, so that it changes only what was read.

/** The fields of a policy that a create and a change send. */
export type CIPolicyBody = Pick<CIPolicy, "name" | "issuer" | "claims" | "grants" | "expiresAt">;

const ifMatch = (etag: string | null) => (etag ? { ifMatch: etag } : {});

export const ciPolicyChanges = {
  /** A new policy: 201 with it and its ETag. */
  create: (body: CIPolicyBody): ChangeRequest => ({ method: "POST", path: apiPath("ci", "policies"), body, reason: "body" }),
  /** Its issuer, claims, grants and expiry replaced; one that writes waits for an approval again. */
  replace: (name: string, body: CIPolicyBody, etag: string | null): ChangeRequest => ({
    method: "PUT",
    path: apiPath("ci", "policies", name),
    body,
    reason: "body",
    ...ifMatch(etag),
  }),
  /** Deleted, one that writes too, without a step. */
  remove: (name: string, etag: string | null): ChangeRequest => ({ method: "DELETE", path: apiPath("ci", "policies", name), reason: "query", ...ifMatch(etag) }),
  /** A new expiry, expiresAt or 180 days ahead, of a policy that writes. */
  renew: (name: string, expiresAt: string | undefined, etag: string | null): ChangeRequest => ({
    method: "POST",
    path: apiPath("ci", "policies", name, "renew"),
    ...(expiresAt ? { body: { expiresAt } } : {}),
    reason: "body",
    ...ifMatch(etag),
  }),
  /** What waits approved, exactly the revision read: the ETag is required. */
  approve: (name: string, etag: string): ChangeRequest => ({ method: "POST", path: apiPath("ci", "policies", name, "approve"), ifMatch: etag, reason: "query" }),
};

// The requests for a second admin (docs/spec/rbac.md §13).

/** Approves a request, which makes its change; another admin than the requester. The server
 * takes the admin's password as the credential (Basic, when given), or the session of a fresh
 * sign-in through OIDC, which it asks for more when it is not fresh. */
export function approveRequest(id: number, password?: Password): Promise<Approval> {
  return apiSend<Approval>("POST", apiPath("approvals", id, "approve"), { reason: "query", ...withPassword(password) });
}

/** Rejects a request, or withdraws one's own: any credential of the admin role. */
export function rejectRequest(id: number): Promise<Approval> {
  return apiSend<Approval>("POST", apiPath("approvals", id, "reject"), { reason: "query" });
}

/** Records that a person reviewed an access report, by its sha256 (docs/spec/rbac.md §14): the
 * audit row access.review. It takes no reason: a review changes no access. */
export function recordAccessReview(req: AccessReviewRequest): Promise<AuditEvent> {
  return apiSend<AuditEvent>("POST", apiPath("access-reviews"), { body: req });
}
