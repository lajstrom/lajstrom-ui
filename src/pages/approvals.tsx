// The requests for a second admin, a tab of Access (docs/spec/rbac.md §13): with auth.approval
// second-admin, a binding of the role admin or on */*, and a deploy token over a mask with write,
// are requests in place of the change, which an admin other than the one who asked approves, with
// the admin's password or a fresh sign-in through OIDC; any admin rejects one, its requester so
// withdrawing it, and one still pending after 7 days expires. ?approvals= is the state shown,
// pending by default, and ?cursor= the page.

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { BadgeCheck, Hourglass, KeyRound, Link2, LogIn, Ticket, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { describeRequest } from "@/api/approvals";
import { oidcSignInUrl, signInModes } from "@/api/auth";
import { realistic } from "@/api/change";
import { approveRequest, rejectRequest } from "@/api/mutations";
import { approvalsKey, approvalsQuery, bindingsQuery, callerQuery, infoQuery } from "@/api/queries";
import { needsStepUp } from "@/api/step-up";
import type { Approval, ApprovalState } from "@/api/types";
import { useSession } from "@/app/session";
import { CursorPagination, ErrorState, Principal, RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { notify } from "@/lib/notices";
import { roleTone, type Role } from "@/lib/roles";

import { useNames } from "./ci-policy-changes";

type Shown = ApprovalState | "all";
type ApprovalsSearch = { tab?: string; approvals?: Shown; cursor?: string };

const states: { value: Shown; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "all", label: "All" },
];

const stateTone: Record<ApprovalState, "warning" | "success" | "danger" | "neutral"> = { pending: "warning", approved: "success", rejected: "danger", expired: "neutral" };

export function Approvals() {
  const search = useSearch({ strict: false }) as ApprovalsSearch;
  const navigate = useNavigate();
  const shown: Shown = states.some((s) => s.value === search.approvals) ? search.approvals! : "pending";
  const setSearch = (patch: Partial<ApprovalsSearch>) =>
    navigate({ to: "/access", search: (p: ApprovalsSearch) => ({ ...p, tab: "approvals", ...patch }), replace: !("cursor" in patch) });
  const list = useQuery(approvalsQuery(shown === "all" ? undefined : shown, search.cursor));
  const info = useQuery(infoQuery);
  const who = useQuery(callerQuery);
  const names = useNames();
  const [approving, setApproving] = useState<Approval | null>(null);
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const requests = list.data?.approvals ?? [];
  const off = info.data?.approval === "none";

  return (
    <Card>
      <CardHeader
        icon={<Hourglass />}
        title="Requests for a second admin"
        description="An admin binding, a binding on */* and a deploy token over a mask that publishes wait for an admin other than the one who asked (auth.approval). A request grants nothing until it is approved, and expires after 7 days."
      />
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Segmented aria-label="State" value={shown} onChange={(v) => void setSearch({ approvals: v === "pending" ? undefined : v, cursor: undefined })} options={states} />
        {off ? (
          <span className="text-xs text-muted-foreground">This server makes no change wait now (auth.approval: none); requests made before stay to be decided.</span>
        ) : null}
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : requests.length === 0 ? (
        <EmptyState icon={<Hourglass />} title={shown === "pending" ? "Nothing waits for a second admin" : `No ${shown === "all" ? "" : `${shown} `}requests`} className="py-6">
          {shown === "pending" ? "A change that waits shows here until an admin other than the one who asked approves or rejects it." : null}
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Change</TH>
              <TH>Requested by</TH>
              <TH>State</TH>
              <TH className="w-0" />
            </TR>
          </THead>
          <TBody>
            {requests.map((a) => (
              <RequestRow
                key={a.id}
                request={a}
                names={names}
                mine={a.requestedBy === who.data?.principal}
                admin={who.data?.admin === true}
                onApprove={() => setApproving(a)}
                onReject={() => setRejecting(a)}
              />
            ))}
          </TBody>
        </Table>
      )}
      {list.data ? (
        <CursorPagination shown={requests.length} next={list.data.next} cursor={search.cursor} onCursor={(cursor) => void setSearch({ cursor })} noun="requests" />
      ) : null}
      {approving ? <ApproveDialog request={approving} names={names} onClose={() => setApproving(null)} /> : null}
      {rejecting ? <RejectDialog request={rejecting} names={names} mine={rejecting.requestedBy === who.data?.principal} onClose={() => setRejecting(null)} /> : null}
    </Card>
  );
}

