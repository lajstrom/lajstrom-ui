import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Info, UserX } from "lucide-react";

import { useChanges } from "@/api/change";
import { bindingsQuery, callerQuery, infoQuery, reposQuery, tokensQuery, usersQuery } from "@/api/queries";
import type { Binding } from "@/api/types";
import { ErrorState, PageHeader, Principal, RelativeTime } from "@/components/common";
import { TokenStatus } from "@/components/tokens";
import { LastSeen, UserStatus } from "@/components/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { errorText } from "@/lib/errors";
import { maskMatches } from "@/lib/masks";
import { roleActions, roleTone } from "@/lib/roles";

import { AccessReview } from "./access-review";
import { Approvals } from "./approvals";
import { CIPolicies } from "./ci-policies";
import { MaskTokens } from "./mask-tokens";
import { deleteBindingKey, disableKey, useDeleteBinding, useDisableUser, type DisableChange } from "./user-changes";
import { CreateBindingDialog, CreateUserDialog } from "./user-dialogs";

type Tab = "users" | "tokens" | "masks" | "bindings" | "ci" | "approvals" | "review";

const userId = (c: DisableChange) => c.user.uid;
const bindingId = (b: Binding) => b.id;

export function AccessPage() {
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const tab = search.tab ?? "users";
  // The requests for a second admin, on a server that has them (info.approval), with how many
  // wait for this admin: those it could approve (rbac.md §13, Telling the second admin).
  const info = useQuery(infoQuery);
  const who = useQuery(callerQuery);
  const requests = info.data?.approval !== undefined && who.data?.admin === true;
  const count = info.data?.pendingApprovals;

  return (
    <>
      <PageHeader
        title="Access"
        description="Who can do what: users, their tokens, role bindings on repo masks, and the CI jobs that get tokens (docs/spec/rbac.md)."
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-soft-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>
          The admin role manages users and bindings, here or with the lajstrom admin commands; a user&apos;s page has its bindings and
          its tokens. Every change is a row of the{" "}
          <Link to="/audit" className="font-medium underline-offset-2 hover:underline">
            audit log
          </Link>
          . Your own tokens are under Personal access tokens in the user menu.
        </span>
      </div>
      <Segmented
        aria-label="Section"
        className="mb-4"
        value={tab}
        onChange={(t) => void navigate({ to: "/access", search: { tab: t === "users" ? undefined : t }, replace: true })}
        options={[
          { value: "users", label: "Users" },
          { value: "tokens", label: "Tokens" },
          { value: "masks", label: "Tokens over a mask" },
          { value: "bindings", label: "Bindings" },
          { value: "ci", label: "CI trust policies" },
          ...(requests ? [{ value: "approvals" as const, label: count ? `Requests (${count})` : "Requests" }] : []),
          // The access report of a server that has it, like the requests (rbac.md §14).
          ...(requests ? [{ value: "review" as const, label: "Review" }] : []),
        ]}
      />
      {tab === "users" ? (
        <UsersTable />
      ) : tab === "tokens" ? (
        <TokensTable />
      ) : tab === "masks" ? (
        <MaskTokens />
      ) : tab === "ci" ? (
        <CIPolicies />
      ) : tab === "approvals" ? (
        <Approvals />
      ) : tab === "review" ? (
        <AccessReview />
      ) : (
        <BindingsTable />
      )}
    </>
  );
}

function Loading() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}

