import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FlaskConical, KeyRound, LogIn } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { SESSION_LIFETIME, SignInError, signInWithPassword, signInWithToken } from "@/api/auth";
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

function message(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof SignInError) return err.message;
  return err instanceof Error ? err.message : "Sign-in failed.";
}

export function SignInPage() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const session = useSession();
  const method = search.method === "token" ? "token" : "password";
  const ids = { user: useId(), password: useId(), token: useId() };
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");

  const signIn = useMutation({
    mutationFn: () => (method === "token" ? signInWithToken(token) : signInWithPassword(user, password)),
    onSuccess: () => {
      setPassword("");
      setToken("");
      void navigate({ to: safeRedirect(search.redirect), replace: true });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate();
  };

  // A demo account fills the form; signing in stays a click on the button.
  const fill = (name: string) => {
    signIn.reset();
    setUser(name);
    setPassword(name);
    if (method === "token") void navigate({ to: "/sign-in", search: (prev: Search) => ({ ...prev, method: undefined }), replace: true });
  };

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign in to {config().title}</h1>
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
          <Segmented
            aria-label="Sign-in method"
            value={method}
            onChange={(v) => {
              signIn.reset();
              void navigate({ to: "/sign-in", search: (prev: Search) => ({ ...prev, method: v === "token" ? "token" : undefined }), replace: true });
            }}
            options={[
              { value: "password", label: "Password" },
              { value: "token", label: "Access token" },
            ]}
          />

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
                  hint={`Signing in creates a personal access token for this browser that lasts ${SESSION_LIFETIME.replace("h", " hours")}; signing out revokes it.`}
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

            <Button type="submit" variant="primary" className="w-full" disabled={signIn.isPending}>
              {method === "token" ? <KeyRound /> : <LogIn />}
              {signIn.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardBody>
      </Card>

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
