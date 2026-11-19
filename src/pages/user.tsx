import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Ban, History, KeyRound, Link2, LockOpen, MoreHorizontal, Pencil, RotateCcwKey, ShieldCheck, Trash2, UserCheck, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { optimistic, update, useChanges } from "@/api/change";
import { revokeUserToken } from "@/api/mutations";
import { signInModes } from "@/api/auth";
import { bindingsQuery, callerQuery, infoQuery, reposQuery, userQuery, userTokensQuery } from "@/api/queries";
import { setSession } from "@/api/session";
import type { Binding, Token, User } from "@/api/types";
import { useSession } from "@/app/session";
import { ErrorState, PageHeader, RelativeTime } from "@/components/common";
import { RevokeTokenDialog, TokenTable } from "@/components/tokens";
import { LastSeen, UserStatus } from "@/components/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";
import { maskMatches } from "@/lib/masks";
import { roleActions, roleTone } from "@/lib/roles";
import { revoked, tokenState } from "@/lib/tokens";

import { DeleteUserDialog, CreateBindingDialog, RenameUserDialog, SetPasswordDialog } from "./user-dialogs";
import { deleteBindingKey, disableKey, useDeleteBinding, useDisableUser, useMustChange, useUnlockUser, type DisableChange } from "./user-changes";

const live = (t: Token) => tokenState(t) === "active" || tokenState(t) === "expiring";
const tokenId = (t: Token) => t.id;
const bindingId = (b: Binding) => b.id;
const userId = (c: DisableChange) => c.user.uid;

/** A user's page (admin): who it is, its bindings and those of its groups, its personal access
 * tokens; ?tokens=all lists the revoked and expired ones too. */
