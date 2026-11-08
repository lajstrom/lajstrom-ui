import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { createDeployToken, revokeDeployToken } from "@/api/mutations";
import { deployTokensQuery } from "@/api/queries";
import type { Repo, Token } from "@/api/types";
import { ErrorState } from "@/components/common";
import { CreateTokenDialog, RevokeTokenDialog, TokenTable } from "@/components/tokens";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";

/** The deploy tokens of a repo: list, create and revoke (docs/api.md, Tokens). */
export function DeployTokens({ repo }: { repo: Repo }) {
  const tokens = useQuery(deployTokensQuery(repo.format, repo.name));
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState<Token | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: deployTokensQuery(repo.format, repo.name).queryKey });
  const list = [...(tokens.data ?? [])].sort((a, b) => b.id - a.id);

  return (
    <Card>
      <CardHeader
        icon={<KeyRound />}
        title="Deploy tokens"
        description="Bound to this repo only, for CI: read and/or publish, never delete or manage"
        actions={
          <CreateTokenDialog
            kind="deploy"
            login="deploy"
            create={(req) => createDeployToken(repo.format, repo.name, req)}
            onCreated={refresh}
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
      ) : list.length === 0 ? (
        <EmptyState title="No deploy tokens" className="py-6">
          A CI job that publishes here gets a deploy token of its own, so that revoking it stops that job only.
        </EmptyState>
      ) : (
        <TokenTable tokens={list} onRevoke={setRevoking} />
      )}
      <RevokeTokenDialog
        token={revoking}
        revoke={(t) => revokeDeployToken(repo.format, repo.name, t.id)}
        onClose={() => setRevoking(null)}
        onRevoked={refresh}
      />
    </Card>
  );
}
