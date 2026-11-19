import { useQuery } from "@tanstack/react-query";
import { Hourglass, KeyRound, Link2, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";

import { bindingWaits } from "@/api/approvals";
import { signInModes } from "@/api/auth";
import { bindingsQuery, infoQuery, reposQuery, usersQuery } from "@/api/queries";
import type { User } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";
import { pluralize } from "@/lib/format";
import { maskMatches, maskSuggestions, parseMask } from "@/lib/masks";
import { roleActions, roles, type Role } from "@/lib/roles";

import { useCreateBinding, useCreateUser, useDeleteUser, useRenameUser, useSetPassword } from "./user-changes";

const NAME_RULE = "1 to 64 lowercase letters, digits, '.', '_' and '-', starting with a letter or a digit; unique among the users.";
// The rules of auth.passwords at their defaults; a server that asks for more says which rule a
// password breaks (docs/spec/rbac.md §1, Local passwords).
const PASSWORD_RULE = "At least 8 characters, or more if the server asks (auth.passwords.minLength); at most 1024 bytes.";

/** Creates a local user with a password, and the admin role if asked; realistic. */
export function CreateUserDialog() {
  const ids = { name: useId(), password: useId(), admin: useId() };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [admin, setAdmin] = useState(false);
  const info = useQuery(infoQuery);
  const create = useCreateUser();
  const ready = name.trim() !== "" && password !== "";
  const secondAdmin = info.data?.approval === "second-admin";

  const reset = () => {
    setName("");
    setPassword("");
    setAdmin(false);
    create.reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) create.mutate({ name: name.trim(), password, ...(admin && !secondAdmin ? { admin: true } : {}) });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (create.isPending) return;
        setOpen(o);
        if (!o) reset();
      }}
    >
      {signInModes(info.data).password ? (
        <Button variant="primary" onClick={() => setOpen(true)}>
          <UserPlus />
          New user
        </Button>
      ) : (
        // Local passwords are off: a person's account is made by its first login at the IdP.
        <Tooltip content="Local passwords are off on this server (auth.localPasswords: false): a person signs in through the identity provider, whose first login makes the account.">
          <span>
            <Button variant="primary" disabled>
              <UserPlus />
              New user
            </Button>
          </span>
        </Tooltip>
      )}
      <DialogContent
        title="New user"
        description={
          <>
            A local user signs in with its name and password, and makes personal access tokens for its clients.
            {info.data?.authModes.includes("oidc") ? " A user of the OIDC login is made by its first login; it needs no account here." : null}
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Name" htmlFor={ids.name} hint={NAME_RULE}>
            <Input id={ids.name} value={name} maxLength={64} autoFocus spellCheck={false} autoComplete="off" placeholder="frank" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field
            label="Password"
            htmlFor={ids.password}
            hint={`${PASSWORD_RULE} Hand it over out of band. The user changes it from the user menu, at the first sign-in if the server asks (auth.passwords.changeAtFirstUse).`}
          >
            <Input id={ids.password} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {secondAdmin ? (
            // With auth.approval second-admin the server makes no admin here: the binding waits
            // for a second admin (docs/spec/rbac.md §13).
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Hourglass className="mt-0.5 size-3.5 shrink-0" />
              To make the user an admin, bind it to the admin role on its page once it is made: the binding waits for another admin (auth.approval).
            </p>
          ) : (
            <label htmlFor={ids.admin} className="flex items-start gap-2 text-sm">
              <input id={ids.admin} type="checkbox" className="mt-0.5 size-4 accent-primary" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />
              <span>
                Admin: bind the user to the admin role on <span className="font-mono">*/*</span> in the same step. Every repo, plus users, bindings,
                registries and the audit log.
              </span>
            </label>
          )}
          <FormError error={errorText(create.error)} />
          <DialogActions>
            <DialogClose asChild>
              <Button type="button" disabled={create.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
              <UserPlus />
              {create.isPending ? "Creating…" : "Create user"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type UserDialogProps = { user: User; onClose: () => void };

/** Sets a user's password, typed twice; realistic. */
export function SetPasswordDialog({ user, onClose }: UserDialogProps) {
  const ids = { password: useId(), again: useId() };
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const set = useSetPassword(user);
  const differ = again !== "" && again !== password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password && !differ) set.mutate(password, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !set.isPending && onClose()}>
      <DialogContent
        title={`Set the password of ${user.name}`}
        description={
          user.kind === "oidc"
            ? "An OIDC user signs in at the identity provider; a password lets it sign in here with its name too."
            : "The old password fails from the next request on, and a lock of the password ends. The user's tokens stay valid; revoke them below if the password leaked. With auth.passwords.changeAtFirstUse the user chooses a new one at the next sign-in."
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password" htmlFor={ids.password} hint={PASSWORD_RULE}>
            <Input id={ids.password} type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Again" htmlFor={ids.again} hint={differ ? <span className="text-danger">The two differ.</span> : undefined}>
            <Input id={ids.again} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <FormError error={errorText(set.error)} />
          <DialogActions>
            <Button type="button" disabled={set.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!password || again !== password || set.isPending}>
              <KeyRound />
              {set.isPending ? "Setting…" : "Set password"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Renames a user; realistic, since the server checks the name. */
export function RenameUserDialog({ user, onClose }: UserDialogProps) {
  const id = useId();
  const [name, setName] = useState(user.name);
  const rename = useRenameUser(user);
  const next = name.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next && next !== user.name) rename.mutate(next, { onSuccess: onClose });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !rename.isPending && onClose()}>
      <DialogContent
        title={`Rename ${user.name}`}
        description="The uid stays, and with it the user's bindings and tokens. Clients that send the old name with a password or a token fail; the audit log keeps the name of each event's time."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="New name" htmlFor={id} hint={NAME_RULE}>
            <Input id={id} value={name} maxLength={64} autoFocus spellCheck={false} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </Field>
          <FormError error={errorText(rename.error)} />
          <DialogActions>
            <Button type="button" disabled={rename.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!next || next === user.name || rename.isPending}>
              <Pencil />
              {rename.isPending ? "Renaming…" : "Rename"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DeleteUserDialogProps = UserDialogProps & {
  /** The user's live tokens and its own bindings, when they are loaded. */
  tokens: number | undefined;
  bindings: number | undefined;
};

/** Names what a delete takes, then waits for the server (realistic): it is not undone. */
export function DeleteUserDialog({ user, tokens, bindings, onClose }: DeleteUserDialogProps) {
  const del = useDeleteUser(user);
  const what = [
    tokens === undefined ? "its tokens are revoked" : tokens ? `its ${pluralize(tokens, "live token")} ${tokens === 1 ? "is" : "are"} revoked` : null,
    bindings === undefined ? "its bindings deleted" : bindings ? `its ${pluralize(bindings, "binding")} deleted` : null,
  ].filter(Boolean);
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={`Delete ${user.name}?`}>
        <div className="space-y-3 text-sm">
          <p>
            {user.name} can no longer sign in{what.length ? `, ${what.join(" and ")}` : ""}. The audit log keeps naming the user, and the name is free
            at once: a new user of it is another one and inherits nothing. This cannot be undone.
          </p>
          {!user.disabled ? (
            <p className="text-muted-foreground">Disabling keeps a person out too, and is undone by enabling the user.</p>
          ) : null}
          <FormError error={errorText(del.error)} />
        </div>
        <DialogActions>
          <Button disabled={del.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={del.isPending} onClick={() => del.mutate()}>
            <Trash2 />
            {del.isPending ? "Deleting…" : "Delete user"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

type CreateBindingDialogProps = {
  /** The user, when the dialog is on its page: the binding names it by its uid. */
  user?: User;
};

/** Binds a user or a group to a role on a mask of repos; the form suggests users, groups and
 * masks, and shows which repos the mask matches. Realistic: the server checks the principal. */
export function CreateBindingDialog({ user }: CreateBindingDialogProps) {
  const ids = { principal: useId(), principals: useId(), mask: useId(), masks: useId() };
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [role, setRole] = useState<Role>("reader");
  const [mask, setMask] = useState("");
  const create = useCreateBinding();
  const info = useQuery(infoQuery);
  const fixed = user ? `user:${user.uid}` : undefined;
  const principal = fixed ?? typed;
  const users = useQuery({ ...usersQuery, enabled: open && !fixed });
  const bindings = useQuery({ ...bindingsQuery, enabled: open && !fixed });
  const repos = useQuery({ ...reposQuery, enabled: open });

  const principals = useMemo(() => {
    const groups = new Set<string>();
    for (const b of bindings.data ?? []) if (b.principal.startsWith("group:")) groups.add(b.principal);
    for (const u of users.data ?? []) for (const g of u.groups ?? []) groups.add(`group:${g}`);
    return [...(users.data ?? []).map((u) => `user:${u.name}`), ...[...groups].sort()];
  }, [users.data, bindings.data]);
  const prefixes = useMemo(() => (repos.data ?? []).map((r) => r.prefix), [repos.data]);
  const masks = useMemo(() => maskSuggestions(prefixes), [prefixes]);

  const repoMask = role === "admin" ? "*/*" : mask.trim();
  const valid = parseMask(repoMask) !== null;
  const matched = valid ? prefixes.filter((p) => maskMatches(repoMask, p)) : [];
  const ready = principal.trim() !== "" && valid;
  const waits = info.data?.approval === "second-admin" && bindingWaits(role, repoMask);

  const reset = () => {
    setTyped("");
    setRole("reader");
    setMask("");
    create.reset();
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) create.mutate({ principal: principal.trim(), role, repoMask }, { onSuccess: close });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : !create.isPending && close())}>
      <Button variant={fixed ? "secondary" : "primary"} size={fixed ? "sm" : "md"} onClick={() => setOpen(true)}>
        <Plus />
        {fixed ? "Add binding" : "New binding"}
      </Button>
      <DialogContent
        title={user ? `Bind ${user.name} to a role` : "New binding"}
        description="A role on every repo a mask matches, those created later too. A principal's rights are the union of its bindings; the change counts from the next request on."
      >
        <form onSubmit={submit} className="space-y-4">
          {fixed ? null : (
            <Field
              label="Principal"
              htmlFor={ids.principal}
              hint="user:<name>, or group:<name> for the members of an OIDC group, who get it while their latest login names the group. A group need not have members yet."
            >
              <Input
                id={ids.principal}
                list={ids.principals}
                value={principal}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="user:alice"
                className="font-mono"
                onChange={(e) => setTyped(e.target.value)}
              />
              <datalist id={ids.principals}>
                {principals.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
          )}
          <Field label="Role" hint={role === "admin" ? "Every repo, plus users, bindings, registries and the audit log: the mask is */*." : `May ${roleActions[role]}.`}>
            <Segmented aria-label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: r }))} />
          </Field>
          <Field label="Repo mask" htmlFor={ids.mask} hint="<format>/<repo>, each a name or * for any: raw/*, */payments, pypi/internal. The repo need not exist yet.">
            <Input
              id={ids.mask}
              list={ids.masks}
              value={role === "admin" ? "*/*" : mask}
              disabled={role === "admin"}
              autoFocus={!!fixed}
              spellCheck={false}
              autoComplete="off"
              placeholder="raw/*"
              className="font-mono"
              onChange={(e) => setMask(e.target.value)}
            />
            <datalist id={ids.masks}>
              {masks.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          {valid ? <MaskMatches mask={repoMask} matched={matched} loading={repos.isPending} /> : null}
          {waits ? (
            <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs">
              <Hourglass className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {role === "admin" ? "An admin binding" : "A binding on */*"} waits for another admin (auth.approval): it is a request until an admin other than
              you approves it.
            </p>
          ) : null}
          <FormError error={errorText(create.error)} />
          <DialogActions>
            <Button type="button" disabled={create.isPending} onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
              {waits ? <Hourglass /> : <Link2 />}
              {create.isPending ? "Binding…" : waits ? "Ask for approval" : "Create binding"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SHOWN = 12;

/** The repos a mask matches now, of those the admin reads: every repo. */
function MaskMatches({ mask, matched, loading }: { mask: string; matched: string[]; loading: boolean }) {
  if (loading) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs" aria-live="polite">
      <p className="text-muted-foreground">
        {matched.length
          ? `${mask} matches ${pluralize(matched.length, "repo")} now:`
          : `${mask} matches no repo yet; the binding counts for one the mask matches once it is created.`}
      </p>
      {matched.length ? (
        <p className="mt-1.5 flex flex-wrap gap-1">
          {matched.slice(0, SHOWN).map((p) => (
            <Badge key={p} tone="outline" shape="square" className="font-mono">
              {p}
            </Badge>
          ))}
          {matched.length > SHOWN ? <span className="text-muted-foreground">and {matched.length - SHOWN} more</span> : null}
        </p>
      ) : null}
    </div>
  );
}