function UsersTable() {
  const users = useQuery(usersQuery);
  const bindings = useQuery(bindingsQuery);
  // ?users=inactive: the users that the server answers inactive (rbac.md §1, Inactive users).
  const search = useSearch({ strict: false }) as { users?: string };
  const navigate = useNavigate();
  const onlyInactive = search.users === "inactive";
  const inactive = users.data?.filter((u) => u.inactive).length ?? 0;
  const shown = onlyInactive ? users.data?.filter((u) => u.inactive) : users.data;
  // The admin's controls: a new user, and disable or enable on each row but the admin's own
  // (optimistic); the rest is on the user's page.
  const who = useQuery(callerQuery);
  const admin = who.data?.admin === true;
  const disable = useDisableUser();
  const changes = useChanges(disableKey, userId);
  return (
    <Card>
      {admin ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {inactive > 0 || onlyInactive ? (
            <Segmented
              aria-label="Which users"
              value={onlyInactive ? "inactive" : "all"}
              onChange={(v) => void navigate({ to: ".", search: (p: Record<string, string>) => ({ ...p, users: v === "inactive" ? "inactive" : undefined }), replace: true })}
              options={[
                { value: "all", label: "All", count: users.data?.length },
                { value: "inactive", label: "Inactive", count: inactive },
              ]}
            />
          ) : null}
          <span className="text-xs text-muted-foreground">A user&apos;s page has its bindings and tokens, a new password, a rename and the delete.</span>
          <div className="ml-auto">
            <CreateUserDialog />
          </div>
        </div>
      ) : null}
      {users.isError ? (
        <ErrorState error={users.error} />
      ) : !shown ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState icon={<UserX />} title="No inactive users" className="py-8">
          Every enabled user has authenticated within the server&apos;s bound, or the server disables nobody for inactivity.
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Kind</TH>
              <TH>Bindings</TH>
              <TH>Created</TH>
              <TH>Last seen</TH>
              <TH>Status</TH>
              {admin ? <TH className="w-0" /> : null}
            </TR>
          </THead>
          <TBody>
            {shown.map((u) => {
              const own = bindings.data?.filter((b) => b.principal === `user:${u.uid}`) ?? [];
              const groupAdmin = bindings.data?.some((b) => b.role === "admin" && u.groups?.some((g) => b.principal === `group:${g}`)) ?? false;
              const change = changes.get(u.uid);
              const self = who.data?.uid === u.uid;
              return (
                <TR key={u.uid} className={cn(u.disabled && "opacity-60")}>
                  <TD>
                    <Tooltip content={`user:${u.uid}`}>
                      <Link to="/access/users/$user" params={{ user: u.name }} className="flex w-fit items-center gap-2 font-medium hover:underline">
                        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs uppercase">{u.name[0]}</span>
                        {u.name}
                        {own.some((b) => b.role === "admin") || groupAdmin ? <Badge tone="warning">admin</Badge> : null}
                      </Link>
                    </Tooltip>
                    {change?.error ? (
                      <div className="mt-0.5 max-w-sm text-xs text-danger">
                        Not {u.disabled ? "enabled" : "disabled"}. {errorText(change.error)}
                      </div>
                    ) : null}
                  </TD>
                  <TD className="text-muted-foreground">
                    {u.kind === "oidc" ? (
                      <Tooltip content="Made by its first OIDC login; the groups of its latest login">
                        <span className="block w-fit">
                          <Badge tone="primary">OIDC</Badge>
                          {u.groups?.length ? <span className="mt-1 block font-mono text-xs">{u.groups.map((g) => `group:${g}`).join(" ")}</span> : null}
                        </span>
                      </Tooltip>
                    ) : (
                      u.kind
                    )}
                  </TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {own.map((b) => (
                        <Badge key={b.id} tone={roleTone[b.role]} shape="square" className="font-mono">
                          {b.role} {b.repoMask}
                        </Badge>
                      ))}
                      {bindings.data
                        ?.filter((b) => u.groups?.some((g) => b.principal === `group:${g}`))
                        .map((b) => (
                          <Tooltip key={b.id} content={`Through ${b.principal}`}>
                            <Badge tone="outline" shape="square" className="border-dashed font-mono">
                              {b.role} {b.repoMask}
                            </Badge>
                          </Tooltip>
                        ))}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground">
                    <RelativeTime iso={u.createdAt} />
                  </TD>
                  <TD className="text-muted-foreground">
                    <LastSeen user={u} />
                  </TD>
                  <TD>
                    <UserStatus user={u} />
                  </TD>
                  {admin ? (
                    <TD className="text-right">
                      {self ? null : (
                        <Button size="sm" variant="ghost" disabled={change?.pending} onClick={() => disable.mutate({ user: u, disabled: !u.disabled })}>
                          {u.disabled ? "Enable" : "Disable"}
                        </Button>
                      )}
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function TokensTable() {
  const tokens = useQuery(tokensQuery);
  return (
    <Card>
      {tokens.isError ? (
        <ErrorState error={tokens.error} />
      ) : !tokens.data ? (
        <Loading />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Kind</TH>
              <TH>Acts as / bound to</TH>
              <TH>Scopes</TH>
              <TH>Last used</TH>
              <TH>Expires</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {tokens.data.map((t) => (
              <TR key={t.id} className={cn(t.revokedAt && "opacity-60")}>
                <TD className="font-medium">{t.name}</TD>
                <TD>
                  <Tooltip
                    content={
                      t.kind === "pat"
                        ? "Personal access token: acts as its user, optionally narrowed by scopes; expiry is mandatory (90 days by default, at most a year)"
                        : "Deploy token: a principal of its own (token:<id>), bound to one repo or a mask of repos, never delete or manage"
                    }
                  >
                    <Badge tone={t.kind === "pat" ? "primary" : "neutral"} shape="square">
                      {t.kind === "pat" ? "PAT" : "deploy"}
                    </Badge>
                  </Tooltip>
                </TD>
                <TD className="font-mono text-xs">{t.kind === "pat" ? `user:${t.user}` : `token:${t.id} → ${t.repo ?? t.repoMask}`}</TD>
                <TD>
                  {t.scopes.length ? (
                    <span className="flex gap-1">
                      {t.scopes.map((s) => (
                        <Badge key={s} tone="outline">
                          {s}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">all of the user's rights</span>
                  )}
                </TD>
                <TD className="text-muted-foreground">
                  <RelativeTime iso={t.lastUsedAt} />
                </TD>
                <TD className="text-muted-foreground">{t.expiresAt ? <RelativeTime iso={t.expiresAt} /> : "never"}</TD>
                <TD>
                  <TokenStatus token={t} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function BindingsTable() {
  const bindings = useQuery(bindingsQuery);
  const repos = useQuery(reposQuery);
  // The admin's controls: a new binding (realistic), and a delete on each row (optimistic).
  const who = useQuery(callerQuery);
  const admin = who.data?.admin === true;
  const remove = useDeleteBinding();
  const changes = useChanges(deleteBindingKey, bindingId);
  return (
    <Card>
      {admin ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">A user or an OIDC group, a role, and the repos of a mask; a principal has the union of its bindings.</span>
          <div className="ml-auto">
            <CreateBindingDialog />
          </div>
        </div>
      ) : null}
      {bindings.isError ? (
        <ErrorState error={bindings.error} />
      ) : !bindings.data ? (
        <Loading />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Principal</TH>
              <TH>Role</TH>
              <TH>Repo mask</TH>
              <TH>Matches</TH>
              <TH>Created</TH>
              {admin ? <TH className="w-0" /> : null}
            </TR>
          </THead>
          <TBody>
            {bindings.data.map((b) => {
              const matched = b.role === "admin" ? (repos.data ?? []) : (repos.data ?? []).filter((r) => maskMatches(b.repoMask, r.prefix));
              const change = changes.get(b.id);
              return (
                <TR key={b.id}>
                  <TD>
                    {b.name ? (
                      <Link to="/access/users/$user" params={{ user: b.name }} className="hover:underline">
                        <Principal value={b.principal} name={b.name} />
                      </Link>
                    ) : (
                      <Principal value={b.principal} name={b.name} />
                    )}
                    {change?.error ? <div className="mt-0.5 max-w-sm text-xs text-danger">Not deleted. {errorText(change.error)}</div> : null}
                  </TD>
                  <TD>
                    <Tooltip content={roleActions[b.role]}>
                      <Badge tone={roleTone[b.role]}>{b.role}</Badge>
                    </Tooltip>
                  </TD>
                  <TD className="font-mono text-xs">{b.repoMask}</TD>
                  <TD>
                    <Tooltip content={matched.map((r) => r.prefix).join(", ") || "no repository yet"}>
                      <span className="text-xs text-muted-foreground">
                        {b.role === "admin" ? "every repo (mask ignored)" : `${matched.length} repo${matched.length === 1 ? "" : "s"}`}
                      </span>
                    </Tooltip>
                  </TD>
                  <TD className="text-muted-foreground">
                    <RelativeTime iso={b.createdAt} />
                  </TD>
                  {admin ? (
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" disabled={change?.pending} onClick={() => remove.mutate(b)}>
                        Delete
                      </Button>
                    </TD>
                  ) : null}
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
