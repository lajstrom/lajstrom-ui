import type { Token } from "@/api/types";

const WEEK = 7 * 86_400_000;

/** revoked, expired, expiring within a week, or active, as of now. */
export function tokenState(token: Token, now = Date.now()): "revoked" | "expired" | "expiring" | "active" {
  if (token.revokedAt) return "revoked";
  if (!token.expiresAt) return "active";
  const left = Date.parse(token.expiresAt) - now;
  if (left < 0) return "expired";
  return left < WEEK ? "expiring" : "active";
}
