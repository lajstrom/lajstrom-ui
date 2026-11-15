import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { FlaskConical, UserPlus } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { createFirstAdmin, SignInError } from "@/api/auth";
import { ApiError } from "@/api/client";
import { config } from "@/app/config";
import { DEMO_BOOTSTRAP_TOKEN, demoMode } from "@/app/demo";
import { useSession } from "@/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/errors";
import { notify } from "@/lib/notices";
import { safeRedirect } from "@/lib/redirect";

type Search = { redirect?: string };

/** A message of the server as a sentence: "The bootstrap token is refused." */
const sentence = (message: string) => `${message.charAt(0).toUpperCase()}${message.slice(1).replace(/\.$/, "")}.`;

/** What the form says about a refusal (docs/api.md, The first admin): the server's message, and
 * what its 404 and 429 mean here. */
function message(err: unknown): ReactNode {
  if (!err) return null;
  if (err instanceof SignInError) return err.message;
  if (err instanceof ApiError && err.fromServer) {
    // Once an enabled user has an admin binding, the server answers every request 404.
    if (err.status === 404) {
      return (
        <>
          This server has an admin already, and takes no bootstrap token any more.{" "}
          <Link to="/sign-in" className="font-medium underline underline-offset-2">
            Sign in
          </Link>
          , or ask an admin for an account.
        </>
      );
    }
    if (err.status === 429) {
      const wait = err.retryAfter === null ? "a minute" : `${err.retryAfter} second${err.retryAfter === 1 ? "" : "s"}`;
      return `Too many wrong bootstrap tokens from this address: try again in ${wait}.`;
    }
    // A wrong token, or the right one used or expired: the message says which.
    if (err.status === 403) return sentence(err.message);
  }
  return errorText(err);
}

export function FirstAdminPage() {
  const search = useSearch({ strict: false }) as Search;
  const navigate = useNavigate();
  const session = useSession();
  const ids = { token: useId(), name: useId(), password: useId(), repeat: useId() };
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState(false);

  // Realistic (docs/adr/0003-changes-realistic-by-default.md, create a user): the server makes the
  // user, and the UI signs in with its answer; signing in starts every query over (src/main.tsx).
  const create = useMutation({
    mutationFn: () => createFirstAdmin({ token, name, password }),
    onSuccess: (user) => {
      setToken("");
      setPassword("");
      setRepeat("");
      notify({
        tone: "success",
        title: `${user.name} is the first admin of ${config().branding.title}`,
        description: demoMode().active
          ? "The demo's bootstrap token is used: Reset data makes it valid again."
          : "The bootstrap token is used: remove auth.bootstrap.tokenFile from the server's configuration, and its file.",
      });
      void navigate({ to: safeRedirect(search.redirect), replace: true });
    },
  });

  const ready = token.trim() !== "" && name.trim() !== "" && password !== "" && repeat !== "";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const differ = password !== repeat;
    setMismatch(differ);
    if (differ) create.reset();
    else if (ready) create.mutate();
  };

  return (
    <div className="mx-auto mt-8 max-w-sm">
      <h1 className="mb-1 text-xl font-semibold tracking-tight">Set up the first admin</h1>
      <p className="mb-5 text-sm text-muted-foreground">
        A new server has no users. The bootstrap token it was started with makes the first admin, once; then you are signed in as that
        admin.
        {session ? (
          <>
            {" "}
            You are signed in as <span className="font-mono text-foreground">{session.user}</span> now.
          </>
        ) : null}
      </p>

      <Card>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <Field
              label="Bootstrap token"
              htmlFor={ids.token}
              hint="The token in the file of auth.bootstrap.tokenFile. The server takes it for 24 hours after its start, until an admin exists."
            >
              <Input
                id={ids.token}
                name="bootstrap-token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Field label="User name" htmlFor={ids.name} hint="Lowercase letters, digits, '.', '_' and '-'.">
              <Input
                id={ids.name}
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Password" htmlFor={ids.password} hint="At least 8 bytes.">
              <Input
                id={ids.password}
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setMismatch(false);
                }}
              />
            </Field>
            <Field label="Repeat the password" htmlFor={ids.repeat}>
              <Input
                id={ids.repeat}
                name="password-repeat"
                type="password"
                autoComplete="new-password"
                value={repeat}
                onChange={(e) => {
                  setRepeat(e.target.value);
                  setMismatch(false);
                }}
              />
            </Field>

            <FormError error={mismatch ? "The passwords do not match." : message(create.error)} />

            <Button type="submit" variant="primary" className="w-full" disabled={!ready || create.isPending}>
              <UserPlus />
              {create.isPending ? "Creating the admin…" : "Create the admin and sign in"}
            </Button>
          </form>
        </CardBody>
      </Card>

      {demoMode().active ? (
        <div className="mt-4 rounded-lg border border-border px-4 py-3">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
            <FlaskConical className="size-3.5 text-muted-foreground" />
            The demo's bootstrap token
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            The demo's server takes it once, as a new server would, and keeps its accounts; Reset data makes it valid again.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded bg-muted px-1.5 py-1 font-mono text-xs break-all">{DEMO_BOOTSTRAP_TOKEN}</code>
            <Button
              size="sm"
              onClick={() => {
                create.reset();
                setToken(DEMO_BOOTSTRAP_TOKEN);
              }}
            >
              Use it
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        The server has an admin?{" "}
        <Link to="/sign-in" search={{ redirect: search.redirect }} className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
