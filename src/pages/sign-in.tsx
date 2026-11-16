import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { FlaskConical, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";

import {
  lifetimeText,
  oidcSignInUrl,
  redeemOidcCode,
  SESSION_LIFETIME,
  SignInError,
  signInModes,
  signInWithPassword,
  signInWithToken,
} from "@/api/auth";
import { takeOidcCallback } from "@/api/oidc";
import { infoQuery } from "@/api/queries";
import { config } from "@/app/config";
import { demoMode, demoUsers, enterDemo } from "@/app/demo";
import { useSession } from "@/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { safeRedirect } from "@/lib/redirect";

type Search = { method?: string; redirect?: string };
type Method = "password" | "token";

/** The code the server's OIDC login handed back to this page (#code=…), taken once. */
function oidcCallback() {
  try {
    return takeOidcCallback();
  } catch {
    // No session storage: the verifier is not there either.
    return null;
  }
}

function message(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof SignInError) return err.message;
  return err instanceof Error ? err.message : "Sign-in failed.";
}

export function SignInPage() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const session = useSession();
  // What the server offers (info.authModes); a server that does not say keeps both forms.
  const info = useQuery(infoQuery);
  const modes = signInModes(info.data);
  const forms = (["password", "token"] as const).filter((m) => modes[m]);
  const method: Method | null = forms.find((m) => m === search.method) ?? forms[0] ?? null;
  const lifetime = info.data?.login ? lifetimeText(info.data.login.tokenLifetime) : SESSION_LIFETIME.replace("h", " hours");
  const ids = { user: useId(), password: useId(), token: useId() };
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");

  const signedIn = () => void navigate({ to: safeRedirect(search.redirect), replace: true });
  const signIn = useMutation({
    mutationFn: () => (method === "token" ? signInWithToken(token) : signInWithPassword(user, password)),
    onSuccess: () => {
      setPassword("");
      setToken("");
      signedIn();
    },
  });

  // Single sign-on: to the server's OIDC login, which sends the person back here with a code.
  const sso = useMutation({
    mutationFn: async () => window.location.assign(await oidcSignInUrl(search.redirect)),
  });
  const redeem = useMutation({
    mutationFn: ({ code, verifier }: { code: string; verifier: string | null }) => redeemOidcCode(code, verifier),
    onSuccess: signedIn,
  });
  const { mutate: finishSso } = redeem;
  useEffect(() => {
    const back = oidcCallback();
    if (back) finishSso(back);
  }, [finishSso]);
  const ssoBusy = sso.isPending || sso.isSuccess || redeem.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    sso.reset();
    redeem.reset();
    signIn.mutate();
  };

  // A demo account fills the form; signing in stays a click on the button.
  const fill = (name: string) => {
    signIn.reset();
    setUser(name);
    setPassword(name);
    if (method === "token") void navigate({ to: "/sign-in", search: (prev: Search) => ({ ...prev, method: forms[0] === "password" ? undefined : "password" }), replace: true });
  };

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign in to {config().branding.title}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {session ? (
          <>
            You are signed in as <span className="font-mono text-foreground">{session.user}</span>; signing in again replaces the session.
          </>
        ) : demoMode().active ? (
          "This is the demo: sign in with one of the accounts below."
        ) : (
          "Public repositories are readable without signing in."
        )}
      </p>

      <Card>
        <CardBody className="space-y-4">
          {modes.oidc ? (
            <>
              <Button
                variant={method ? "secondary" : "primary"}
                className="w-full"
                disabled={ssoBusy}
                onClick={() => {
                  signIn.reset();
                  redeem.reset();
                  sso.mutate();
                }}
              >
                <ShieldCheck />
                {ssoBusy ? "Signing in…" : "Sign in with single sign-on"}
              </Button>
              <FormError error={message(sso.error ?? redeem.error)} />
              {method ? (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
            </>
          ) : (
            <FormError error={message(redeem.error)} />
          )}

          {forms.length > 1 && method ? (
            <Segmented
              aria-label="Sign-in method"
              value={method}
              onChange={(v) => {
                signIn.reset();
                void navigate({ to: "/sign-in", search: (prev: Search) => ({ ...prev, method: v === forms[0] ? undefined : v }), replace: true });
              }}
              options={forms.map((m) => ({ value: m, label: m === "password" ? "Password" : "Access token" }))}
            />
          ) : null}

          {!method && !modes.oidc ? <p className="text-sm text-muted-foreground">This server offers no way to sign in here.</p> : null}

          {method ? (
            <form onSubmit={submit} className="space-y-4">
              {method === "password" ? (
                <>
                  <Field label="User name" htmlFor={ids.user}>
                    <Input
                      id={ids.user}
                      name="username"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Password"
                    htmlFor={ids.password}
                    hint={`Signing in creates a personal access token for this browser that lasts ${lifetime}; signing out revokes it.`}
                  >
                    <Input
                      id={ids.password}
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <Field
                  label="Personal access token"
                  htmlFor={ids.token}
                  hint="The token stays valid after you sign out here. A token with scopes can read and publish, but not manage tokens."
                >
                  <Input
                    id={ids.token}
                    name="token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ljs_pat_…"
                    autoFocus
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    className="font-mono"
                  />
                </Field>
              )}

              <FormError error={message(signIn.error)} />

              <Button type="submit" variant="primary" className="w-full" disabled={signIn.isPending || ssoBusy}>
                {method === "token" ? <KeyRound /> : <LogIn />}
                {signIn.isPending ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          ) : null}
        </CardBody>
      </Card>

      {/* A new server has no users: its first admin is made with the bootstrap token. */}
      <p className="mt-3 text-center text-xs text-muted-foreground">
        A new server without users?{" "}
        <Link to="/first-admin" search={{ redirect: search.redirect }} className="text-primary hover:underline">
          Set up the first admin
        </Link>
      </p>

      {demoMode().active ? (
        <div className="mt-4 rounded-lg border border-border px-3 py-3">
          <div className="mb-2 flex items-center gap-2 px-1 text-xs font-medium">
            <FlaskConical className="size-3.5 text-muted-foreground" />
            Demo accounts: the password is the name
          </div>
          <ul>
            {demoUsers.map((u) => (
              <li key={u.name}>
                <button
                  type="button"
                  onClick={() => fill(u.name)}
                  className="flex w-full cursor-pointer items-baseline gap-2 rounded-md px-1 py-1 text-left text-xs transition-colors hover:bg-muted"
                >
                  <span className="w-28 shrink-0 font-mono text-foreground">
                    {u.name} / {u.name}
                  </span>
                  <span className="text-muted-foreground">{u.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : demoMode().offered ? (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border px-4 py-3">
          <FlaskConical className="size-4 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Just looking around? The demo runs on generated data in your browser; nothing is sent to the server.
          </p>
          <Button size="sm" onClick={enterDemo}>
            Open the demo
          </Button>
        </div>
      ) : null}
    </div>
  );
}
