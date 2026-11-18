// The admin's changes of users and bindings (docs/adr/0003-changes-realistic-by-default.md):
// disabling or enabling a user and deleting a binding are optimistic, with Undo in the notice;
// creating a user or a binding, renaming a user, setting a password, unlocking it and asking for
// a new one are realistic; a user's delete is confirmed, then realistic. Each change is a row of the audit log, which the notice of
// a realistic one opens.

import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { optimistic, realistic, update } from "@/api/change";
import { isApproval } from "@/api/approvals";
import { createBinding, createUser, deleteBinding, deleteUser, setUserPassword, unlockUser, updateUser } from "@/api/mutations";
import { approvalsKey, bindingsQuery, tokensQuery, userQuery, usersQuery } from "@/api/queries";
import type { Binding, BindingRequest, User, UserRequest } from "@/api/types";
import { errorText } from "@/lib/errors";
import { notify } from "@/lib/notices";

/** A binding as people read it: "alice as writer on raw/*", "admin as admin". */
export function describeBinding(b: Pick<Binding, "principal" | "name" | "role" | "repoMask">): string {
  const who = b.name ?? b.principal;
  return b.role === "admin" ? `${who} as admin` : `${who} as ${b.role} on ${b.repoMask}`;
}

/** The notice's way to the audit log, filtered to the change's action. */
function useAuditLink() {
  const navigate = useNavigate();
  return (action: string) => ({ label: "Audit log", run: () => void navigate({ to: "/audit", search: { action } }) });
}

/** A user disabled or enabled; Undo puts back what it was. */
export type DisableChange = { user: User; disabled: boolean; undo?: boolean };

export const disableKey = ["user-disabled"];

/** Disable and enable, optimistic in the user list and on the user's page. */
export function useDisableUser() {
  const mutation = useMutation({
    mutationKey: disableKey,
    mutationFn: (c: DisableChange) => updateUser(c.user.uid, { disabled: c.disabled }),
    ...optimistic({
      updates: (c: DisableChange) => [
        update(usersQuery.queryKey, (users: User[]) => users.map((u) => (u.uid === c.user.uid ? { ...u, disabled: c.disabled } : u))),
        update(userQuery(c.user.name).queryKey, (u: User) => ({ ...u, disabled: c.disabled })),
      ],
      describe: (c) => `${c.disabled ? "Disable" : "Enable"} ${c.user.name}`,
    }),
    onSuccess: (_, c) => {
      notify({
        tone: "success",
        title: `${c.disabled ? "Disabled" : "Enabled"} ${c.user.name}`,
        description: c.disabled ? "Its password and its tokens are refused from the next request on." : null,
        action: c.undo ? undefined : { label: "Undo", run: () => mutation.mutate({ user: c.user, disabled: !c.disabled, undo: true }) },
      });
    },
  });
  return mutation;
}

/** Creates a user, then opens its page, where its bindings are made. */
export function useCreateUser() {
  const navigate = useNavigate();
  const audit = useAuditLink();
  // An admin user has its binding too.
  const { onSuccess: refetch } = realistic(usersQuery.queryKey, bindingsQuery.queryKey);
  return useMutation({
    mutationFn: (req: UserRequest) => createUser(req),
    onSuccess: async (user, req, result, context) => {
      await refetch(user, req, result, context);
      notify({ tone: "success", title: `Created ${user.name}`, description: req.admin ? "With the admin role." : null, action: audit("user.create") });
      await navigate({ to: "/access/users/$user", params: { user: user.name } });
    },
  });
}

/** Renames a user, then goes to the page of its new name; its bindings and tokens stay. */
export function useRenameUser(user: User) {
  const navigate = useNavigate();
  const audit = useAuditLink();
  const { onSuccess: refetch } = realistic(usersQuery.queryKey, bindingsQuery.queryKey, tokensQuery.queryKey);
  return useMutation({
    mutationFn: (name: string) => updateUser(user.uid, { name }),
    onSuccess: async (renamed, name, result, context) => {
      // Away from the old name first, so that its page is not fetched again only to be a 404.
      await navigate({ to: "/access/users/$user", params: { user: renamed.name }, replace: true });
      await refetch(renamed, name, result, context);
      notify({ tone: "success", title: `Renamed ${user.name} to ${renamed.name}`, action: audit("user.rename") });
    },
  });
}

/** Sets a user's password, which also ends a lock and sets or clears mustChange: the user is
 * fetched again. */
export function useSetPassword(user: User) {
  const audit = useAuditLink();
  const { onSuccess: refetch } = realistic(usersQuery.queryKey, userQuery(user.name).queryKey);
  return useMutation({
    mutationFn: (password: string) => setUserPassword(user.uid, password),
    onSuccess: async (data, password, result, context) => {
      await refetch(data, password, result, context);
      notify({ tone: "success", title: `Set the password of ${user.name}`, action: audit("user.password") });
    },
  });
}