const nameOf = (names: Map<string, string>) => (principal: string) => names.get(principal) ?? principal;

/** The change of a request: a binding with its role, or a deploy token with its scopes. */
function Change({ request: a, names }: { request: Approval; names: Map<string, string> }) {
  const c = a.change;
  if (a.kind === "binding") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Link2 className="size-3.5 text-muted-foreground" />
        <Principal value={c.principal} name={names.get(c.principal ?? "")} />
        <Badge tone={roleTone[c.role as Role] ?? "neutral"}>{c.role}</Badge>
        <span className="text-xs text-muted-foreground">on</span>
        <span className="font-mono text-xs">{c.repoMask}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <KeyRound className="size-3.5 text-muted-foreground" />
      <span>
        Deploy token <span className="font-medium">{c.name}</span>
      </span>
      <span className="text-xs text-muted-foreground">over</span>
      <span className="font-mono text-xs">{c.repoMask}</span>
      {(c.scopes ?? []).map((s) => (
        <Badge key={s} tone="outline">
          {s}
        </Badge>
      ))}
      <span className="text-xs text-muted-foreground">{c.expiresAt ? `expires ${formatDateTime(c.expiresAt)}` : "no expiry"}</span>
    </span>
  );
}

type RequestRowProps = {
  request: Approval;
  names: Map<string, string>;
  mine: boolean;
  admin: boolean;
  onApprove: () => void;
  onReject: () => void;
};

function RequestRow({ request: a, names, mine, admin, onApprove, onReject }: RequestRowProps) {
  return (
    <TR>
      <TD className="max-w-[28rem]">
        <Change request={a} names={names} />
        {a.changeReason ? (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" title={a.changeReason}>
            <Ticket className="size-3 shrink-0" />
            <span className="truncate">{a.changeReason}</span>
          </span>
        ) : null}
      </TD>
      <TD>
        <Principal value={a.requestedBy} name={names.get(a.requestedBy)} />
        <span className="block text-xs text-muted-foreground">
          <RelativeTime iso={a.requestedAt} />
        </span>
      </TD>
      <TD>
        <Badge tone={stateTone[a.state]}>{a.state === "pending" ? "waiting" : a.state}</Badge>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {a.state === "pending" ? (
            <>
              expires <RelativeTime iso={a.expiresAt} />
            </>
          ) : a.state === "expired" ? (
            <>
              <RelativeTime iso={a.expiresAt} />
            </>
          ) : (
            <>
              by {nameOf(names)(a.decidedBy ?? "")}
              {a.decidedAt ? (
                <>
                  , <RelativeTime iso={a.decidedAt} />
                </>
              ) : null}
            </>
          )}
        </span>
        {a.decisionReason ? (
          <span className="mt-0.5 flex max-w-60 items-center gap-1 text-xs text-muted-foreground" title={a.decisionReason}>
            <Ticket className="size-3 shrink-0" />
            <span className="truncate">{a.decisionReason}</span>
          </span>
        ) : null}
      </TD>
      <TD className="text-right whitespace-nowrap">
        {a.state === "pending" && admin ? (
          <span className="inline-flex gap-1.5">
            {mine ? (
              <Tooltip content="You made it: an admin other than you approves it">
                <span>
                  <Button size="sm" disabled>
                    <BadgeCheck />
                    Approve
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button size="sm" variant="primary" onClick={onApprove}>
                <BadgeCheck />
                Approve
              </Button>
            )}
            <Button size="sm" onClick={onReject}>
              <X />
              {mine ? "Withdraw" : "Reject"}
            </Button>
          </span>
        ) : a.state === "approved" && a.result?.startsWith("binding:") ? (
          <Link to="/access" search={{ tab: "bindings" }} className="text-xs text-primary hover:underline">
            Bindings
          </Link>
        ) : a.state === "approved" && a.result?.startsWith("token:") ? (
          <Link to="/access" search={{ tab: "masks", mask: a.change.repoMask }} className="text-xs text-primary hover:underline">
            Tokens over {a.change.repoMask}
          </Link>
        ) : null}
      </TD>
    </TR>
  );
}

/** The queries a decision changes: the requests, and what an approval makes. */
function useDecision<T>(run: (v: T) => Promise<Approval>) {
  return useMutation({ mutationFn: run, ...realistic(approvalsKey, bindingsQuery.queryKey, ["deploy-tokens"]) });
}

