import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FlaskConical, KeyRound, LogIn } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { SESSION_LIFETIME, SignInError, signInWithPassword, signInWithToken } from "@/api/auth";
import { config } from "@/app/config";
import { demoMode, enterDemo } from "@/app/demo";
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

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Sign in to {config().title}</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        {session ? (
          <>
            You are signed in as <span className="font-mono text-foreground">{session.user}</span>; signing in again replaces the session.
          </>
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
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Demo: sign in as <span className="font-mono">admin</span> (every repo), <span className="font-mono">alice</span>,{" "}
            <span className="font-mono">bob</span> or <span className="font-mono">carol</span>, with any password.
          </span>
        </p>
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
