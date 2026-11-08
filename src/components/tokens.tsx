import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, KeyRound, Plus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import type { CreatedToken, Token, TokenRequest, TokenScope } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { tokenState } from "@/lib/tokens";

import { RelativeTime } from "./common";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { CodeBlock } from "./ui/code-block";
import { CopyButton } from "./ui/copy-button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "./ui/dialog";
import { Field, FormError } from "./ui/field";
import { Input } from "./ui/input";
import { Segmented } from "./ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "./ui/table";
import { Tooltip } from "./ui/tooltip";

/** The state of a token. A session's token lives hours, not months: it is never "expiring". */
export function TokenStatus({ token, session = false }: { token: Token; session?: boolean }) {
  const state = tokenState(token);
  if (state === "revoked") return <Badge tone="danger">revoked</Badge>;
  if (state === "expired") return <Badge tone="danger">expired</Badge>;
  if (state === "expiring" && !session) {
    return (
      <Tooltip content="Expires within a week">
        <Badge tone="warning">expires soon</Badge>
      </Tooltip>
    );
  }
  return <Badge tone="success">active</Badge>;
}

export function TokenScopes({ token }: { token: Token }) {
  if (!token.scopes.length) return <span className="text-xs text-muted-foreground">all of the user's rights</span>;
  return (
    <span className="flex gap-1">
      {token.scopes.map((s) => (
        <Badge key={s} tone="outline">
          {s}
        </Badge>
      ))}
    </span>
  );
}

function errorText(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) return err.status === 403 ? `Not allowed: ${err.message}.` : `${err.message}.`;
  return err instanceof Error ? err.message : "The request failed.";
}

type TokenTableProps = {
  tokens: Token[];
  /** The token of this browser's session, marked and revoked with a warning. */
  currentId?: number | null;
  onRevoke?: (token: Token) => void;
};

