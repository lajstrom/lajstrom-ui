import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { KeyRound, LogIn } from "lucide-react";
import { useMemo, useState } from "react";

import { createUserToken, revokeUserToken } from "@/api/mutations";
import { userTokensQuery, whoamiQuery } from "@/api/queries";
import { setSession } from "@/api/session";
import type { Token } from "@/api/types";
import { useSession } from "@/app/session";
import { ErrorState, PageHeader } from "@/components/common";
import { CreateTokenDialog, RevokeTokenDialog, TokenTable } from "@/components/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { sha256Hex } from "@/lib/sha256";
import { tokenState } from "@/lib/tokens";

type Search = { all?: string };

const live = (t: Token) => tokenState(t) === "active" || tokenState(t) === "expiring";

export function TokensPage() {
  const who = useQuery(whoamiQuery);
  const session = useSession();
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<Token | null>(null);
  const user = who.data?.kind === "user" ? who.data.name : null;
  const tokens = useQuery({ ...userTokensQuery(user ?? ""), enabled: user !== null });
  const showAll = search.all === "1";

  // This browser's token: the one sign-in created, or a pasted one found by its hash prefix.
  const sessionHash = useMemo(() => (session && session.tokenId === null ? sha256Hex(session.token).slice(0, 8) : null), [session]);
  const currentId = session?.tokenId ?? tokens.data?.find((t) => t.hashPrefix === sessionHash)?.id ?? null;

  const all = useMemo(() => [...(tokens.data ?? [])].sort((a, b) => b.id - a.id), [tokens.data]);
  const shown = showAll ? all : all.filter(live);

  if (who.isPending) return <Skeleton className="h-40" />;
  if (!user) {
    return (
      <>
        <PageHeader title="Personal access tokens" />
        <Card>
          <EmptyState
            icon={<KeyRound />}
            title="Sign in to manage your tokens"
            action={
              <Button asChild variant="primary">
                <Link to="/sign-in" search={{ redirect: "/tokens" }}>
                  <LogIn />
                  Sign in
                </Link>
              </Button>
            }
          >
            Tokens belong to a user; a deploy token belongs to a repository and is managed on its Maintenance tab.
          </EmptyState>
        </Card>
      </>
    );
  }

  const refresh = () => void queryClient.invalidateQueries({ queryKey: userTokensQuery(user).queryKey });

  return (
    <>
      <PageHeader
        title="Personal access tokens"
        description={
          <>
            A token acts as <span className="font-mono text-foreground">user:{user}</span> for clients that cannot sign in. Revoked and
            expired tokens stay listed for the record.
          </>
        }
        actions={<CreateTokenDialog kind="pat" login={user} create={(req) => createUserToken(user, req)} onCreated={refresh} />}
      />

      <Card>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Segmented
            aria-label="Which tokens"
            value={showAll ? "all" : "live"}
            onChange={(v) => void navigate({ to: "/tokens", search: v === "all" ? { all: "1" } : {}, replace: true })}
            options={[
              { value: "live", label: "Active", count: all.filter(live).length },
              { value: "all", label: "All", count: all.length },
            ]}
          />
        </div>
        {tokens.isError ? (
          <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
        ) : tokens.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState icon={<KeyRound />} title={all.length ? "No active tokens" : "No tokens yet"}>
            Create one for pip, apt, Maven or a script; the Connect tab of every repository shows the commands.
          </EmptyState>
        ) : (
          <TokenTable tokens={shown} currentId={currentId} onRevoke={setRevoking} />
        )}
      </Card>

      <RevokeTokenDialog
        token={revoking}
        current={revoking !== null && revoking.id === currentId}
        revoke={(t) => revokeUserToken(user, t.id)}
        onClose={() => setRevoking(null)}
        onRevoked={() => {
          if (revoking && revoking.id === currentId) {
            setSession(null);
            void navigate({ to: "/sign-in" });
            return;
          }
          refresh();
        }}
      />
    </>
  );
}
