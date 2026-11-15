import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { useState } from "react";

import { optimistic, update, useChanges } from "@/api/change";
import { createMaskToken, revokeMaskToken } from "@/api/mutations";
import { callerQuery, maskTokensQuery } from "@/api/queries";
import type { Token } from "@/api/types";
import { ErrorState } from "@/components/common";
import { CreateTokenDialog, RevokeTokenDialog, TokenTable } from "@/components/tokens";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { revoked } from "@/lib/tokens";

const tokenId = (t: Token) => t.id;

/** The deploy tokens over a mask of repos (docs/api.md): the admin lists, creates and revokes
 * them; ?mask= shows those over one mask, as it was written. */
export function MaskTokens() {
  const search = useSearch({ strict: false }) as { tab?: string; mask?: string };
  const navigate = useNavigate();
  const mask = search.mask ?? "";
  const who = useQuery(callerQuery);
  const tokens = useQuery(maskTokensQuery(mask));
  const [revoking, setRevoking] = useState<Token | null>(null);
  // Every list of mask tokens: a new token joins the whole one, and maybe the filtered one.
  const all = ["deploy-tokens"];
  const key = maskTokensQuery(mask).queryKey;

  // Optimistic: the row is revoked at once (docs/adr/0003-changes-realistic-by-default.md).
  const revoke = useMutation({
    mutationKey: ["revoke", ...key],
    mutationFn: (t: Token) => revokeMaskToken(t.id),
    ...optimistic({ updates: (t: Token) => [update(key, (list: Token[]) => revoked(list, t))], describe: (t) => `Revoke ${t.name}` }),
  });
  const changes = useChanges(["revoke", ...key], tokenId);
  const list = [...(tokens.data ?? [])].sort((a, b) => b.id - a.id);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <Input
          key={mask}
          aria-label="Mask"
          className="w-56 font-mono"
          placeholder="Every mask"
          spellCheck={false}
          defaultValue={mask}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const v = e.currentTarget.value.trim();
            void navigate({ to: "/access", search: { tab: "masks", mask: v || undefined }, replace: true });
          }}
        />
        <span className="text-xs text-muted-foreground">A mask as it was written: oci/* does not list a token over */*.</span>
        {who.data?.admin && who.data.name ? (
          <div className="ml-auto">
            <CreateTokenDialog
              kind="deploy"
              mask
              login="deploy"
              create={(req, over) => createMaskToken({ ...req, repoMask: over!.repoMask, scopes: req.scopes ?? [] }, who.data!.name!, over!.password)}
              list={all}
            />
          </div>
        ) : null}
      </div>
      {tokens.isError ? (
        <ErrorState error={tokens.error} onRetry={() => void tokens.refetch()} />
      ) : tokens.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={<KeyRound />} title={mask ? `No tokens over ${mask}` : "No deploy tokens over a mask"} className="py-6">
          A token over a mask reaches every repo the mask matches, those created later too: for a job that reads or publishes across repos.
        </EmptyState>
      ) : (
        <TokenTable tokens={list} onRevoke={who.data?.admin ? setRevoking : undefined} changes={changes} />
      )}
      <RevokeTokenDialog token={revoking} onConfirm={(t) => revoke.mutate(t)} onClose={() => setRevoking(null)} />
    </Card>
  );
}
