import { useMutation, useQuery, type UseMutationResult } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleCheck, FlaskConical, Info, LogIn, ShieldCheck, X } from "lucide-react";

import { signInModes } from "@/api/auth";
import type { Tagged } from "@/api/client";
import { infoQuery } from "@/api/queries";
import { keepPendingChange, needsStepUp, pendingChange, stepUpUrl, type PendingChange } from "@/api/step-up";
import type { CIPolicy } from "@/api/types";
import { demoMode } from "@/app/demo";
import { useSession } from "@/app/session";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { errorText } from "@/lib/errors";

import { NotSent, type CIChange } from "./ci-policy-changes";

/**
 * What the UI says when the server takes a change only with a fresh sign-in with a second factor
 * (src/api/step-up.ts): the server's words, and the way to it. With single sign-on, "Sign in
 * again to confirm" keeps the change in this tab, leaves for the IdP with prompt=login, and the
 * page sends the change once when the sign-in brings the person back. In the demo, which has no
 * IdP, it says what the button would do; without single sign-on, that a policy that writes is
 * the configuration's.
 */
export function StepUpNotice({ error, change, className }: { error: Error; change: CIChange; className?: string }) {
  const info = useQuery(infoQuery);
  const session = useSession();
  const here = useRouterState({ select: (s) => s.location.href });
  const demo = demoMode().active;
  const oidc = signInModes(info.data).oidc;
  // The URL is made once the change is kept; the page is left after the mutation has settled, so
  // that a change in flight does not hold the page (src/main.tsx, beforeunload).
  const leave = useMutation({
    mutationFn: (pending: PendingChange) => {
      keepPendingChange(pending);
      return stepUpUrl(pending);
    },
  });
  const signInAgain = () => {
    if (!session) return;
    leave.mutate(pendingChange({ ...change, page: here }, session, Date.now()), { onSuccess: (url) => window.location.assign(url) });
  };

  return (
    <div role="alert" className={cn("space-y-2.5 rounded-md border border-warning/30 bg-warning-soft px-3 py-3 text-sm", className)}>
      <p className="flex items-center gap-2 font-medium text-warning">
        <ShieldCheck className="size-4 shrink-0" />
        Confirm with a fresh sign-in
      </p>
      <p>
        A policy that writes is made, changed, renewed and approved only by an admin who signed in through single sign-on in the last 10 minutes, with a
        second factor.
      </p>
      <p className="font-mono text-xs break-words text-muted-foreground">{error.message}</p>
      {demo ? (
        <div className="space-y-2">
          <Button size="sm" variant="primary" disabled>
            <LogIn />
            Sign in again to confirm
          </Button>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
            The demo has no identity provider to sign in at. On a server with single sign-on, this button signs you in again there with a second
            factor, brings you back to this page, and sends the change once.
          </p>
        </div>
      ) : oidc ? (
        <div className="space-y-2">
          <Button size="sm" variant="primary" disabled={!session || leave.isPending || leave.isSuccess} onClick={signInAgain}>
            <LogIn />
            {leave.isPending || leave.isSuccess ? "Going to sign in…" : "Sign in again to confirm"}
          </Button>
          <p className="text-xs text-muted-foreground">
            You leave this page for your identity provider and come back here; the change is then sent once, as you made it.
          </p>
          <FormError error={leave.error ? `Not signed in again: ${leave.error.message}` : null} />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This server offers no sign-in through single sign-on, so a policy that writes is not made, changed, renewed or approved through the UI:
          declare it in the server&apos;s configuration, <span className="font-mono">auth.ci.policies</span>.
        </p>
      )}
    </div>
  );
}

/** The refusal of a change: the step-up when the server asks for one, the server's words else. */
export function ChangeError({ error, change }: { error: Error | null; change: CIChange }) {
  if (!error) return null;
  if (needsStepUp(error)) return <StepUpNotice error={error} change={change} />;
  return <FormError error={errorText(error)} />;
}

type ReplayProps = {
  replay: UseMutationResult<Tagged<CIPolicy>, Error, PendingChange>;
};

/** What came of the change sent again after a step-up's sign-in: done, refused, or not sent. */
export function ReplayOutcome({ replay }: ReplayProps) {
  const navigate = useNavigate();
  const change = replay.variables;
  if (!change || replay.isIdle) return null;
  const close = () => replay.reset();
  const dismiss = (
    <Button size="icon-sm" variant="ghost" aria-label="Dismiss" className="-my-1 ml-auto" onClick={close}>
      <X />
    </Button>
  );
  if (replay.isPending) {
    return (
      <div role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm">
        <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
        Signed in again: sending {lower(change.what)}…
      </div>
    );
  }
  if (replay.isSuccess) {
    const p = replay.data.data;
    return (
      <div role="status" className="mb-4 flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm">
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{change.what}: done, with your new sign-in.</p>
          {p ? (
            <p className="text-muted-foreground">
              {p.state === "pending"
                ? "It waits for another admin's approval and grants nothing until then."
                : p.renewal
                  ? "The renewal waits for another admin's approval; the policy keeps its expiry until then."
                  : null}{" "}
              <button type="button" className="cursor-pointer text-primary hover:underline" onClick={() => void navigate({ to: "/access", search: { tab: "ci", policy: p.name } })}>
                Show {p.name}
              </button>
            </p>
          ) : null}
        </div>
        {dismiss}
      </div>
    );
  }
  const err = replay.error;
  return (
    <div role="alert" className="mb-4 space-y-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-danger" />
        <p className="min-w-0">
          {err instanceof NotSent ? (
            <>
              <span className="font-medium">{change.what}: not sent.</span> {err.message} Make the change again if you still want it.
            </>
          ) : needsStepUp(err) ? (
            <span className="font-medium">{change.what}: your new sign-in does not meet the server&apos;s step either.</span>
          ) : (
            <>
              <span className="font-medium">{change.what}: refused.</span> {errorText(err)}
            </>
          )}
        </p>
        {dismiss}
      </div>
      {needsStepUp(err) ? <StepUpNotice error={err} change={change} className="bg-background" /> : null}
    </div>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
