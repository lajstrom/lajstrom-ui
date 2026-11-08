import type { Action, Repo } from "@/api/types";

/**
 * Whether the UI offers an action on a repo. A server that answers `permissions` decides here;
 * one that does not (before role-based access control) gets the action offered and decides
 * when it is called: a refusal is answered 403 or 404 and shown as such.
 */
export function can(repo: Repo, action: Action): boolean {
  return repo.permissions ? repo.permissions.includes(action) : true;
}
