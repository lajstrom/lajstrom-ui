import { ApiError } from "@/api/client";

/** What a form shows for a failed request: the server's message, which names the field. */
export function errorText(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message;
    return err.status === 403 ? `Not allowed: ${err.message}.` : `${err.message.replace(/\.$/, "")}.`;
  }
  return err instanceof Error ? err.message : "The request failed.";
}