export function UserPage() {
  const { user: name } = useParams({ strict: false }) as { user: string };
  const who = useQuery(callerQuery);
  const user = useQuery(userQuery(name));

  if (user.isError) {
    return (
      <>
        <PageHeader crumbs={[{ label: "Users", to: "/access" }]} title={name} />
        <Card>
          <ErrorState error={user.error} onRetry={() => void user.refetch()} />
        </Card>
      </>
    );
  }
  if (!user.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  return <UserView user={user.data} admin={who.data?.admin === true} self={who.data?.uid === user.data.uid} />;
}

type Dialog = "rename" | "password" | "delete" | null;

function UserView({ user, admin, self }: { user: User; admin: boolean; self: boolean }) {
  const bindings = useQuery(bindingsQuery);
  const tokens = useQuery(userTokensQuery(user.name));
  const disable = useDisableUser();
  const disabling = useChanges(disableKey, userId).get(user.uid);
  const unlock = useUnlockUser(user);
  const mustChange = useMustChange(user);
  // While the server takes no password (auth.localPasswords: false), none is set or asked for.
  const info = useQuery(infoQuery);
  const passwords = signInModes(info.data).password;
  const [dialog, setDialog] = useState<Dialog>(null);

  const principal = `user:${user.uid}`;
  const own = bindings.data?.filter((b) => b.principal === principal);
  // Under second-admin the API sets no password for a user who holds admin, its own binding or a
  // group's, whoever asks: an admin who knew it would approve its own requests (rbac.md §13).
  const holdsAdmin = (bindings.data ?? []).some((b) => b.role === "admin" && (b.principal === principal || (user.groups ?? []).some((g) => b.principal === `group:${g}`)));
  const noPasswordSet = info.data?.approval === "second-admin" && holdsAdmin;
  const viaGroups = bindings.data?.filter((b) => b.principal.startsWith("group:") && user.groups?.includes(b.principal.slice(6)));
  const isAdmin = [...(own ?? []), ...(viaGroups ?? [])].some((b) => b.role === "admin");

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Users", to: "/access" }]}
        icon={<span className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase">{user.name[0]}</span>}
        title={user.name}
        badges={
          <>
            {user.kind === "oidc" ? (
              <Tooltip content="Made by its first OIDC login; it signs in at the identity provider">
                <Badge tone="primary">OIDC</Badge>
              </Tooltip>
            ) : null}
            {isAdmin ? <Badge tone="warning">admin</Badge> : null}
            <UserStatus user={user} />
            {self ? <Badge tone="outline">you</Badge> : null}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              user:{user.uid}
              <CopyButton value={`user:${user.uid}`} label="principal" />
            </span>
            <span>
              Created <RelativeTime iso={user.createdAt} />
            </span>
            <span>
              Last seen <LastSeen user={user} />
            </span>
          </span>
        }
        actions={
          <>
            <Tooltip content={`The audit log of what ${user.name} did`}>
              <Button asChild variant="ghost">
                <Link to="/audit" search={{ principal: `user:${user.name}` }}>
                  <History />
                  Audit log
                </Link>
              </Button>
            </Tooltip>
            {admin && !self ? (
              <Button
                disabled={disabling?.pending}
                onClick={() => disable.mutate({ user, disabled: !user.disabled })}
              >
                {user.disabled ? <UserCheck /> : <Ban />}
                {user.disabled ? "Enable" : "Disable"}
              </Button>
            ) : null}
            {admin && user.lockedUntil ? (
              <Tooltip content="End the lock now, and the count of wrong passwords">
                <Button disabled={unlock.isPending} onClick={() => unlock.mutate()}>
                  <LockOpen />
                  {unlock.isPending ? "Unlocking…" : "Unlock"}
                </Button>
              </Tooltip>
            ) : null}
            {admin && passwords && noPasswordSet ? (
              <Tooltip
                content={`Under auth.approval second-admin the API sets no password for ${user.name}, who holds admin: ${self ? "change yours from the user menu" : "the user changes its own from the user menu"}, or the command line sets it (lajstrom admin user set-password).`}
              >
                <span>
                  <Button disabled>
                    <KeyRound />
                    Set password
                  </Button>
                </span>
              </Tooltip>
            ) : admin && passwords ? (
              <Button onClick={() => setDialog("password")}>
                <KeyRound />
                Set password
              </Button>
            ) : null}
            {admin && !self ? (
              <Menu>
                <MenuTrigger asChild>
                  <Button size="icon" aria-label="More">
                    <MoreHorizontal />
                  </Button>
                </MenuTrigger>
                <MenuContent>
                  {passwords ? (
                    <MenuItem icon={<RotateCcwKey />} disabled={mustChange.isPending} onSelect={() => mustChange.mutate(!user.mustChange)}>
                      {user.mustChange ? "Stop asking for a new password" : "Ask for a new password"}
                    </MenuItem>
                  ) : null}
                  <MenuItem icon={<Pencil />} onSelect={() => setDialog("rename")}>
                    Rename
                  </MenuItem>
                  <MenuItem icon={<Trash2 />} className="text-danger" onSelect={() => setDialog("delete")}>
                    Delete
                  </MenuItem>
                </MenuContent>
              </Menu>
            ) : null}
          </>
        }
      />

      {user.inactive ? (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          {user.name} has not authenticated for longer than the server allows (auth.disableInactiveUsersAfter): its next password, token
          or OIDC login is refused and disables it, unless it is the last enabled admin. Enabling it again then restarts its clock.
        </p>
      ) : null}
      {user.lockedUntil ? (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          10 wrong passwords in a row locked the password of {user.name}, which is refused whatever it is; the lock ends{" "}
          <RelativeTime iso={user.lockedUntil} /> (auth.lockout.duration). Its tokens and OIDC logins keep working. Unlock it once you know
          who asks, or set a new password.
        </p>
      ) : null}
      {user.mustChange ? (
        <p className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {user.name}&apos;s password works for its own change only: the next sign-in asks for a new one, and a client that sends the password
          is refused until then. Its tokens keep working.
        </p>
      ) : null}
      {disabling?.error ? (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          Not {user.disabled ? "enabled" : "disabled"}. {errorText(disabling.error)}
        </p>
      ) : null}
      {unlock.error || mustChange.error ? (
        <p role="alert" className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {unlock.error ? `Not unlocked. ${errorText(unlock.error)}` : `Not changed. ${errorText(mustChange.error)}`}
        </p>
      ) : null}
      {admin && self ? (
        <p className="mb-4 text-sm text-muted-foreground">
          This is you. Another admin disables, renames or deletes your account; your own tokens are under{" "}
          <Link to="/tokens" className="text-primary hover:underline">
            Personal access tokens
          </Link>
          .
        </p>
      ) : null}

      <div className="space-y-5">
        {user.groups?.length ? (
          <Card>
            <CardHeader
              icon={<Users />}
              title="Groups"
              description="From the user's latest OIDC login; the bindings of each count for the user until that login's token expires."
            />
            <CardBody className="flex flex-wrap gap-1.5">
              {user.groups.map((g) => (
                <Badge key={g} tone="outline" shape="square" className="font-mono">
                  group:{g}
                </Badge>
              ))}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            icon={<Link2 />}
            title="Bindings"
            description="What the user may do: the union of its roles on the repos each mask matches."
            actions={admin ? <CreateBindingDialog user={user} /> : null}
          />
          {bindings.isError ? (
            <ErrorState error={bindings.error} onRetry={() => void bindings.refetch()} />
          ) : !own || !viaGroups ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : own.length + viaGroups.length === 0 ? (
            <EmptyState icon={<ShieldCheck />} title="No bindings" className="py-8">
              The user reads the repos with anonymous read only, if the server allows it.
            </EmptyState>
          ) : (
            <UserBindings own={own} viaGroups={viaGroups} admin={admin} />
          )}
        </Card>

        <UserTokens user={user} admin={admin} self={self} />
      </div>

      {dialog === "password" ? <SetPasswordDialog user={user} onClose={() => setDialog(null)} /> : null}
      {dialog === "rename" ? <RenameUserDialog user={user} onClose={() => setDialog(null)} /> : null}
      {dialog === "delete" ? (
        <DeleteUserDialog user={user} tokens={tokens.data?.filter(live).length} bindings={own?.length} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}

/** The user's own bindings, which the admin deletes (optimistic), and those of its groups, which
 * are deleted on the Bindings tab since they are the group's. */
function UserBindings({ own, viaGroups, admin }: { own: Binding[]; viaGroups: Binding[]; admin: boolean }) {
  const repos = useQuery(reposQuery);
  const remove = useDeleteBinding();
  const changes = useChanges(deleteBindingKey, bindingId);
  const rows = [...own, ...viaGroups];
  return (
    <Table>
      <THead>
        <TR>
          <TH>Role</TH>
          <TH>Repo mask</TH>
          <TH>Matches</TH>
          {viaGroups.length ? <TH>Through</TH> : null}
          <TH>Created</TH>
          {admin ? <TH className="w-0" /> : null}
        </TR>
      </THead>
      <TBody>
        {rows.map((b) => {
          const matched = b.role === "admin" ? null : (repos.data ?? []).filter((r) => maskMatches(b.repoMask, r.prefix)).map((r) => r.prefix);
          const change = changes.get(b.id);
          const group = b.principal.startsWith("group:");
          return (
            <TR key={b.id}>
              <TD>
                <Tooltip content={roleActions[b.role]}>
                  <Badge tone={roleTone[b.role]}>{b.role}</Badge>
                </Tooltip>
                {change?.error ? <div className="mt-0.5 max-w-sm text-xs text-danger">Not deleted. {errorText(change.error)}</div> : null}
              </TD>
              <TD className="font-mono text-xs">{b.repoMask}</TD>
              <TD>
                <Tooltip content={matched ? matched.join(", ") || "no repository yet" : "every repo, and the system"}>
                  <span className="text-xs text-muted-foreground">{matched ? `${matched.length} repo${matched.length === 1 ? "" : "s"}` : "every repo"}</span>
                </Tooltip>
              </TD>
              {viaGroups.length ? <TD className="font-mono text-xs text-muted-foreground">{group ? b.principal : "—"}</TD> : null}
              <TD className="text-muted-foreground">
                <RelativeTime iso={b.createdAt} />
              </TD>
              {admin ? (
                <TD className="text-right">
                  {group ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/access" search={{ tab: "bindings" }}>
                        On Bindings
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={change?.pending} onClick={() => remove.mutate(b)}>
                      Delete
                    </Button>
                  )}
                </TD>
              ) : null}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

/** The user's personal access tokens; the admin revokes them after a confirmation (optimistic). */
function UserTokens({ user, admin, self }: { user: User; admin: boolean; self: boolean }) {
  const tokens = useQuery(userTokensQuery(user.name));
  const search = useSearch({ strict: false }) as { tokens?: string };
  const navigate = useNavigate();
  const session = useSession();
  const [revoking, setRevoking] = useState<Token | null>(null);
  const list = userTokensQuery(user.name).queryKey;
  const showAll = search.tokens === "all";
  // The session's own token, when this is the signed-in user's page.
  const currentId = self ? (session?.tokenId ?? null) : null;

  const all = useMemo(() => [...(tokens.data ?? [])].sort((a, b) => b.id - a.id), [tokens.data]);
  const shown = showAll ? all : all.filter(live);

  const revoke = useMutation({
    mutationKey: ["revoke", ...list],
    mutationFn: (t: Token) => revokeUserToken(user.uid, t.id),
    ...optimistic({ updates: (t: Token) => [update(list, (ts: Token[]) => revoked(ts, t))], describe: (t) => `Revoke ${t.name}` }),
    onSuccess: (_, t) => {
      if (t.id !== currentId) return;
      setSession(null);
      void navigate({ to: "/sign-in" });
    },
  });
  const changes = useChanges(["revoke", ...list], tokenId);

  return (
    <Card>
      <CardHeader
        icon={<KeyRound />}
        title="Personal access tokens"
        description={`Each acts as ${user.name}, narrowed by its scopes. The user creates them with its password; the admin may revoke them.`}
        actions={
          <Segmented
            aria-label="Which tokens"
            value={showAll ? "all" : "live"}
            onChange={(v) => void navigate({ to: ".", search: (p: Record<string, string>) => ({ ...p, tokens: v === "all" ? "all" : undefined }), replace: true })}
            options={[
              { value: "live", label: "Active", count: all.filter(live).length },
              { value: "all", label: "All", count: all.length },
            ]}
          />
        }
      />
      {tokens.isError ? (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : tokens.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<KeyRound />} title={all.length ? "No active tokens" : "No tokens"} className="py-8">
          {user.name} has {all.length ? "only revoked or expired tokens" : "never made a token"}.
        </EmptyState>
      ) : (
        <TokenTable tokens={shown} currentId={currentId} onRevoke={admin ? setRevoking : undefined} changes={changes} />
      )}
      <RevokeTokenDialog
        token={revoking}
        current={revoking !== null && revoking.id === currentId}
        onConfirm={(t) => revoke.mutate(t)}
        onClose={() => setRevoking(null)}
      />
    </Card>
  );
}
