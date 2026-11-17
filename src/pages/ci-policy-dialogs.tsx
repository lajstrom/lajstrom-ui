import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Info, Minus, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { ApiError } from "@/api/client";
import { ciPolicyChanges } from "@/api/mutations";
import { reposQuery } from "@/api/queries";
import { needsStepUp } from "@/api/step-up";
import type { CIGrant, CIPolicy, CIPolicyList } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  bodyOf,
  claimKind,
  claimKinds,
  draftOf,
  fieldErrors,
  issuerNames,
  MAX_DAYS,
  newDraft,
  platformOf,
  platforms,
  writes,
  type Draft,
  type Platform,
} from "@/lib/ci-policies";
import { errorText } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { maskSuggestions } from "@/lib/masks";

import { changedMeanwhile, useCIChange, useDeleteCIPolicy, useReadAgain, type CIChange } from "./ci-policy-changes";
import { ChangeError, StepUpNotice } from "./ci-step-up";

const ROLES: CIGrant["role"][] = ["reader", "writer", "maintainer"];

/** What a value of a claim looks like, for the placeholder of its row. */
const examples: Record<string, string> = {
  repository_id: "123456789",
  repository_owner_id: "987654",
  project_id: "4410",
  namespace_id: "1872",
  repository: "acme/app",
  project_path: "acme/platform/app",
  ref: "refs/heads/main",
  ref_path: "refs/heads/main",
  environment: "production",
  event_name: "push",
  pipeline_source: "push",
  ref_type: "branch",
  ref_protected: "true",
};

