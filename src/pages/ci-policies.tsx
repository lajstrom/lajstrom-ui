import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BadgeCheck, CalendarClock, Hourglass, Lock, Pencil, Plus, Trash2, Workflow, X } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/api/client";
import { ciPolicyChanges } from "@/api/mutations";
import { callerQuery, ciPoliciesQuery, ciPolicyQuery } from "@/api/queries";
import { needsStepUp } from "@/api/step-up";
import type { CIPolicy, CIPolicyList } from "@/api/types";
import { ErrorState, Principal, RelativeTime } from "@/components/common";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { EmptyState, Properties, Property, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import {
  approvalRefusal,
  claimKind,
  daysUntil,
  EXPIRES_SOON,
  expiryText,
  isConfig,
  platformOf,
  platforms,
  renewable,
  waiting,
} from "@/lib/ci-policies";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format";
import { notify } from "@/lib/notices";
import { roleTone } from "@/lib/roles";

import { changedMeanwhile, useCIChange, useNames, useReadAgain, useStepUpReplay, type CIChange } from "./ci-policy-changes";
import { DeletePolicyDialog, PolicyFormDialog, RenewDialog } from "./ci-policy-dialogs";
import { ChangeError, ReplayOutcome } from "./ci-step-up";

/** Which policies the list shows; all when absent. */
type Filter = "waiting" | "active" | "expired";

/** The URL state of the tab: the filter, and the policy shown. */
type CISearch = { tab?: string; state?: Filter; policy?: string };

const filters: { value: Filter | "all"; label: string; test: (p: CIPolicy) => boolean }[] = [
  { value: "all", label: "All", test: () => true },
  { value: "waiting", label: "Waiting for approval", test: (p) => waiting(p) !== null },
  { value: "active", label: "Active", test: (p) => p.state === "active" && waiting(p) === null },
  { value: "expired", label: "Expired", test: (p) => p.state === "expired" },
];

/**
 * The CI trust policies (docs/api.md, CI trust policies; docs/spec/rbac.md §11), a tab of Access
 * for the admin: which CI jobs get a CI token and what it may do. Those of the configuration are
 * shown read-only; the admin makes, changes, renews, approves and deletes those of the API. A
 * change that the server takes only with a fresh sign-in is sent again after it, here
 * (src/api/step-up.ts).
 */
export function CIPolicies() {
  const search = useSearch({ strict: false }) as CISearch;
  const navigate = useNavigate();
  const setSearch = (patch: Partial<CISearch>) => navigate({ to: "/access", search: (p: CISearch) => ({ ...p, tab: "ci", ...patch }), replace: true });
  const select = (name: string | null) => setSearch({ policy: name ?? undefined });
  const policies = useQuery(ciPoliciesQuery);
  const who = useQuery(callerQuery);
  const admin = who.data?.admin === true;
  const names = useNames();
  const replay = useStepUpReplay();
  const [creating, setCreating] = useState(false);

  const filter = filters.find((f) => f.value === search.state) ?? filters[0]!;
  const list = policies.data?.policies ?? [];
  const shown = list.filter(filter.test);

  return (
    <div className="space-y-4">
      <ReplayOutcome replay={replay} />
      <Card>
        <CardHeader
          icon={<Workflow />}
          title="CI trust policies"
          description="A CI job's OIDC token, from GitHub Actions or GitLab CI, is exchanged for a CI token of minutes when a policy of its issuer matches its claims; the token has the policy's grants."
          actions={
            admin && policies.data ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus />
                New policy
              </Button>
            ) : null
          }
        />
        {policies.data && list.length ? (
          <div className="border-b border-border px-4 py-2">
            <Segmented
              aria-label="State"
              value={filter.value}
              onChange={(v) => void setSearch({ state: v === "all" ? undefined : v })}
              options={filters.map((f) => ({ value: f.value, label: f.label, count: list.filter(f.test).length }))}
            />
          </div>
        ) : null}
        {policies.isError ? (
          <ErrorState error={policies.error} onRetry={() => void policies.refetch()} />
        ) : policies.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<Workflow />} title={list.length ? `No policy is ${filter.label.toLowerCase()}` : "No CI trust policies"} className="py-8">
            {list.length
              ? "Every policy is in another state."
              : "A policy lets the jobs of a CI project publish or read without a stored secret: their platform's OIDC token is exchanged for a token of minutes."}
          </EmptyState>
        ) : (
          <PolicyTable policies={shown} selected={search.policy} onSelect={(name) => void select(name === search.policy ? null : name)} names={names} />
        )}
      </Card>

      {search.policy && policies.data ? (
        <PolicyPanel key={search.policy} name={search.policy} list={policies.data} admin={admin} principal={who.data?.principal} names={names} onClose={() => void select(null)} />
      ) : null}

      {creating && policies.data ? (
        <PolicyFormDialog
          list={policies.data}
          onClose={() => setCreating(false)}
          onSaved={(name) => {
            setCreating(false);
            void select(name);
          }}
        />
      ) : null}
    </div>
  );
}

