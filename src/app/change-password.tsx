// A user's own change of its password, from the user menu (docs/spec/rbac.md §1, A user's own
// password): the current password is the credential, the new one follows the server's rules and
// is none of the user's last four. The session and the user's tokens stay valid.

import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { changeOwnPassword, ownChangeRefused } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { notify } from "@/lib/notices";

export function ChangePasswordDialog({ user, onClose }: { user: string; onClose: () => void }) {
  const ids = { current: useId(), password: useId(), again: useId() };
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const differ = again !== "" && again !== password;
  const change = useMutation({
    mutationFn: () => changeOwnPassword(user, current, password),
    onSuccess: () => {
      notify({ tone: "success", title: "Changed your password", description: "This session and your tokens stay valid." });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (current && password && again === password) change.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !change.isPending && onClose()}>
      <DialogContent
        title="Change your password"
        description="The new one works from the next sign-in on; this session and your personal access tokens stay valid. A user who signs in through single sign-on changes it at the identity provider."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password" htmlFor={ids.current}>
            <Input id={ids.current} type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" htmlFor={ids.password} hint="None of your last four passwords; the server says which of its rules a password breaks.">
            <Input id={ids.password} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Again" htmlFor={ids.again} hint={differ ? <span className="text-danger">The two differ.</span> : undefined}>
            <Input id={ids.again} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
          <FormError error={ownChangeRefused(change.error)} />
          <DialogActions>
            <Button type="button" disabled={change.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!current || !password || again !== password || change.isPending}>
              <KeyRound />
              {change.isPending ? "Changing…" : "Change password"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
