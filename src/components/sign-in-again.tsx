import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { LogIn } from "lucide-react";

import { oidcSignInUrl, signInModes } from "@/api/auth";
import { infoQuery } from "@/api/queries";

import { FormError } from "./ui/field";
import { Button } from "./ui/button";

/**
 * A step that the server takes only with a fresh sign-in through OIDC, which the session's is
 * not (docs/spec/rbac.md §10, Asking for more; §12): what it says, and "Sign in again", which
 * leaves for the identity provider with prompt=login and comes back to this page, where the
 * person makes the change once more within 10 minutes.
 */
export function SignInAgain({ error, what }: { error: Error; what: string }) {
  const info = useQuery(infoQuery);
  const here = useRouterState({ select: (s) => s.location.href });
  const again = useMutation({ mutationFn: () => oidcSignInUrl(here, "login"), onSuccess: (url) => window.location.assign(url) });
  return (
    <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm">
      <p>{what} takes a sign-in of the last 10 minutes: sign in again at your identity provider, then do it once more.</p>
      <p className="font-mono text-xs break-words text-muted-foreground">{error.message}</p>
      {signInModes(info.data).oidc ? (
        <Button size="sm" variant="primary" type="button" disabled={again.isPending || again.isSuccess} onClick={() => again.mutate()}>
          <LogIn />
          {again.isPending || again.isSuccess ? "Going to sign in…" : "Sign in again"}
        </Button>
      ) : null}
      <FormError error={again.error ? `Not signed in again: ${again.error.message}` : null} />
    </div>
  );
}
