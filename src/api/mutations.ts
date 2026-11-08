// The changes the UI makes, against the endpoints the server has (docs/api.md).

import { apiPath, apiSend } from "./client";
import type { CreatedToken, TokenRequest } from "./types";

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
