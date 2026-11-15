import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Pencil, RotateCcwKey, Send, Trash2, Webhook as WebhookIcon, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useChanges, type ChangeState } from "@/api/change";
import { callerQuery, deliveriesQuery, usersQuery, webhooksQuery, type WebhookScope } from "@/api/queries";
import type { Delivery, Repo, Webhook } from "@/api/types";
import { CursorPagination, ErrorState, PageHeader, Principal, RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { FormError } from "@/components/ui/field";
import { EmptyState, Properties, Property, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import { errorText } from "@/lib/errors";
import { deliveryOutcome, deliveryTone, isExactMask, maskMatches } from "@/lib/webhooks";

import { activeKey, noMasterKey, useActive, usePing, type ActiveChange } from "./webhook-changes";
import { CreateWebhookDialog, DeleteWebhookDialog, EditWebhookDialog, NoMasterKey, RotateSecretDialog } from "./webhook-dialogs";

/** The URL state of the webhooks of a scope: the webhook shown, and the cursor of its log. */
type WebhookSearch = { webhook?: string; deliveryCursor?: string };

const changeId = (c: ActiveChange) => c.webhook.id;

/** The webhooks of every mask (docs/api.md, Webhooks): the admin's. */
export function WebhooksPage() {
  const who = useQuery(callerQuery);
  return (
    <>
      <PageHeader
        title="Webhooks"
        description="The webhooks of every mask: a version published or deleted, a repo created or deleted, sent to a URL as a signed CloudEvent (docs/spec/webhooks.md)."
      />
      <Webhooks scope={null} canChange={who.data?.admin ?? false} />
    </>
  );
}

/** A repo's webhooks, those whose mask is the repo: its Webhooks tab, for whoever may manage it. */
export function RepoWebhooks({ repo }: { repo: Repo }) {
  const who = useQuery(callerQuery);
  const admin = who.data?.admin ?? false;
  const every = useQuery({ ...webhooksQuery(null), enabled: admin });
  const wider = every.data?.filter((w) => !isExactMask(w.mask) && maskMatches(w.mask, repo.prefix)) ?? [];
  return (
    <div className="space-y-3">
      <Webhooks scope={{ format: repo.format, repo: repo.name }} canChange={can(repo, "manage")} />
      <p className="text-xs text-muted-foreground">
        {wider.length ? (
          <>
            {wider.length === 1 ? "A webhook" : `${wider.length} webhooks`} of a wider mask ({[...new Set(wider.map((w) => w.mask))].join(", ")}) get this repo's
            events too:{" "}
            <Link to="/webhooks" className="text-primary hover:underline">
              every mask's webhooks
            </Link>
            .
          </>
        ) : (
          "Webhooks of a wider mask, such as apt/* or */*, are the admin's, and get the events of every repo they match."
        )}
      </p>
    </div>
  );
}

/** Names of the users the caller can know: itself, and every user for the admin. */
function useNames(): Map<string, string> {
  const who = useQuery(callerQuery);
  const users = useQuery({ ...usersQuery, enabled: who.data?.admin ?? false });
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const u of users.data ?? []) names.set(`user:${u.uid}`, u.name);
    if (who.data?.uid) names.set(`user:${who.data.uid}`, who.data.name);
    return names;
  }, [who.data, users.data]);
}

function CreatedBy({ principal, names }: { principal: string; names: Map<string, string> }) {
  const user = principal.startsWith("user:");
  return <Principal value={principal} name={user ? (names.get(principal) ?? `${principal.slice(5, 13)}…`) : undefined} />;
}

function Events({ events }: { events: Webhook["events"] }) {
  if (!events.length) return <span className="text-xs text-muted-foreground">every event</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {events.map((e) => (
        <Badge key={e} tone="outline" shape="square" className="font-mono">
          {e}
        </Badge>
      ))}
    </span>
  );
}

type WebhooksProps = {
  scope: WebhookScope;
  /** The caller may change them: manage on the repo, or the admin role. */
  canChange: boolean;
};

/** The list of a scope's webhooks, the panel of the one in the URL with its delivery log, and
 * the dialogs of their changes. */
