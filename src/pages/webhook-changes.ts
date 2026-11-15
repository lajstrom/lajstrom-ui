// The changes of a webhook (docs/adr/0003-changes-realistic-by-default.md): active is
// optimistic; creating one, changing its URL, events or description, a new secret and a ping
// are realistic; a delete is confirmed, then realistic, and the delivery log goes with it.

import { useMutation, type QueryKey } from "@tanstack/react-query";

import { ApiError } from "@/api/client";
import { optimistic, realistic, update } from "@/api/change";
import { createWebhook, deleteWebhook, rotateWebhookSecret, testWebhook, updateWebhook } from "@/api/mutations";
import { webhooksKey, type WebhookScope } from "@/api/queries";
import type { Webhook, WebhookRequest } from "@/api/types";
import { notify } from "@/lib/notices";
import { isExactMask, urlHost } from "@/lib/webhooks";

/** The lists that show a webhook: every mask's, which the admin reads, and its repo's when its
 * mask is one repo. The delivery logs are below them. */
export function listsOf(mask: string): QueryKey[] {
  const [format = "", repo = ""] = mask.split("/");
  return [webhooksKey(null), ...(isExactMask(mask) ? [webhooksKey({ format, repo })] : [])];
}

/** The server has no master key: it neither creates a webhook, rotates a secret nor sends a
 * ping (501 UNAVAILABLE, docs/api.md, Webhooks). */
export const noMasterKey = (err: unknown): err is ApiError => err instanceof ApiError && err.status === 501;

/** Creates a webhook in the scope; realistic: the secret is only in the answer, and the dialog
 * that shows it waits for the lists to have the webhook. */
export function useCreateWebhook(scope: WebhookScope) {
  return useMutation({
    mutationFn: (req: WebhookRequest) => createWebhook(scope, req),
    onSuccess: (created, _req, _result, { client }) => Promise.all(listsOf(created.mask).map((queryKey) => client.invalidateQueries({ queryKey }))),
  });
}

/** Changes the URL, the events or the description; realistic: the server checks the URL. */
export function useUpdateWebhook(scope: WebhookScope, webhook: Webhook) {
  return useMutation({
    mutationFn: (req: WebhookRequest) => updateWebhook(scope, webhook.id, req),
    ...realistic(...listsOf(webhook.mask)),
  });
}

/** Turning a webhook on or off: what it becomes. */
export type ActiveChange = { webhook: Webhook; active: boolean };

export const activeKey = ["webhook-active"];

const withActive = (c: ActiveChange) => (list: Webhook[]) => list.map((w) => (w.id === c.webhook.id ? { ...w, active: c.active } : w));

/** Active, optimistic in every list that shows the webhook: the opposite change undoes it, and
 * the answer adds nothing the screen needs. */
export function useActive(scope: WebhookScope) {
  return useMutation({
    mutationKey: activeKey,
    mutationFn: (c: ActiveChange) => updateWebhook(scope, c.webhook.id, { active: c.active }),
    ...optimistic({
      updates: (c: ActiveChange) => listsOf(c.webhook.mask).map((key) => update(key, withActive(c))),
      describe: (c) => `${c.active ? "Turn on" : "Turn off"} the webhook to ${urlHost(c.webhook.url)}`,
    }),
  });
}

/** Deletes a webhook and its delivery log. The panel of the webhook is left first, so that its
 * log is not fetched again only to be a 404; then the lists are fetched again. */
export function useDeleteWebhook(scope: WebhookScope, webhook: Webhook, leave: () => Promise<void>) {
  const { onSuccess: refetch } = realistic(...listsOf(webhook.mask));
  return useMutation({
    mutationFn: () => deleteWebhook(scope, webhook.id),
    onSuccess: async (data, variables, result, context) => {
      await leave();
      await refetch(data, variables, result, context);
      for (const key of listsOf(webhook.mask)) context.client.removeQueries({ queryKey: [...key, webhook.id] });
      notify({ tone: "success", title: `Deleted the webhook to ${urlHost(webhook.url)}`, description: "Its delivery log went with it." });
    },
  });
}

/** A new secret; realistic: the secret is only in the answer. */
export function useRotateSecret(scope: WebhookScope, webhook: Webhook) {
  return useMutation({
    mutationFn: () => rotateWebhookSecret(scope, webhook.id),
    ...realistic(...listsOf(webhook.mask)),
  });
}

/** A ping; realistic: its row of the delivery log is the answer, and the log is fetched again. */
export function usePing(scope: WebhookScope, webhook: Webhook) {
  return useMutation({
    mutationFn: () => testWebhook(scope, webhook.id),
    ...realistic(...listsOf(webhook.mask).map((key) => [...key, webhook.id])),
  });
}
