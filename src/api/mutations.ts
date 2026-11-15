// The changes the UI makes, against the endpoints the server has (docs/api.md).

import { apiPath, apiSend } from "./client";
import type { BatchDeleteRequest, BatchDeleteResult, CreatedToken, TokenRequest } from "./types";

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