/** Ends the lock of a user's password and its count of wrong passwords (rbac.md §1, The lockout). */
export function useUnlockUser(user: User) {
  const audit = useAuditLink();
  const { onSuccess: refetch } = realistic(usersQuery.queryKey, userQuery(user.name).queryKey);
  return useMutation({
    mutationFn: () => unlockUser(user.uid),
    onSuccess: async (data, v, result, context) => {
      await refetch(data, v, result, context);
      notify({ tone: "success", title: `Unlocked the password of ${user.name}`, action: audit("user.unlock") });
    },
  });
}

/** Asks for a new password before the user's password is used for anything else, or no longer
 * (mustChange, rbac.md §1, Change at first use). */
export function useMustChange(user: User) {
  const audit = useAuditLink();
  const { onSuccess: refetch } = realistic(usersQuery.queryKey, userQuery(user.name).queryKey);
  return useMutation({
    mutationFn: (mustChange: boolean) => updateUser(user.uid, { mustChange }),
    onSuccess: async (data, mustChange, result, context) => {
      await refetch(data, mustChange, result, context);
      notify({
        tone: "success",
        title: mustChange ? `${user.name} chooses a new password at the next sign-in` : `${user.name} keeps its password`,
        action: audit("user.mustchange"),
      });
    },
  });
}

/** Deletes a user after the confirmation, then leaves its page for the list of users. */
export function useDeleteUser(user: User) {
  const navigate = useNavigate();
  const audit = useAuditLink();
  const { onSuccess: refetch } = realistic(usersQuery.queryKey, bindingsQuery.queryKey, tokensQuery.queryKey);
  return useMutation({
    mutationFn: () => deleteUser(user.uid),
    onSuccess: async (data, v, result, context) => {
      await navigate({ to: "/access" });
      await refetch(data, v, result, context);
      notify({ tone: "success", title: `Deleted ${user.name}`, description: "Its tokens are revoked and its bindings gone.", action: audit("user.delete") });
    },
  });
}

/** Creates a binding; the dialog waits for the list to have it. With auth.approval
 * second-admin, one of the role admin or on *\/* is a request for a second admin instead
 * (docs/spec/rbac.md §13), which the requests show. */
export function useCreateBinding() {
  const audit = useAuditLink();
  const navigate = useNavigate();
  const { onSuccess: refetch } = realistic(bindingsQuery.queryKey);
  const { onSuccess: refetchRequests } = realistic(approvalsKey);
  return useMutation({
    mutationFn: (req: BindingRequest) => createBinding(req),
    onSuccess: async (made, req, result, context) => {
      if (isApproval(made)) {
        await refetchRequests(made, req, result, context);
        // The request names a user by its uid: the notice by its name, when the list has it.
        const ref = req.principal.startsWith("user:") ? req.principal.slice(5) : null;
        const known = context.client.getQueriesData<User | User[]>({ queryKey: usersQuery.queryKey }).flatMap(([, d]) => (d === undefined ? [] : Array.isArray(d) ? d : [d]));
        const user = ref ? known.find((u) => u.uid === ref || u.name === ref) : undefined;
        notify({
          tone: "success",
          title: `Asked another admin to approve ${describeBinding({ ...req, name: user?.name ?? ref ?? req.principal })}`,
          description: "It grants nothing until an admin other than you approves it, within 7 days.",
          action: { label: "Requests", run: () => void navigate({ to: "/access", search: { tab: "approvals" } }) },
        });
        return;
      }
      await refetch(made, req, result, context);
      notify({ tone: "success", title: `Bound ${describeBinding(made)}`, action: audit("binding.create") });
    },
  });
}

export const deleteBindingKey = ["binding-delete"];

/** Deletes a binding, optimistic in the list; Undo creates it again (realistic). */
export function useDeleteBinding() {
  const recreate = useCreateBinding();
  return useMutation({
    mutationKey: deleteBindingKey,
    mutationFn: (b: Binding) => deleteBinding(b.id),
    ...optimistic({
      updates: (b: Binding) => [update(bindingsQuery.queryKey, (list: Binding[]) => list.filter((x) => x.id !== b.id))],
      describe: (b) => `Delete the binding ${describeBinding(b)}`,
    }),
    onSuccess: (_, b) => {
      notify({
        tone: "success",
        title: `Deleted the binding ${describeBinding(b)}`,
        action: {
          label: "Undo",
          run: () =>
            recreate.mutate(
              { principal: b.principal, role: b.role, repoMask: b.repoMask },
              { onError: (err) => notify({ tone: "danger", title: `Bind ${describeBinding(b)} again: refused`, description: errorText(err) }) },
            ),
        },
      });
    },
  });
}
