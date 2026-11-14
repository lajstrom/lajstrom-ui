import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Info } from "lucide-react";

import { bindingsQuery, reposQuery, tokensQuery, usersQuery } from "@/api/queries";
import type { Binding } from "@/api/types";
import { ErrorState, PageHeader, Principal, RelativeTime } from "@/components/common";
import { TokenStatus } from "@/components/tokens";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

type Tab = "users" | "tokens" | "bindings";

const roleTone: Record<Binding["role"], "primary" | "success" | "warning" | "neutral"> = {
  admin: "warning",
  maintainer: "primary",
  writer: "success",
  reader: "neutral",
};

const roleActions: Record<Binding["role"], string> = {
  reader: "read",
  writer: "read, write",
  maintainer: "read, write, delete, manage",
  admin: "everything, plus system and audit",
};

export function AccessPage() {
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const tab = search.tab ?? "users";

  return (
    <>
      <PageHeader
        title="Access"
        description="Who can do what: users, their tokens, and role bindings on repo masks (docs/spec/rbac.md)."
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft px-4 py-3 text-sm text-primary-soft-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <span>
          Read-only preview: users and bindings are managed with the lajstrom admin commands for now. Your own tokens are under
          Personal access tokens in the user menu.
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
          { value: "bindings", label: "Bindings" },
        ]}
      />
      {tab === "users" ? <UsersTable /> : tab === "tokens" ? <TokensTable /> : <BindingsTable />}
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
  return (
    <Card>
      {users.isError ? (
        <ErrorState error={users.error} />
      ) : !users.data ? (
        <Loading />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>User</TH>
              <TH>Kind</TH>
              <TH>Bindings</TH>
              <TH>Created</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {users.data.map((u) => {
              const own = bindings.data?.filter((b) => b.principal === `user:${u.uid}`) ?? [];
              return (
                <TR key={u.uid} className={cn(u.disabled && "opacity-60")}>
                  <TD>
                    <Tooltip content={`user:${u.uid}`}>
                      <span className="flex items-center gap-2 font-medium">
                        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs uppercase">{u.name[0]}</span>
                        {u.name}
                        {own.some((b) => b.role === "admin") ? <Badge tone="warning">admin</Badge> : null}
                      </span>
                    </Tooltip>
                  </TD>
                  <TD className="text-muted-foreground">{u.kind}</TD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {own.map((b) => (
                        <Badge key={b.id} tone={roleTone[b.role]} shape="square" className="font-mono">
                          {b.role} {b.repoMask}
                        </Badge>
                      ))}
                    </span>
                  </TD>
                  <TD className="text-muted-foreground">
                    <RelativeTime iso={u.createdAt} />
                  </TD>
                  <TD>{u.disabled ? <Badge tone="danger">disabled</Badge> : <Badge tone="success">active</Badge>}</TD>
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
                        : "Deploy token: a principal of its own (token:<id>), bound to one repo, never delete or manage"
                    }
                  >
                    <Badge tone={t.kind === "pat" ? "primary" : "neutral"} shape="square">
                      {t.kind === "pat" ? "PAT" : "deploy"}
                    </Badge>
                  </Tooltip>
                </TD>
                <TD className="font-mono text-xs">{t.kind === "pat" ? `user:${t.user}` : `token:${t.id} → ${t.repo}`}</TD>
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

function maskMatches(mask: string, repoKey: string) {
  const [mf, mr] = mask.split("/");
  const [f, r] = repoKey.split("/");
  return (mf === "*" || mf === f) && (mr === "*" || mr === r);
}

function BindingsTable() {
  const bindings = useQuery(bindingsQuery);
  const repos = useQuery(reposQuery);
  return (
    <Card>
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
            </TR>
          </THead>
          <TBody>
            {bindings.data.map((b) => {
              const matched = b.role === "admin" ? (repos.data ?? []) : (repos.data ?? []).filter((r) => maskMatches(b.repoMask, r.prefix));
              return (
                <TR key={b.id}>
                  <TD>
                    <Principal value={b.principal} name={b.name} />
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
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
