import { KeyRound, Pencil, Plus, RotateCcwKey, Trash2, Webhook as WebhookIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import type { WebhookScope } from "@/api/queries";
import type { Webhook, WebhookEvent, WebhookRequest } from "@/api/types";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/errors";
import { urlHost, webhookEvents } from "@/lib/webhooks";

import { noMasterKey, useCreateWebhook, useDeleteWebhook, useRotateSecret, useUpdateWebhook } from "./webhook-changes";

/** What the UI shows instead of a form when the server has no master key (501): it makes no
 * secret, so it neither creates a webhook, gives one a new secret nor sends a ping. */
export function NoMasterKey({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-md border border-warning/30 bg-warning-soft px-3 py-3 text-sm">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 space-y-1.5">
        <p className="font-medium text-warning">This server has no master key</p>
        <p>
          It stores every webhook's secret encrypted with it. Until its configuration sets <code className="font-mono text-xs">keys.masterKeyEnv</code> or{" "}
          <code className="font-mono text-xs">keys.masterKeyFile</code>, it creates no webhook, gives none a new secret, sends no ping, and pending deliveries
          wait. The webhooks it has are still listed, changed and deleted.
        </p>
        <p className="font-mono text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

/** A webhook's secret, the one time the server answers it, with a copy button. */
function SecretReveal({ secret }: { secret: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md border border-border bg-code px-3 py-2">
        <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{secret}</code>
        <CopyButton value={secret} label="secret" size="md" />
      </div>
      <p className="text-xs text-muted-foreground">
        The receiver checks every request with it: <span className="font-mono">webhook-signature</span> is an HMAC-SHA256 of{" "}
        <span className="font-mono">&lt;webhook-id&gt;.&lt;webhook-timestamp&gt;.&lt;body&gt;</span>, keyed with the bytes of the base64 after{" "}
        <span className="font-mono">whsec_</span>, as the verifiers of Standard Webhooks expect.
      </p>
    </div>
  );
}

/** The fields of a webhook's form. */
type Draft = { mask: string; url: string; events: WebhookEvent[]; description: string; active: boolean };

type FieldsProps = {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  /** The form asks for the mask: a webhook created under /api/v1/webhooks. */
  mask: boolean;
  /** The form creates a webhook, which may start inactive; a change leaves active to its switch. */
  create: boolean;
};

function WebhookFields({ draft, set, mask, create }: FieldsProps) {
  const ids = { mask: useId(), url: useId(), description: useId(), active: useId() };
  return (
    <>
      {mask ? (
        <Field
          label="Mask"
          htmlFor={ids.mask}
          hint="<format>/<repo>, * for a whole segment: oci/*, */payments, */*. It need not match a repo yet: one created later gets the events too."
        >
          <Input id={ids.mask} value={draft.mask} autoFocus spellCheck={false} placeholder="oci/*" className="font-mono" onChange={(e) => set({ mask: e.target.value })} />
        </Field>
      ) : null}
      <Field
        label="URL"
        htmlFor={ids.url}
        hint="https at a public address; http, and private addresses, only for the hosts of the server's webhooks.allowedHosts. No user and password: the requests are signed."
      >
        <Input
          id={ids.url}
          type="url"
          value={draft.url}
          autoFocus={!mask}
          spellCheck={false}
          maxLength={2048}
          placeholder="https://ci.example.com/hooks/lajstrom"
          className="font-mono"
          onChange={(e) => set({ url: e.target.value })}
        />
      </Field>
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium">Events</legend>
        {webhookEvents.map((e) => (
          <label key={e.type} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              checked={draft.events.includes(e.type)}
              onChange={(ev) => set({ events: ev.target.checked ? [...draft.events, e.type] : draft.events.filter((t) => t !== e.type) })}
            />
            <span>
              <span className="font-mono text-[12.5px]">{e.type}</span> <span className="text-muted-foreground">{e.when}</span>
            </span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">None checked: every type, those added later too.</p>
      </fieldset>
      <Field label="Description" htmlFor={ids.description} hint="Optional, at most 256 bytes: what the receiver does with the events.">
        <Input id={ids.description} value={draft.description} maxLength={256} placeholder="rebuild the site" onChange={(e) => set({ description: e.target.value })} />
      </Field>
      {create ? (
        <label htmlFor={ids.active} className="flex items-start gap-2 text-sm">
          <input id={ids.active} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
          <span>
            Active <span className="text-muted-foreground">from now on. An inactive webhook gets no event, and a ping still reaches it.</span>
          </span>
        </label>
      ) : null}
    </>
  );
}

const sameEvents = (a: WebhookEvent[], b: WebhookEvent[]) => a.length === b.length && a.every((e) => b.includes(e));

const blank: Draft = { mask: "", url: "", events: [], description: "", active: true };

type CreateProps = {
  scope: WebhookScope;
  /** The server's message, when it has answered that it has no master key. */
  noKey: string | null;
  onNoKey: (message: string) => void;
  /** The dialog closes after a creation: the new webhook, to show. */
  onCreated: (id: number) => void;
};

/** Creates a webhook and shows its secret, the one time the server answers it. Realistic: the
 * secret exists only in the answer, and the dialog waits for the list to have the webhook. */
export function CreateWebhookDialog({ scope, noKey, onNoKey, onCreated }: CreateProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const create = useCreateWebhook(scope);
  const created = create.data;
  const refused = noMasterKey(create.error) ? create.error.message : noKey;
  const ready = draft.url.trim() !== "" && (scope !== null || draft.mask.trim() !== "");

  const close = (o: boolean) => {
    if (o) return setOpen(true);
    // A creation in flight keeps the dialog: its answer has the secret.
    if (create.isPending) return;
    setOpen(false);
    if (created) onCreated(created.id);
    setDraft(blank);
    create.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const req: WebhookRequest = {
      ...(scope ? {} : { mask: draft.mask.trim() }),
      url: draft.url.trim(),
      ...(draft.events.length ? { events: draft.events } : {}),
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.active ? {} : { active: false }),
    };
    create.mutate(req, { onError: (err) => noMasterKey(err) && onNoKey(err.message) });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        New webhook
      </Button>
      <DialogContent
        title={created ? "Copy the secret now" : refused ? "No webhooks without a master key" : scope ? `New webhook of ${scope.format}/${scope.repo}` : "New webhook over a mask"}
        description={
          created
            ? "This is the only time the server shows it. Give it to the receiver, which checks every request with it; a new one can be made later."
            : refused
              ? undefined
              : `Lajstrom sends the events of ${scope ? "this repo" : "every repo the mask matches"} to the URL as CloudEvents signed with the webhook's secret, again until the receiver answers 2xx.`
        }
      >
        {created ? (
          <>
            <SecretReveal secret={created.secret} />
            <DialogActions>
              <DialogClose asChild>
                <Button variant="primary">Done</Button>
              </DialogClose>
            </DialogActions>
          </>
        ) : refused ? (
          <>
            <NoMasterKey message={refused} />
            <DialogActions>
              <DialogClose asChild>
                <Button>Close</Button>
              </DialogClose>
            </DialogActions>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <WebhookFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} mask={scope === null} create />
            <FormError error={errorText(create.error)} />
            <DialogActions>
              <DialogClose asChild>
                <Button type="button" disabled={create.isPending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
                <WebhookIcon />
                {create.isPending ? "Creating…" : "Create webhook"}
              </Button>
            </DialogActions>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type ChangeProps = { scope: WebhookScope; webhook: Webhook; onClose: () => void };

/** Changes the URL, the events and the description, and waits for the server, which checks the
 * URL (realistic). The mask never changes; active has its switch. */
export function EditWebhookDialog({ scope, webhook, onClose }: ChangeProps) {
  const [draft, setDraft] = useState<Draft>({ ...webhook });
  const edit = useUpdateWebhook(scope, webhook);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = draft.url.trim();
    const description = draft.description.trim();
    const req: WebhookRequest = {
      ...(url !== webhook.url ? { url } : {}),
      ...(!sameEvents(draft.events, webhook.events) ? { events: draft.events } : {}),
      ...(description !== webhook.description ? { description } : {}),
    };
    if (!Object.keys(req).length) return onClose();
    edit.mutate(req, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !edit.isPending && onClose()}>
      <DialogContent title={`Change the webhook to ${urlHost(webhook.url)}`} description={`Its mask, ${webhook.mask}, stays: a webhook of another mask is a new one.`}>
        <form onSubmit={submit} className="space-y-4">
          <WebhookFields draft={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} mask={false} create={false} />
          <FormError error={errorText(edit.error)} />
          <DialogActions>
            <Button type="button" disabled={edit.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={draft.url.trim() === "" || edit.isPending}>
              <Pencil />
              {edit.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type RotateProps = ChangeProps & { noKey: string | null; onNoKey: (message: string) => void };

/** Asks before a new secret, then shows it, the one time the server answers it (realistic). */
export function RotateSecretDialog({ scope, webhook, noKey, onNoKey, onClose }: RotateProps) {
  const rotate = useRotateSecret(scope, webhook);
  const secret = rotate.data?.secret;
  const refused = noMasterKey(rotate.error) ? rotate.error.message : secret ? null : noKey;
  return (
    <Dialog open onOpenChange={(o) => !o && !rotate.isPending && onClose()}>
      <DialogContent
        title={secret ? "Copy the new secret now" : `A new secret for the webhook to ${urlHost(webhook.url)}?`}
        description={secret ? "This is the only time the server shows it." : undefined}
      >
        {secret ? (
          <SecretReveal secret={secret} />
        ) : refused ? (
          <NoMasterKey message={refused} />
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              The old secret signs nothing from then on, the retries of earlier events included: the receiver refuses every request until it has the new one,
              and Lajstrom tries them again.
            </p>
            <FormError error={errorText(rotate.error)} />
          </div>
        )}
        <DialogActions>
          {secret || refused ? (
            <Button variant={secret ? "primary" : "secondary"} onClick={onClose}>
              {secret ? "Done" : "Close"}
            </Button>
          ) : (
            <>
              <Button disabled={rotate.isPending} onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={rotate.isPending}
                onClick={() => rotate.mutate(undefined, { onError: (err) => noMasterKey(err) && onNoKey(err.message) })}
              >
                <RotateCcwKey />
                {rotate.isPending ? "Making one…" : "New secret"}
              </Button>
            </>
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

type DeleteProps = ChangeProps & {
  /** Leaves the webhook's panel, before the lists are fetched again. */
  leave: () => Promise<void>;
};

/** Names what a delete takes, then waits for the server (realistic): it cannot be undone. */
export function DeleteWebhookDialog({ scope, webhook, leave, onClose }: DeleteProps) {
  const del = useDeleteWebhook(scope, webhook, leave);
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={`Delete the webhook to ${urlHost(webhook.url)}?`}>
        <div className="space-y-3 text-sm">
          <p>
            The events of <span className="font-mono">{webhook.mask}</span> go to <span className="font-mono break-all">{webhook.url}</span> no more. Its
            delivery log goes with it, and its pending deliveries are not sent. This cannot be undone: a webhook made again has a new secret.
          </p>
          <FormError error={errorText(del.error)} />
        </div>
        <DialogActions>
          <Button disabled={del.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate(undefined, { onSuccess: onClose })}>
            <Trash2 />
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