function Webhooks({ scope, canChange }: WebhooksProps) {
  const search = useSearch({ strict: false }) as WebhookSearch;
  const navigate = useNavigate();
  const setSearch = (patch: Partial<WebhookSearch>) => navigate({ to: ".", search: (p: WebhookSearch) => ({ ...p, ...patch }) });
  const select = (id: number | null) => setSearch({ webhook: id === null ? undefined : String(id), deliveryCursor: undefined });

  const hooks = useQuery(webhooksQuery(scope));
  const names = useNames();
  const active = useActive(scope);
  const changes = useChanges(activeKey, changeId);
  // The server's message once it has answered that it has no master key: the forms that need
  // one say so instead.
  const [noKey, setNoKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Webhook | null>(null);
  const [rotating, setRotating] = useState<Webhook | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);

  const selectedId = search.webhook === undefined ? null : Number(search.webhook);
  const list = hooks.data ?? [];
  const selected = list.find((w) => w.id === selectedId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<WebhookIcon />}
          title="Webhooks"
          description={
            scope
              ? "Events of this repo, sent to a URL as CloudEvents signed with the webhook's secret, again until the receiver answers 2xx"
              : "Each gets the events of the repos its mask matches, those created later too"
          }
          actions={canChange ? <CreateWebhookDialog scope={scope} noKey={noKey} onNoKey={setNoKey} onCreated={(id) => void select(id)} /> : null}
        />
        {hooks.isError ? (
          <ErrorState error={hooks.error} onRetry={() => void hooks.refetch()} />
        ) : hooks.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={<WebhookIcon />} title="No webhooks" className="py-8">
            A webhook tells another system that a version was published or deleted{scope ? " here" : ", or a repo created or deleted"}: to rebuild a site,
            refresh a mirror, or keep a record elsewhere.
          </EmptyState>
        ) : (
          <WebhookTable
            webhooks={list}
            every={scope === null}
            selected={selectedId}
            onSelect={(id) => void select(id === selectedId ? null : id)}
            onActive={canChange ? (c) => active.mutate(c) : undefined}
            changes={changes}
            names={names}
          />
        )}
      </Card>

      {selected ? (
        <WebhookPanel
          key={selected.id}
          scope={scope}
          webhook={selected}
          names={names}
          cursor={search.deliveryCursor}
          onCursor={(deliveryCursor) => void setSearch({ deliveryCursor })}
          onClose={() => void select(null)}
          actions={
            canChange
              ? {
                  onActive: (c) => active.mutate(c),
                  change: changes.get(selected.id),
                  onEdit: () => setEditing(selected),
                  onRotate: () => setRotating(selected),
                  onDelete: () => setDeleting(selected),
                  noKey,
                  onNoKey: setNoKey,
                }
              : null
          }
        />
      ) : selectedId !== null && hooks.data ? (
        <Card>
          <EmptyState title={`No webhook ${search.webhook} here`} className="py-6" action={<Button onClick={() => void select(null)}>Close</Button>}>
            It may have been deleted{scope ? ", or its mask is not this repo" : ""}.
          </EmptyState>
        </Card>
      ) : null}

      {editing ? <EditWebhookDialog scope={scope} webhook={editing} onClose={() => setEditing(null)} /> : null}
      {rotating ? <RotateSecretDialog scope={scope} webhook={rotating} noKey={noKey} onNoKey={setNoKey} onClose={() => setRotating(null)} /> : null}
      {deleting ? (
        <DeleteWebhookDialog
          scope={scope}
          webhook={deleting}
          leave={() => (deleting.id === selectedId ? select(null) : Promise.resolve())}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

type TableProps = {
  webhooks: Webhook[];
  /** The webhooks of every mask: the table names each one's mask. */
  every: boolean;
  selected: number | null;
  onSelect: (id: number) => void;
  /** Turns a webhook on or off (optimistic); absent for a caller who may not. */
  onActive?: (change: ActiveChange) => void;
  changes: Map<string | number, ChangeState>;
  names: Map<string, string>;
};

function WebhookTable({ webhooks, every, selected, onSelect, onActive, changes, names }: TableProps) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>URL</TH>
          {every ? <TH>Mask</TH> : null}
          <TH>Events</TH>
          <TH>Active</TH>
          <TH>Created</TH>
        </TR>
      </THead>
      <TBody>
        {webhooks.map((w) => {
          const change = changes.get(w.id);
          const [format = "", repo = ""] = w.mask.split("/");
          return (
            <TR
              key={w.id}
              aria-selected={w.id === selected}
              className={cn("cursor-pointer transition-colors hover:bg-surface", w.id === selected && "bg-surface")}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a,button")) return;
                onSelect(w.id);
              }}
            >
              <TD className="max-w-[26rem]">
                <button
                  type="button"
                  title={w.url}
                  onClick={() => onSelect(w.id)}
                  className={cn("block max-w-full cursor-pointer truncate text-left font-mono text-[12.5px] font-medium hover:underline", !w.active && "text-muted-foreground")}
                >
                  {w.url}
                </button>
                {w.description ? <div className="truncate text-xs text-muted-foreground">{w.description}</div> : null}
                {change?.error ? <div className="mt-0.5 text-xs text-danger">Not changed. {errorText(change.error)}</div> : null}
              </TD>
              {every ? (
                <TD className="font-mono text-xs whitespace-nowrap">
                  {isExactMask(w.mask) ? (
                    <Link
                      to="/$format/$repo"
                      params={{ format, repo }}
                      search={{ tab: "webhooks", webhook: String(w.id) }}
                      className="hover:underline"
                    >
                      {w.mask}
                    </Link>
                  ) : (
                    w.mask
                  )}
                </TD>
              ) : null}
              <TD>
                <Events events={w.events} />
              </TD>
              <TD>
                {onActive ? (
                  <Switch
                    checked={w.active}
                    disabled={change?.pending}
                    aria-label={`Active: ${w.url}`}
                    onCheckedChange={(on) => onActive({ webhook: w, active: on })}
                  />
                ) : (
                  <Badge tone={w.active ? "success" : "neutral"}>{w.active ? "active" : "inactive"}</Badge>
                )}
              </TD>
              <TD className="text-muted-foreground">
                <div className="flex flex-col gap-0.5 text-xs">
                  <CreatedBy principal={w.createdBy} names={names} />
                  <RelativeTime iso={w.createdAt} />
                </div>
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

type PanelActions = {
  onActive: (change: ActiveChange) => void;
  change: ChangeState | undefined;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  noKey: string | null;
  onNoKey: (message: string) => void;
};

type PanelProps = {
  scope: WebhookScope;
  webhook: Webhook;
  names: Map<string, string>;
  cursor: string | undefined;
  onCursor: (cursor: string | undefined) => void;
  onClose: () => void;
  /** The changes, for a caller who may make them. */
  actions: PanelActions | null;
};

/** One webhook: what it is, its changes, a ping, and its delivery log. */
function WebhookPanel({ scope, webhook, names, cursor, onCursor, onClose, actions }: PanelProps) {
  const ping = usePing(scope, webhook);
  const send = () =>
    ping.mutate(undefined, {
      // The ping is the newest row: the log shows its first page.
      onSuccess: () => onCursor(undefined),
      onError: (err) => noMasterKey(err) && actions?.onNoKey(err.message),
    });
  const noKey = noMasterKey(ping.error) ? ping.error.message : null;
  return (
    <Card aria-label={`Webhook ${webhook.id}`}>
      <CardHeader
        icon={<WebhookIcon />}
        title={<span className="font-mono break-all">{webhook.url}</span>}
        description={webhook.description || undefined}
        actions={
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        }
      />
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Button size="sm" variant="primary" disabled={ping.isPending} onClick={send}>
            <Send />
            {ping.isPending ? "Sending…" : "Send a ping"}
          </Button>
          <Button size="sm" onClick={actions.onEdit}>
            <Pencil />
            Edit
          </Button>
          <Button size="sm" onClick={actions.onRotate}>
            <RotateCcwKey />
            New secret
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={actions.onDelete}>
            <Trash2 />
            Delete
          </Button>
        </div>
      ) : null}
      <CardBody>
        <Properties>
          <Property label="Mask">
            <span className="font-mono">{webhook.mask}</span>{" "}
            <span className="text-xs text-muted-foreground">
              {isExactMask(webhook.mask) ? (scope ? "this repo" : "one repo") : "every repo it matches, those created later too"}
            </span>
          </Property>
          <Property label="Events">
            <Events events={webhook.events} />
          </Property>
          <Property label="Active">
            <span className="inline-flex items-center gap-2">
              {actions ? (
                <Switch
                  checked={webhook.active}
                  disabled={actions.change?.pending}
                  aria-label="Active"
                  onCheckedChange={(on) => actions.onActive({ webhook, active: on })}
                />
              ) : null}
              <span className="text-xs text-muted-foreground">{webhook.active ? "gets every new event it asks for" : "gets no new event; its pending deliveries wait"}</span>
            </span>
          </Property>
          <Property label="Created">
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
              <CreatedBy principal={webhook.createdBy} names={names} />
              <RelativeTime iso={webhook.createdAt} className="text-muted-foreground" />
            </span>
          </Property>
          <Property label="Changed">
            <RelativeTime iso={webhook.updatedAt} />
          </Property>
        </Properties>
      </CardBody>
      {noKey ? (
        <div className="border-t border-border px-4 py-3">
          <NoMasterKey message={noKey} />
        </div>
      ) : ping.error ? (
        <div className="border-t border-border px-4 py-3">
          <FormError error={errorText(ping.error)} />
        </div>
      ) : ping.data ? (
        <PingResult delivery={ping.data} />
      ) : null}
      <DeliveryLog scope={scope} webhook={webhook} cursor={cursor} onCursor={onCursor} highlight={ping.data?.id} />
    </Card>
  );
}

/** The row of the delivery log that a ping answered: delivered, or failed and why. */
function PingResult({ delivery: d }: { delivery: Delivery }) {
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5 text-sm", d.state === "delivered" ? "bg-success-soft" : "bg-danger-soft")}>
      <Badge tone={deliveryTone[d.state]}>{d.state}</Badge>
      <span>
        The ping {d.state === "delivered" ? "was delivered" : "was not delivered"}: {deliveryOutcome(d)}.
      </span>
      <RelativeTime iso={d.createdAt} className="ml-auto text-xs text-muted-foreground" />
    </div>
  );
}

type LogProps = {
  scope: WebhookScope;
  webhook: Webhook;
  cursor: string | undefined;
  onCursor: (cursor: string | undefined) => void;
  /** The row of the last ping, marked. */
  highlight: number | undefined;
};

/** A webhook's delivery log, newest first, a page at a time; the cursor is in the URL. */
function DeliveryLog({ scope, webhook, cursor, onCursor, highlight }: LogProps) {
  const log = useQuery(deliveriesQuery(scope, webhook.id, cursor));
  const data = log.data;
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border px-4 pt-3 pb-2">
        <h3 className="text-sm font-semibold">Delivery log</h3>
        <span className="text-xs text-muted-foreground">Newest first. Rows older than the server's webhooks.retention, a week by default, are gone.</span>
      </div>
      {log.isError ? (
        <ErrorState error={log.error} onRetry={() => void log.refetch()} />
      ) : !data ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : data.deliveries.length === 0 ? (
        <EmptyState title="Nothing sent yet" className="py-6">
          The events it asks for show up here when they happen{cursor ? "" : ", and so does a ping"}.
        </EmptyState>
      ) : (
        <Table className={cn(log.isPlaceholderData && "opacity-60")}>
          <THead>
            <TR>
              <TH>Event</TH>
              <TH>State</TH>
              <TH className="text-right">Attempts</TH>
              <TH>Last attempt</TH>
              <TH>Next attempt</TH>
              <TH>Created</TH>
            </TR>
          </THead>
          <TBody>
            {data.deliveries.map((d) => (
              <TR key={d.id} className={cn(d.id === highlight && "bg-primary-soft")}>
                <TD>
                  <div className="font-mono text-[12.5px]">{d.eventType}</div>
                  <CopyText value={d.eventId} display={`${d.eventId.slice(0, 13)}…`} label="event id" className="text-[11px] text-muted-foreground" />
                </TD>
                <TD>
                  <Badge tone={deliveryTone[d.state]}>{d.state}</Badge>
                </TD>
                <TD className="text-right tabular">{d.attempts}</TD>
                <TD>
                  <div className={cn("text-xs", d.state !== "delivered" && d.attempts > 0 && "text-danger")}>{deliveryOutcome(d)}</div>
                  {d.lastAt ? <RelativeTime iso={d.lastAt} className="text-xs text-muted-foreground" /> : null}
                </TD>
                <TD className="text-xs text-muted-foreground">
                  {d.state !== "pending" ? "—" : webhook.active ? <RelativeTime iso={d.nextAt} /> : "when the webhook is active"}
                </TD>
                <TD className="text-muted-foreground">
                  <RelativeTime iso={d.createdAt} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {data ? <CursorPagination shown={data.deliveries.length} next={data.next} cursor={cursor} onCursor={onCursor} noun="deliveries" /> : null}
    </>
  );
}