/**
 * Approves a request, which makes its change at once. The server takes it with the admin's
 * password, which the dialog asks for, or, for a sign-in through OIDC, the session itself when
 * the sign-in is fresh: one that is not is asked for more, and the person signs in again at the
 * identity provider, comes back here and approves again.
 */
function ApproveDialog({ request: a, names, onClose }: { request: Approval; names: Map<string, string>; onClose: () => void }) {
  const ids = { password: useId() };
  const session = useSession();
  const info = useQuery(infoQuery);
  const here = useRouterState({ select: (s) => s.location.href });
  // A sign-in through OIDC stands for the password; any other session sends the password.
  const byPassword = !session?.signIn;
  const [password, setPassword] = useState("");
  const what = describeRequest(a, nameOf(names));
  const approve = useDecision(() => approveRequest(a.id, byPassword && session ? { user: session.user, password } : undefined).finally(() => setPassword("")));
  const again = useMutation({ mutationFn: () => oidcSignInUrl(here, "login"), onSuccess: (url) => window.location.assign(url) });
  const ready = !byPassword || password !== "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    approve.mutate(undefined, {
      onSuccess: () => {
        notify({ tone: "success", title: `Approved: ${what}`, description: "It counts from the next request on." });
        onClose();
      },
    });
  };
  const stepUp = needsStepUp(approve.error);
  return (
    <Dialog open onOpenChange={(o) => !o && !approve.isPending && onClose()}>
      <DialogContent title={`Approve request ${a.id}`} description={`Approved, the change is made at once: ${what}.`}>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1 rounded-md border border-border px-3 py-2 text-sm">
            <Change request={a} names={names} />
            <p className="text-xs text-muted-foreground">
              Asked by {nameOf(names)(a.requestedBy)} <RelativeTime iso={a.requestedAt} />
              {a.changeReason ? `: ${a.changeReason}` : ", without a reason"}
            </p>
          </div>
          {byPassword ? (
            signInModes(info.data).password ? (
              <Field label="Your password" htmlFor={ids.password} hint="The server takes an approval with the admin's password, or a fresh sign-in through single sign-on, never with a token.">
                <Input id={ids.password} type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">This server takes no password: sign in through single sign-on to approve.</p>
            )
          ) : null}
          {stepUp ? (
            <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
              <p>An approval takes a sign-in of the last 10 minutes: sign in again at your identity provider, then approve once more.</p>
              <p className="font-mono text-xs break-words text-muted-foreground">{approve.error?.message}</p>
              <Button size="sm" variant="primary" type="button" disabled={again.isPending || again.isSuccess} onClick={() => again.mutate()}>
                <LogIn />
                {again.isPending || again.isSuccess ? "Going to sign in…" : "Sign in again"}
              </Button>
              <FormError error={again.error ? `Not signed in again: ${again.error.message}` : null} />
            </div>
          ) : (
            <FormError error={errorText(approve.error)} />
          )}
          <DialogActions>
            <Button type="button" disabled={approve.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || approve.isPending || (byPassword && !signInModes(info.data).password)}>
              <BadgeCheck />
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Rejects a request, or withdraws one's own: nothing is made, and the request is decided. */
function RejectDialog({ request: a, names, mine, onClose }: { request: Approval; names: Map<string, string>; mine: boolean; onClose: () => void }) {
  const what = describeRequest(a, nameOf(names));
  const reject = useDecision(() => rejectRequest(a.id));
  const send = () =>
    reject.mutate(undefined, {
      onSuccess: () => {
        notify({ tone: "success", title: `${mine ? "Withdrew" : "Rejected"}: ${what}` });
        onClose();
      },
    });
  return (
    <Dialog open onOpenChange={(o) => !o && !reject.isPending && onClose()}>
      <DialogContent
        title={mine ? `Withdraw your request ${a.id}?` : `Reject request ${a.id}?`}
        description={`Nothing is made of it: ${what}. The request stays in the list, rejected; a change wanted later is asked for again.`}
      >
        <FormError error={errorText(reject.error)} />
        <DialogActions>
          <Button type="button" disabled={reject.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reject.isPending} onClick={send}>
            <X />
            {reject.isPending ? (mine ? "Withdrawing…" : "Rejecting…") : mine ? "Withdraw" : "Reject"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