export function TokenTable({ tokens, currentId, onRevoke }: TokenTableProps) {
  // A deploy token is a principal of its own, token:<id>: what the audit log and whoami name.
  const deploy = tokens.some((t) => t.kind === "deploy");
  return (
    <Table>
      <THead>
        <TR>
          <TH>Name</TH>
          {deploy ? <TH>Principal</TH> : null}
          <TH>Scopes</TH>
          <TH>Created</TH>
          <TH>Last used</TH>
          <TH>Expires</TH>
          <TH>Status</TH>
          <TH>
            <Tooltip content="The first 8 hexadecimal characters of the sha256 of the secret, to tell tokens apart">
              <span>Hash</span>
            </Tooltip>
          </TH>
          {onRevoke ? <TH className="w-0" /> : null}
        </TR>
      </THead>
      <TBody>
        {tokens.map((t) => {
          const live = tokenState(t) === "active" || tokenState(t) === "expiring";
          return (
            <TR key={t.id} className={cn(!live && "opacity-60")}>
              <TD className="font-medium">
                {t.name}
                {t.id === currentId ? (
                  <Badge tone="primary" className="ml-2">
                    this browser
                  </Badge>
                ) : null}
              </TD>
              {deploy ? <TD className="font-mono text-xs">token:{t.id}</TD> : null}
              <TD>
                <TokenScopes token={t} />
              </TD>
              <TD className="text-muted-foreground">
                <Tooltip content={formatDateTime(t.createdAt)}>
                  <span>
                    <RelativeTime iso={t.createdAt} />
                  </span>
                </Tooltip>
              </TD>
              <TD className="text-muted-foreground">
                <RelativeTime iso={t.lastUsedAt} />
              </TD>
              <TD className="text-muted-foreground">{t.expiresAt ? <RelativeTime iso={t.expiresAt} /> : "never"}</TD>
              <TD>
                <TokenStatus token={t} session={t.id === currentId} />
              </TD>
              <TD className="font-mono text-xs text-muted-foreground">{t.hashPrefix}</TD>
              {onRevoke ? (
                <TD className="text-right">
                  {live ? (
                    <Button size="sm" variant="ghost" onClick={() => onRevoke(t)}>
                      Revoke
                    </Button>
                  ) : null}
                </TD>
              ) : null}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

type Access = "full" | "read" | "write" | "read-write";

const accessScopes: Record<Access, TokenScope[]> = { full: [], read: ["read"], write: ["write"], "read-write": ["read", "write"] };

type CreateTokenDialogProps = {
  kind: "pat" | "deploy";
  create: (req: TokenRequest) => Promise<CreatedToken>;
  /** What the secret is for, shown with it: the user name for a personal access token, `deploy`
   * for a deploy token (Basic deploy:<token>, docs/auth.md). */
  login: string;
  onCreated?: () => void;
};

/** Creates a token and shows its secret, the one time the server answers it. */
export function CreateTokenDialog({ kind, create, login, onCreated }: CreateTokenDialogProps) {
  const ids = { name: useId(), access: useId(), expiry: useId() };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<Access>(kind === "pat" ? "full" : "read-write");
  const [expiry, setExpiry] = useState(kind === "pat" ? "90d" : "never");
  const mutation = useMutation({
    mutationFn: () =>
      create({
        name: name.trim(),
        ...(accessScopes[access].length ? { scopes: accessScopes[access] } : {}),
        ...(expiry === "never" ? {} : { expiresIn: expiry }),
      }),
    onSuccess: () => onCreated?.(),
  });

  const reset = () => {
    setName("");
    setAccess(kind === "pat" ? "full" : "read-write");
    setExpiry(kind === "pat" ? "90d" : "never");
    mutation.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) mutation.mutate();
  };

  const accessOptions: { value: Access; label: string }[] =
    kind === "pat"
      ? [
          { value: "full", label: "Everything I can do" },
          { value: "read", label: "Read" },
          { value: "read-write", label: "Read and publish" },
        ]
      : [
          { value: "read", label: "Read" },
          { value: "write", label: "Publish" },
          { value: "read-write", label: "Read and publish" },
        ];
  const expiryOptions = [
    ...(kind === "deploy" ? [{ value: "never", label: "Never" }] : [{ value: "7d", label: "7 days" }]),
    { value: "30d", label: "30 days" },
    { value: "90d", label: "90 days" },
    { value: "365d", label: "1 year" },
  ];
  const created = mutation.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        {kind === "pat" ? "New token" : "New deploy token"}
      </Button>
      <DialogContent
        title={created ? "Copy the token now" : kind === "pat" ? "New personal access token" : "New deploy token"}
        description={
          created
            ? "This is the only time the server shows the secret. Store it in your password manager or your CI's secrets."
            : kind === "pat"
              ? "A token acts as you, for clients that cannot sign in: pip, apt, Maven, scripts."
              : "A deploy token is a principal of its own, bound to this repository: for CI jobs that publish or read here."
        }
      >
        {created ? (
          <SecretReveal token={created} login={login} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Name" htmlFor={ids.name} hint="1 to 64 characters, unique among your live tokens: what it is for, or where it lives.">
              <Input
                id={ids.name}
                value={name}
                maxLength={64}
                autoFocus
                placeholder={kind === "pat" ? "laptop" : "github-actions"}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Access"
              hint={
                kind === "pat"
                  ? "Scopes narrow the token below your own rights. A token with scopes cannot manage tokens."
                  : "Deploy tokens never delete or manage."
              }
            >
              <Segmented aria-label="Access" value={access} onChange={setAccess} options={accessOptions} />
            </Field>
            <Field label="Expires" hint={kind === "pat" ? "Personal access tokens always expire, at most a year ahead." : undefined}>
              <Segmented aria-label="Expires" value={expiry} onChange={setExpiry} options={expiryOptions} />
            </Field>
            <FormError error={errorText(mutation.error)} />
            <DialogActions>
              <DialogClose asChild>
                <Button type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={!name.trim() || mutation.isPending}>
                <KeyRound />
                {mutation.isPending ? "Creating…" : "Create token"}
              </Button>
            </DialogActions>
          </form>
        )}
        {created ? (
          <DialogActions>
            <DialogClose asChild>
              <Button variant="primary">Done</Button>
            </DialogClose>
          </DialogActions>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SecretReveal({ token, login }: { token: CreatedToken; login: string }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-border bg-code px-3 py-2">
        <code className="min-w-0 flex-1 font-mono text-[12.5px] break-all">{token.secret}</code>
        <CopyButton value={token.secret} label="token" size="md" />
      </div>
      <CodeBlock
        caption="shell: the commands of the Connect tabs read these"
        shell
        code={`export LAJSTROM_USER=${login}\nexport LAJSTROM_TOKEN=${token.secret}`}
      />
      <p className="text-xs text-muted-foreground">
        {token.kind === "deploy" ? (
          <>
            Clients send it as HTTP Basic, <span className="font-mono">deploy:&lt;token&gt;</span>.
          </>
        ) : (
          <>
            Clients send it as HTTP Basic with your user name, or as <span className="font-mono">Authorization: Bearer</span>.
          </>
        )}{" "}
        {token.expiresAt ? (
          <>
            It expires <RelativeTime iso={token.expiresAt} />.
          </>
        ) : (
          "It does not expire; revoke it when it is no longer needed."
        )}
      </p>
    </div>
  );
}

type RevokeTokenDialogProps = {
  token: Token | null;
  /** The token of this browser's session: revoking it signs out. */
  current?: boolean;
  revoke: (token: Token) => Promise<void>;
  onClose: () => void;
  onRevoked?: () => void;
};

/** Asks before revoking: clients using the token are refused from their next request on. */
export function RevokeTokenDialog({ token, current = false, revoke, onClose, onRevoked }: RevokeTokenDialogProps) {
  const mutation = useMutation({
    mutationFn: (t: Token) => revoke(t),
    onSuccess: () => {
      onRevoked?.();
      onClose();
    },
  });
  return (
    <Dialog
      open={token !== null}
      onOpenChange={(o) => {
        if (!o) {
          mutation.reset();
          onClose();
        }
      }}
    >
      {token ? (
        <DialogContent title={`Revoke ${token.name}?`}>
          <p className="text-sm">
            Every client that uses it is refused from its next request on, on every replica. This cannot be undone.
          </p>
          {current ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              This is the token of this browser: revoking it signs you out.
            </p>
          ) : null}
          <div className="mt-3">
            <FormError error={errorText(mutation.error)} />
          </div>
          <DialogActions>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="danger" disabled={mutation.isPending} onClick={() => mutation.mutate(token)}>
              {mutation.isPending ? "Revoking…" : "Revoke"}
            </Button>
          </DialogActions>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