/** The problems the server named for one field, under it. */
function FieldProblems({ problems }: { problems: string[] | undefined }) {
  if (!problems?.length) return null;
  return (
    <ul role="alert" className="space-y-0.5 text-xs text-danger">
      {problems.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

/** The refusal of a create or a change: the step-up, or the server's problems by field, where
 * the form has the field, and the rest above the buttons. */
function useRefusal(error: Error | null, placed: (key: string) => boolean) {
  return useMemo(() => {
    const byField = new Map<string, string[]>();
    let rest: ReactNode = null;
    if (!error || needsStepUp(error) || changedMeanwhile(error)) return { byField, rest };
    if (!(error instanceof ApiError) || !error.fromServer) return { byField, rest: errorText(error) };
    const unplaced: string[] = [];
    for (const [key, problems] of fieldErrors(error.message)) {
      if (key && placed(key)) byField.set(key, problems);
      else unplaced.push(...problems.map((p) => (key ? `${key}: ${p}` : p)));
    }
    if (unplaced.length) rest = error.status === 403 ? `Not allowed: ${unplaced.join("; ")}.` : `${unplaced.join("; ").replace(/\.$/, "")}.`;
    return { byField, rest };
  }, [error, placed]);
}

type FormProps = {
  list: CIPolicyList;
  /** The policy to change, as its GET answered it; absent for a new one. */
  editing?: { policy: CIPolicy; etag: string | null };
  onClose: () => void;
  /** After the server took it: the policy's name, to show it. */
  onSaved: (name: string) => void;
};

/**
 * Makes a policy, or changes one of the API, and waits for the server (realistic), which checks
 * its rules and, for one that writes, its steps: a refusal names each field, shown at it. The
 * claims offered are those of the issuer's platform; the server's issuers say it (proposed), and
 * without them the person names the issuer and picks the platform of the hints.
 */
export function PolicyFormDialog({ list, editing, onClose, onSaved }: FormProps) {
  const ids = { name: useId(), issuer: useId(), issuers: useId(), platform: useId(), days: useId(), masks: useId() };
  const names = issuerNames(list.issuers, list.policies);
  const [draft, setDraft] = useState<Draft>(() => {
    if (editing) return draftOf(editing.policy, platformOf(editing.policy.issuer, list.issuers, list.policies) ?? "github");
    const issuer = names[0] ?? "";
    return newDraft(issuer, platformOf(issuer, list.issuers, list.policies) ?? "github");
  });
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const known = platformOf(draft.issuer.trim(), list.issuers, list.policies);
  const platform: Platform = known ?? draft.platform;
  const repos = useQuery(reposQuery);
  const masks = useMemo(() => maskSuggestions((repos.data ?? []).map((r) => r.prefix)), [repos.data]);
  const change = useCIChange();
  const readAgain = useReadAgain(editing?.policy.name ?? "");
  const writing = writes({ grants: draft.grants });

  const placed = useMemo(() => {
    const keys = new Set(["issuer", "claims", "grants", ...(editing ? [] : ["name"]), ...(writing ? ["expiresAt"] : [])]);
    for (const row of draft.claims) if (row.claim) keys.add(`claims.${row.claim}`);
    draft.grants.forEach((_, i) => keys.add(`grants.${i}`));
    return (key: string) => keys.has(key);
  }, [draft.claims, draft.grants, editing, writing]);
  const { byField, rest } = useRefusal(change.error, placed);

  const name = editing?.policy.name ?? draft.name.trim();
  const what = editing ? `Change the CI trust policy ${name}` : `Create the CI trust policy ${name}`;
  const request = (body: ReturnType<typeof bodyOf>): CIChange => ({
    request: editing ? ciPolicyChanges.replace(editing.policy.name, body, editing.etag) : ciPolicyChanges.create(body),
    what,
  });
  // The change as the form holds it now, for a step-up's notice; the time is the submit's.
  const [sent, setSent] = useState<CIChange | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = request(bodyOf(draft, Date.now()));
    setSent(c);
    change.mutate(c, {
      onSuccess: () => onSaved(name),
      onError: (err) => changedMeanwhile(err) && void readAgain(),
    });
  };
  const setClaim = (i: number, patch: Partial<Draft["claims"][number]>) => set({ claims: draft.claims.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setGrant = (i: number, patch: Partial<Draft["grants"][number]>) => set({ grants: draft.grants.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  return (
    <Dialog open onOpenChange={(o) => !o && !change.isPending && onClose()}>
      <DialogContent
        className="max-w-2xl"
        title={editing ? `Change the policy ${editing.policy.name}` : "New CI trust policy"}
        description="A CI job's OIDC token whose claims match is exchanged for a CI token of minutes, with the grants below (docs/spec/rbac.md §11)."
      >
        <form onSubmit={submit} className="space-y-5">
          {editing ? null : (
            <Field label="Name" htmlFor={ids.name} hint="Lowercase letters and digits with single hyphens. It names the policy in the CI token and the audit log, and never changes.">
              <Input id={ids.name} value={draft.name} autoFocus spellCheck={false} autoComplete="off" placeholder="web-publish" className="font-mono" onChange={(e) => set({ name: e.target.value })} />
              <FieldProblems problems={byField.get("name")} />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Issuer"
              htmlFor={ids.issuer}
              hint={list.issuers ? "An issuer of the server's auth.ci.issuers." : "The name of an issuer of the server's auth.ci.issuers, as its configuration has it."}
            >
              {list.issuers ? (
                <Select id={ids.issuer} value={draft.issuer} onChange={(e) => set({ issuer: e.target.value })}>
                  {list.issuers.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} ({platforms[i.platform].label})
                    </option>
                  ))}
                </Select>
              ) : (
                <>
                  <Input
                    id={ids.issuer}
                    list={ids.issuers}
                    value={draft.issuer}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="github"
                    className="font-mono"
                    onChange={(e) => set({ issuer: e.target.value, platform: platformOf(e.target.value.trim(), list.issuers, list.policies) ?? draft.platform })}
                  />
                  <datalist id={ids.issuers}>
                    {names.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </>
              )}
              <FieldProblems problems={byField.get("issuer")} />
            </Field>
            {known ? (
              <Field label="Platform" hint="Of the issuer's tokens: the claims a policy names.">
                <p className="flex h-8 items-center text-sm">{platforms[known].label}</p>
              </Field>
            ) : (
              <Field label="Platform" htmlFor={ids.platform} hint="The server does not say its issuers' platforms: pick the issuer's, for the claims offered.">
                <Select id={ids.platform} value={draft.platform} onChange={(e) => set({ platform: e.target.value as Platform })}>
                  {(Object.keys(platforms) as Platform[]).map((p) => (
                    <option key={p} value={p}>
                      {platforms[p].label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Claims</legend>
            <p className="text-xs text-muted-foreground">
              A token matches when each claim has one of its values, one a line. Name the project by an id, {platforms[platform].ids.join(" or ")}; a policy that
              writes also needs {platforms[platform].writeConditions.join(", ")}, and never matches a job of a pull request.
            </p>
            {draft.claims.map((row, i) => {
              const kind = row.claim ? claimKind(platform, row.claim) : null;
              const lines = Math.max(1, row.values.split("\n").length);
              return (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-start gap-2">
                    <Select aria-label={`Claim ${i + 1}`} value={row.claim} className="font-mono" onChange={(e) => setClaim(i, { claim: e.target.value })}>
                      <option value="">Choose a claim</option>
                      {claimKinds.map((k) => (
                        <optgroup key={k.kind} label={k.label}>
                          {platforms[platform].claims[k.kind].map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                      {row.claim && !kind ? <option value={row.claim}>{row.claim}</option> : null}
                    </Select>
                    <Textarea
                      aria-label={`Values of ${row.claim || `claim ${i + 1}`}`}
                      rows={lines}
                      value={row.values}
                      spellCheck={false}
                      placeholder={examples[row.claim] ?? (kind === "id" ? "123456" : "")}
                      className="min-h-8 resize-y py-1 font-mono text-[12.5px]"
                      onChange={(e) => setClaim(i, { values: e.target.value })}
                    />
                    <Button type="button" size="icon" variant="ghost" aria-label={`Remove the claim ${row.claim || i + 1}`} onClick={() => set({ claims: draft.claims.filter((_, j) => j !== i) })}>
                      <Minus />
                    </Button>
                  </div>
                  {kind ? <p className="text-xs text-muted-foreground">{claimKinds.find((k) => k.kind === kind)!.hint}</p> : null}
                  <FieldProblems problems={row.claim ? byField.get(`claims.${row.claim}`) : undefined} />
                </div>
              );
            })}
            <Button type="button" size="sm" onClick={() => set({ claims: [...draft.claims, { claim: "", values: "" }] })}>
              <Plus />
              Add a claim
            </Button>
            <FieldProblems problems={byField.get("claims")} />
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Grants</legend>
            <p className="text-xs text-muted-foreground">
              What the CI token may do: a role on the repos of a mask, <span className="font-mono">&lt;format&gt;/&lt;repo&gt;</span>, each a name or *.
            </p>
            {draft.grants.map((g, i) => (
              <div key={i} className="space-y-1">
                <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-start gap-2">
                  <Select aria-label={`Role ${i + 1}`} value={g.role} onChange={(e) => setGrant(i, { role: e.target.value as CIGrant["role"] })}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label={`Mask ${i + 1}`}
                    list={ids.masks}
                    value={g.mask}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="pypi/internal"
                    className="font-mono"
                    onChange={(e) => setGrant(i, { mask: e.target.value })}
                  />
                  <Button type="button" size="icon" variant="ghost" aria-label={`Remove grant ${i + 1}`} onClick={() => set({ grants: draft.grants.filter((_, j) => j !== i) })}>
                    <Minus />
                  </Button>
                </div>
                <FieldProblems problems={byField.get(`grants.${i}`)} />
              </div>
            ))}
            <datalist id={ids.masks}>
              {masks.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <Button type="button" size="sm" onClick={() => set({ grants: [...draft.grants, { role: "reader", mask: "" }] })}>
              <Plus />
              Add a grant
            </Button>
            <FieldProblems problems={byField.get("grants")} />
          </fieldset>

          {writing ? (
            <>
              <Field label="Expires after" htmlFor={ids.days} hint={`Days from the change, at most ${MAX_DAYS}: a policy that writes then stops counting, unless it is renewed.`}>
                <div className="flex items-center gap-2">
                  <Input id={ids.days} type="number" min={1} max={MAX_DAYS} value={draft.days} className="w-24" onChange={(e) => set({ days: e.target.value })} />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <FieldProblems problems={byField.get("expiresAt")} />
              </Field>
              <WriteSteps change={!!editing} />
            </>
          ) : null}

          {change.error && needsStepUp(change.error) && sent ? <StepUpNotice error={change.error} change={sent} /> : null}
          {changedMeanwhile(change.error) ? (
            <FormError error="The policy changed since you opened this form, and nothing was saved. Close the form and open it again on the policy as it is now." />
          ) : null}
          <FormError error={rest} />
          <DialogActions>
            <Button type="button" disabled={change.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={change.isPending || (!editing && !draft.name.trim())}>
              {editing ? <Pencil /> : <Workflow />}
              {change.isPending ? "Saving…" : editing ? "Save" : "Create policy"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The steps a policy that writes takes (rbac.md §11), said before the person sends it. */
function WriteSteps({ change }: { change: boolean }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary-soft px-3 py-2.5 text-xs text-primary-soft-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <p>
        A policy that writes takes steps: your sign-in through single sign-on with a second factor in the last 10 minutes, masks within the server&apos;s{" "}
        <span className="font-mono">auth.ci.apiWriteRepos</span>, and the approval of another admin, until which it waits, pending, and grants nothing.
        {change ? " A change waits for an approval again, whatever it changes." : null}
      </p>
    </div>
  );
}

type PolicyProps = { policy: CIPolicy; etag: string | null; onClose: () => void };

/** Renews a policy that writes: a new expiry, which waits for another admin's approval beside
 * the policy, which keeps its own until then; an expired one waits pending (realistic). */
export function RenewDialog({ policy, etag, onClose }: PolicyProps) {
  const id = useId();
  const [days, setDays] = useState(String(MAX_DAYS));
  const renew = useCIChange();
  const readAgain = useReadAgain(policy.name);
  const [sent, setSent] = useState<CIChange | null>(null);
  const expired = policy.state === "expired";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(days);
    const expiresAt = Number.isFinite(n) && n !== MAX_DAYS && days.trim() ? new Date(Date.now() + n * 86_400_000).toISOString().replace(/\.\d+Z$/, "Z") : undefined;
    const c: CIChange = { request: ciPolicyChanges.renew(policy.name, expiresAt, etag), what: `Renew the CI trust policy ${policy.name}` };
    setSent(c);
    renew.mutate(c, { onSuccess: onClose, onError: (err) => changedMeanwhile(err) && void readAgain() });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !renew.isPending && onClose()}>
      <DialogContent
        title={`Renew ${policy.name}`}
        description={
          expired
            ? `It expired ${formatDate(policy.expiresAt)}. Renewed, it waits, pending, for another admin's approval, and grants nothing until then.`
            : `It expires ${formatDate(policy.expiresAt)}. The renewal waits for another admin's approval; the policy keeps its expiry until then.`
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Expires after" htmlFor={id} hint={`Days from the renewal, at most ${MAX_DAYS}.`}>
            <div className="flex items-center gap-2">
              <Input id={id} type="number" min={1} max={MAX_DAYS} value={days} autoFocus className="w-24" onChange={(e) => setDays(e.target.value)} />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </Field>
          {policy.renewal ? (
            <p className="text-xs text-muted-foreground">A renewal to {formatDate(policy.renewal.expiresAt)} waits already: this one takes its place.</p>
          ) : null}
          {changedMeanwhile(renew.error) ? (
            <FormError error="The policy changed since you read it, and was not renewed. Read it again below, then renew it." />
          ) : sent ? (
            <ChangeError error={renew.error} change={sent} />
          ) : null}
          <DialogActions>
            <Button type="button" disabled={renew.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={renew.isPending}>
              <CalendarClock />
              {renew.isPending ? "Renewing…" : "Renew"}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Names what a delete ends, then waits for the server (realistic); a policy that writes is
 * deleted without a step. leave closes the policy's panel first. */
export function DeletePolicyDialog({ policy, etag, onClose, leave }: PolicyProps & { leave: () => Promise<void> }) {
  const del = useDeleteCIPolicy(policy.name, leave);
  const readAgain = useReadAgain(policy.name);
  const remove = () =>
    del.mutate(
      { request: ciPolicyChanges.remove(policy.name, etag), what: `Delete the CI trust policy ${policy.name}` },
      { onSuccess: onClose, onError: (err) => changedMeanwhile(err) && void readAgain() },
    );
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={`Delete the policy ${policy.name}?`}>
        <div className="space-y-3 text-sm">
          <p>
            No CI job gets a token through it any more, and the CI tokens it gave grant nothing from their next request on. The audit log keeps its changes.
            This cannot be undone: a policy made again under its name {writes(policy) ? "takes the steps of a policy that writes again" : "is a new one"}.
          </p>
          {changedMeanwhile(del.error) ? (
            <FormError error="The policy changed since you read it, and was not deleted. Read it again below, then delete it." />
          ) : (
            <FormError error={errorText(del.error)} />
          )}
        </div>
        <DialogActions>
          <Button disabled={del.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={del.isPending} onClick={remove}>
            <Trash2 />
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
