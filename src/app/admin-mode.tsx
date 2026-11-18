// The admin mode (docs/spec/rbac.md §12, auth.admin.requireMFA): an admin binding counts only for
// a web UI's sign-in through OIDC with a second factor. A caller whose admin binding the session
// does not reach (info.caller.adminNeedsMFA) is told so under the header, with the way to a
// sign-in that does: through single sign-on again, with prompt=login, back to this page.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { LogIn, ShieldAlert } from "lucide-react";

import { oidcSignInUrl, signInModes } from "@/api/auth";
import { infoQuery } from "@/api/queries";
import { Button } from "@/components/ui/button";

export function AdminModeBar() {
  const info = useQuery(infoQuery);
  const here = useRouterState({ select: (s) => s.location.href });
  const again = useMutation({ mutationFn: () => oidcSignInUrl(here, "login"), onSuccess: (url) => window.location.assign(url) });
  return (
    <div role="status" className="border-t border-warning/30 bg-warning-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm sm:px-6">
        <ShieldAlert className="size-4 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          Your admin role counts only for a sign-in through single sign-on with a second factor (auth.admin.requireMFA). This sign-in has none, so the admin
          pages are closed to it.
          {again.error ? <span className="block text-danger">Not signed in again: {again.error.message}</span> : null}
        </span>
        {signInModes(info.data).oidc ? (
          <Button size="sm" variant="primary" disabled={again.isPending || again.isSuccess} onClick={() => again.mutate()}>
            <LogIn />
            {again.isPending || again.isSuccess ? "Going to sign in…" : "Sign in with a second factor"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