const stateTone: Record<NonNullable<CIPolicy["state"]>, BadgeProps["tone"]> = { active: "success", pending: "warning", expired: "danger" };

const stateHelp: Record<NonNullable<CIPolicy["state"]>, string> = {
  active: "Counts: the CI jobs it matches get tokens",
  pending: "Waits for another admin's approval, and grants nothing until then",
  expired: "Its expiry passed: it grants nothing until it is renewed and the renewal approved",
};

/** The badges of a policy's state, and a renewal that waits. */
function PolicyState({ policy }: { policy: CIPolicy }) {
  const state = policy.state ?? "active";
  return (
    <span className="flex flex-wrap gap-1">
      <Tooltip content={stateHelp[state]}>
        <Badge tone={stateTone[state]}>{state}</Badge>
      </Tooltip>
      {waiting(policy) === "renewal" ? (
        <Tooltip content={`A renewal to ${formatDate(policy.renewal!.expiresAt)} waits for another admin's approval`}>
          <Badge tone="warning">renewal waiting</Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** When a policy stops counting: in so many days, and its date; one that reads does not expire. */
function Expiry({ policy }: { policy: CIPolicy }) {
  if (isConfig(policy)) return <span className="text-xs text-muted-foreground">—</span>;
  if (!policy.expiresAt) return <span className="text-xs text-muted-foreground">does not expire</span>;
  const days = daysUntil(policy.expiresAt);
  return (
    <span className="flex flex-col gap-0.5 text-xs">
      <Tooltip content={formatDateTime(policy.expiresAt)}>
        <span className={cn("w-fit whitespace-nowrap", days < 0 ? "text-danger" : days < EXPIRES_SOON ? "text-warning" : "text-muted-foreground")}>
          {expiryText(policy.expiresAt)}
        </span>
      </Tooltip>
      {policy.renewal ? <span className="whitespace-nowrap text-muted-foreground">renewal to {formatDate(policy.renewal.expiresAt)}</span> : null}
    </span>
  );
}

function Claims({ claims }: { claims: CIPolicy["claims"] }) {
  return (
    <span className="flex flex-col gap-0.5 font-mono text-[11.5px]">
      {Object.entries(claims).map(([claim, values]) => (
        <span key={claim} className="break-words">
          <span className="text-muted-foreground">{claim}</span> {values.join(", ")}
        </span>
      ))}
    </span>
  );
}

function Grants({ grants }: { grants: CIPolicy["grants"] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {grants.map((g) => (
        <Badge key={`${g.role} ${g.mask}`} tone={roleTone[g.role]} shape="square" className="font-mono">
          {g.role} {g.mask}
        </Badge>
      ))}
    </span>
  );
}

/** A principal of a policy, by its user's name when the admin knows it. */
function Who({ principal, names }: { principal: string | undefined; names: Map<string, string> }) {
  return <Principal value={principal} name={principal ? names.get(principal) : undefined} />;
}

type TableProps = { policies: CIPolicy[]; selected: string | undefined; onSelect: (name: string) => void; names: Map<string, string> };

function PolicyTable({ policies, selected, onSelect, names }: TableProps) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Policy</TH>
          <TH>Issuer</TH>
          <TH>Claims</TH>
          <TH>Grants</TH>
          <TH>State</TH>
          <TH>Expiry</TH>
          <TH>Changed</TH>
        </TR>
      </THead>
      <TBody>
        {policies.map((p) => (
          <TR
            key={p.name}
            aria-selected={p.name === selected}
            className={cn("cursor-pointer align-top transition-colors hover:bg-surface", p.name === selected && "bg-surface")}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a,button")) return;
              onSelect(p.name);
            }}
          >
            <TD className="align-top">
              <button type="button" onClick={() => onSelect(p.name)} className="cursor-pointer text-left font-mono text-[12.5px] font-medium whitespace-nowrap hover:underline">
                {p.name}
              </button>
              {isConfig(p) ? (
                <Tooltip content="Declared in the server's configuration, auth.ci.policies: read-only here">
                  <span className="mt-0.5 flex w-fit items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3" />
                    configuration
                  </span>
                </Tooltip>
              ) : null}
            </TD>
            <TD className="align-top font-mono text-xs">{p.issuer}</TD>
            <TD className="max-w-[18rem] min-w-56 align-top">
              <Claims claims={p.claims} />
            </TD>
            <TD className="max-w-[16rem] min-w-40 align-top">
              <Grants grants={p.grants} />
            </TD>
            <TD className="align-top">
              <PolicyState policy={p} />
            </TD>
            <TD className="align-top">
              <Expiry policy={p} />
            </TD>
            <TD className="align-top text-xs text-muted-foreground">
              {isConfig(p) ? (
                "—"
              ) : (
                <span className="flex flex-col gap-0.5">
                  <Who principal={p.updatedBy} names={names} />
                  <RelativeTime iso={p.updatedAt} />
                </span>
              )}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

type PanelProps = {
  name: string;
  list: CIPolicyList;
  admin: boolean;
  /** The caller's principal: the admin who made a change does not approve it. */
  principal: string | undefined;
  names: Map<string, string>;
  onClose: () => void;
};

/** One policy, read with its ETag: what waits for an approval and the approval, what it is, and
 * its changes. Every change names the revision shown. */
function PolicyPanel({ name, list, admin, principal, names, onClose }: PanelProps) {
  const q = useQuery(ciPolicyQuery(name));
  const [dialog, setDialog] = useState<"edit" | "renew" | "delete" | null>(null);
  const navigate = useNavigate();
  // Here, not in the approval: the approval leaves the panel once the policy waits no more, and
  // its notice comes after that.
  const approve = useCIChange();

  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Card>
        {gone ? (
          <EmptyState title={`No policy ${name}`} className="py-6" action={<Button onClick={onClose}>Close</Button>}>
            It may have been deleted.
          </EmptyState>
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )}
      </Card>
    );
  }
  if (!q.data) {
    return (
      <Card className="space-y-2 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24" />
      </Card>
    );
  }
  const { data: policy, etag } = q.data;
  const platform = platformOf(policy.issuer, list.issuers, list.policies);
  const changes = admin && !isConfig(policy);

  return (
    <Card aria-label={`Policy ${policy.name}`}>
      <CardHeader
        icon={<Workflow />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{policy.name}</span>
            <PolicyState policy={policy} />
          </span>
        }
        description={isConfig(policy) ? "Declared in the server's configuration, auth.ci.policies: it changes there, and a restart of each replica takes it." : undefined}
        actions={
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        }
      />
      {changes ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <Button size="sm" onClick={() => setDialog("edit")}>
            <Pencil />
            Edit
          </Button>
          {renewable(policy) ? (
            <Button size="sm" onClick={() => setDialog("renew")}>
              <CalendarClock />
              Renew
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDialog("delete")}>
            <Trash2 />
            Delete
          </Button>
        </div>
      ) : null}
      {admin && waiting(policy) ? <Approval policy={policy} etag={etag} principal={principal} names={names} approve={approve} /> : null}
      <CardBody>
        <Properties>
          <Property label="Issuer">
            <span className="font-mono">{policy.issuer}</span>
            {platform ? <span className="ml-1.5 text-xs text-muted-foreground">{platforms[platform].label}</span> : null}
          </Property>
          <Property label="Claims">
            <ClaimTable policy={policy} platform={platform} />
          </Property>
          <Property label="Grants">
            <Grants grants={policy.grants} />
          </Property>
          {isConfig(policy) ? null : (
            <>
              <Property label="Expiry">
                <Expiry policy={policy} />
              </Property>
              <Property label="Created">
                <span className="inline-flex flex-wrap items-center gap-x-1.5">
                  <Who principal={policy.createdBy} names={names} />
                  <RelativeTime iso={policy.createdAt} className="text-muted-foreground" />
                </span>
              </Property>
              <Property label="Changed">
                <span className="inline-flex flex-wrap items-center gap-x-1.5">
                  <Who principal={policy.updatedBy} names={names} />
                  <RelativeTime iso={policy.updatedAt} className="text-muted-foreground" />
                </span>
              </Property>
              <Property label="Approved">
                {policy.approvedBy ? (
                  <span className="inline-flex flex-wrap items-center gap-x-1.5">
                    <Who principal={policy.approvedBy} names={names} />
                    <RelativeTime iso={policy.approvedAt} className="text-muted-foreground" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">{policy.expiresAt ? "not since its latest change" : "a policy that reads needs no approval"}</span>
                )}
              </Property>
            </>
          )}
        </Properties>
      </CardBody>

      {dialog === "edit" ? <PolicyFormDialog list={list} editing={{ policy, etag }} onClose={() => setDialog(null)} onSaved={() => setDialog(null)} /> : null}
      {dialog === "renew" ? <RenewDialog policy={policy} etag={etag} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? (
        <DeletePolicyDialog
          policy={policy}
          etag={etag}
          onClose={() => setDialog(null)}
          leave={() => navigate({ to: "/access", search: (p: CISearch) => ({ ...p, policy: undefined }), replace: true })}
        />
      ) : null}
    </Card>
  );
}

/** The claims of a policy, each with how it is compared on the issuer's platform. */
function ClaimTable({ policy, platform }: { policy: CIPolicy; platform: ReturnType<typeof platformOf> }) {
  return (
    <table className="text-xs">
      <tbody>
        {Object.entries(policy.claims).map(([claim, values]) => {
          const kind = platform ? claimKind(platform, claim) : null;
          return (
            <tr key={claim} className="align-top">
              <td className="py-0.5 pr-3 font-mono text-muted-foreground">
                {claim}
                {kind ? <span className="ml-1.5 font-sans text-[11px] opacity-70">{kind}</span> : null}
              </td>
              <td className="py-0.5 font-mono break-all">{values.join(", ")}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type ApprovalProps = {
  policy: CIPolicy;
  etag: string | null;
  principal: string | undefined;
  names: Map<string, string>;
  approve: ReturnType<typeof useCIChange>;
};

/**
 * What waits on a policy for an approval, for another admin: the policy as it is now, as the
 * panel shows it below (the server serves no diff), who changed it and when, and the approval of
 * exactly that revision, its ETag in If-Match. When it changed meanwhile, the server refuses
 * (412) and the panel reads the policy again, so that what is shown is what is approved.
 */
function Approval({ policy, etag, principal, names, approve }: ApprovalProps) {
  const readAgain = useReadAgain(policy.name);
  const kind = waiting(policy);
  const refusal = approvalRefusal(policy, principal);
  const change: CIChange | null = etag ? { request: ciPolicyChanges.approve(policy.name, etag), what: `Approve the CI trust policy ${policy.name}` } : null;
  const send = () =>
    change &&
    approve.mutate(change, {
      onSuccess: () => notify({ tone: "success", title: `Approved ${policy.name}`, description: kind === "renewal" ? "It has the renewal's expiry now." : "It counts from the next exchange on." }),
      onError: (err) => changedMeanwhile(err) && void readAgain(),
    });
  return (
    <div className="space-y-2.5 border-b border-border bg-warning-soft px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-warning">
        <Hourglass className="size-4 shrink-0" />
        {kind === "renewal" ? "Its renewal waits for approval" : "Waiting for approval"}
      </p>
      <p>
        {kind === "renewal" ? (
          <>
            Approved, the policy expires {formatDate(policy.renewal!.expiresAt)} instead of {formatDate(policy.expiresAt)}; until then it keeps its expiry.
          </>
        ) : (
          <>It grants nothing until an admin other than the one who changed it approves it. What you approve is the policy as it is below.</>
        )}
      </p>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {kind === "renewal" ? "Renewed by" : "Changed by"}
        <span className="text-foreground">
          <Who principal={policy.updatedBy} names={names} />
        </span>
        <RelativeTime iso={policy.updatedAt} />
      </p>
      {changedMeanwhile(approve.error) ? (
        <FormError error="It changed since you read it, and nothing was approved: below is the policy as it is now. Read it, then approve it." />
      ) : change ? (
        <ChangeError error={approve.error} change={change} />
      ) : null}
      {refusal ? (
        <p className="text-xs text-muted-foreground">{refusal}</p>
      ) : needsStepUp(approve.error) ? null : !etag ? (
        <p className="text-xs text-muted-foreground">
          The server&apos;s answer has no ETag, which an approval names: a server on another origin than the UI&apos;s does not expose it.
        </p>
      ) : (
        <Button size="sm" variant="primary" disabled={approve.isPending} onClick={send}>
          <BadgeCheck />
          {approve.isPending ? "Approving…" : kind === "renewal" ? "Approve the renewal" : "Approve this policy"}
        </Button>
      )}
    </div>
  );
}
