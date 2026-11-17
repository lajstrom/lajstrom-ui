// The idle bound of a sign-in in the app (src/api/idle.ts, #75): info.login.idleTimeout while a
// DPoP sign-in is on; a warning with a countdown two minutes before the UI's bound, and the
// sign-out at it. A sign-in that ended as idle, here, in another tab, or refused by the server,
// leads to the sign-in page, which says why, and back.

import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { LogIn, LogOut } from "lucide-react";
import { useEffect, useRef } from "react";

import { lifetimeText, signOut } from "@/api/auth";
import { apiGet, apiPath } from "@/api/client";
import { countdown, setIdleBound } from "@/api/idle";
import { infoQuery } from "@/api/queries";
import { onSessionChange, sessionEnd } from "@/api/session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { errorText } from "@/lib/errors";

import { useIdle } from "./idle";
import { useSession } from "./session";

export function IdleGuard() {
  const session = useSession();
  const info = useQuery(infoQuery);
  const seconds = session?.tokenType === "DPoP" ? (info.data?.login?.idleTimeout ?? 0) : 0;
  const idle = useIdle();
  const navigate = useNavigate();
  const here = useRouterState({ select: (s) => s.location.href });
  const where = useRef(here);
  useEffect(() => {
    where.current = here;
  }, [here]);

  useEffect(() => setIdleBound(seconds), [seconds]);

  useEffect(() => {
    if (idle.phase === "over") void signOut("idle");
  }, [idle.phase]);

  useEffect(
    () =>
      onSessionChange((s) => {
        if (s || sessionEnd()?.reason !== "idle" || where.current.startsWith("/sign-in")) return;
        void navigate({ to: "/sign-in", search: { redirect: where.current } });
      }),
    [navigate],
  );

  // Any request with the token is a use: whoami is the smallest.
  const stay = useMutation({ mutationFn: () => apiGet(apiPath("whoami")) });

  if (idle.phase !== "warning") return null;
  return (
    <Dialog open onOpenChange={(open) => !open && stay.mutate()}>
      <DialogContent
        title="Still there?"
        description={`This server signs you out after ${lifetimeText(idle.bound)} without activity.`}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <p className="text-sm">
          Signing out in <span className="font-mono tabular-nums">{countdown(idle.left)}</span>.
        </p>
        <FormError error={errorText(stay.error)} />
        <DialogActions>
          <Button variant="secondary" onClick={() => void signOut().then(() => navigate({ to: "/" }))}>
            <LogOut />
            Sign out
          </Button>
          <Button variant="primary" autoFocus disabled={stay.isPending} onClick={() => stay.mutate()}>
            <LogIn />
            Stay signed in
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
