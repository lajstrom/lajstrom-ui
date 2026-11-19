// The Settings tab of a repo, for whoever has manage on it (docs/api.md, Change and Delete).
// Anonymous read and the policy are optimistic: they show at once and go back if the server
// refuses. A proxy's upstream and a group's members are realistic: the form waits for the server
// and shows its refusal at the field. A delete is confirmed, then realistic.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Globe, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { useChanges } from "@/api/change";
import { mayRequire } from "@/api/requirements";
import { callerQuery, infoQuery, reposQuery } from "@/api/queries";
import type { Repo, RepoPolicy } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorText } from "@/lib/errors";
import { formatBytes, pluralize } from "@/lib/format";
import { formatSpec } from "@/lib/formats";

import { settingKey, settingOf, useDeleteRepo, useRepoUpdate, useSetting, type RepoSetting } from "./repo-changes";
import { FieldError, MembersFields, UpstreamFields } from "./repo-fields";
import { RequirementsCard } from "./repo-requirements";
import { defaultMaxFileSize, fieldOf, groupForm, groupPatch, policyPatch, repoFields, sizeBytes, sizeParts, upstreamForm, upstreamPatch, type SizeUnit } from "./repo-form";

export function RepoSettings({ repo }: { repo: Repo }) {
  const changes = useChanges<RepoSetting>(settingKey(repo.format, repo.name), settingOf);
  return (
    <div className="space-y-4">
      <AccessCard repo={repo} error={changes.get("anonymousRead")?.error ?? null} />
      {repo.kind !== "group" ? (
        // Keyed by the policy, so that the form shows the server's once it changes or goes back.
        <PolicyCard key={JSON.stringify(repo.policy ?? null)} repo={repo} change={changes.get("policy")} />
      ) : null}
      {mayRequire(repo) ? (
        // Keyed by the requirements, so that the form shows the server's once a change is saved.
        <RequirementsCard key={JSON.stringify(repo.policy?.requireAttachments ?? null)} repo={repo} />
      ) : null}
      {repo.upstream ? <UpstreamSettings key={JSON.stringify(repo.upstream)} repo={repo} /> : null}
      {repo.group ? <GroupSettings key={JSON.stringify(repo.group)} repo={repo} /> : null}
      <DeleteCard repo={repo} />
    </div>
  );
}

function AccessCard({ repo, error }: { repo: Repo; error: Error | null }) {
  const info = useQuery(infoQuery);
  const setting = useSetting(repo);
  const id = useId();
  return (
    <Card>
      <CardHeader icon={<Globe />} title="Access" description="Who may read is the role bindings' (Access); this lets anyone read, without credentials." />
      <CardBody className="space-y-1.5">
        <div className="flex items-center gap-2.5">
          <Switch id={id} checked={repo.anonymousRead} onCheckedChange={(anonymousRead) => setting.mutate({ anonymousRead })} />
          <label htmlFor={id} className="text-sm font-medium">
            Anonymous read
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Clients download from {repo.prefix} without credentials{repo.kind === "group" ? ", and through it from every member" : ""}. Publishing always
          needs them.
        </p>
        {info.data?.anonymousRead === false ? (
          <p className="text-xs text-warning">Off server-wide (auth.anonymousRead): the switch counts once the server allows anonymous reads.</p>
        ) : null}
        {error ? <p className="text-xs text-danger">Not changed: {errorText(error)}</p> : null}
      </CardBody>
    </Card>
  );
}

type PolicyForm = { size: string; unit: SizeUnit; blobRedirect: "auto" | "never"; sessionTimeout: string; maxSessionFiles: string; versionPolicy: "release" | "snapshot" };

function policyForm(p: RepoPolicy | null | undefined): PolicyForm {
  const size = sizeParts(p?.maxFileSize);
  return {
    size: size.value,
    unit: size.unit,
    blobRedirect: p?.blobRedirect ?? "auto",
    sessionTimeout: p?.maven?.sessionTimeout ?? "",
    maxSessionFiles: p?.maven?.maxSessionFiles === undefined ? "" : String(p.maven.maxSessionFiles),
    versionPolicy: p?.maven?.versionPolicy ?? "release",
  };
}

/** What the form cannot send: a number that is not one, which JSON would send as null, the
 * removal of the key. Ranges are the server's to check. */
function policyFormErrors(f: PolicyForm): { size: string | null; files: string | null } {
  const size = sizeBytes(f.size, f.unit);
  const files = f.maxSessionFiles.trim();
  return {
    size: size !== undefined && Number.isNaN(size) ? `"${f.size.trim()}" is not a number of ${f.unit}.` : null,
    files: files && !/^\d+$/.test(files) ? `"${files}" is not a whole number.` : null,
  };
}

/** The policy the form means: a key left at its default is absent. */
function policyOf(f: PolicyForm, current: RepoPolicy | null | undefined, maven: boolean): RepoPolicy {
  const size = sizeBytes(f.size, f.unit);
  const files = f.maxSessionFiles.trim();
  const m = {
    ...(f.sessionTimeout.trim() ? { sessionTimeout: f.sessionTimeout.trim() } : {}),
    ...(files ? { maxSessionFiles: Number(files) } : {}),
    // release is the default: kept when the policy names it, absent otherwise.
    ...(f.versionPolicy !== "release" || current?.maven?.versionPolicy ? { versionPolicy: f.versionPolicy } : {}),
  };
  return {
    ...(size === undefined ? {} : { maxFileSize: size }),
    ...(f.blobRedirect !== "auto" || current?.blobRedirect ? { blobRedirect: f.blobRedirect } : {}),
    ...(maven && Object.keys(m).length ? { maven: m } : {}),
  };
}

function PolicyCard({ repo, change }: { repo: Repo; change: { pending: boolean; error: Error | null } | undefined }) {
  const setting = useSetting(repo);
  const ids = { size: useId(), unit: useId(), timeout: useId(), files: useId() };
  const [form, setForm] = useState(() => policyForm(repo.policy));
  const set = (patch: Partial<PolicyForm>) => setForm((f) => ({ ...f, ...patch }));
  const maven = repo.format === "maven";
  const errors = policyFormErrors(form);
  const sendable = !errors.size && !(maven && errors.files);
  const patch = sendable ? policyPatch(repo.policy, policyOf(form, repo.policy, maven)) : null;
  const spec = formatSpec(repo.format);
  const fallback = defaultMaxFileSize[repo.format];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (patch) setting.mutate({ policy: patch });
  };
  return (
    <Card>
      <CardHeader icon={<ShieldCheck />} title="Policy" description="What the repo takes: checked whole by the server, and applied from the next request on." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="Largest file"
            htmlFor={ids.size}
            hint={`An upload or a blob larger than this is refused (413). Empty: ${fallback ? `${formatBytes(fallback)}, the default for ${spec.label}` : "the server's default"}; the registry's own limit holds too.`}
          >
            <div className="flex max-w-xs gap-2">
              <Input id={ids.size} inputMode="decimal" value={form.size} placeholder={fallback ? String(fallback / 1024 ** 3) : ""} onChange={(e) => set({ size: e.target.value })} />
              <Select aria-label="Unit" id={ids.unit} value={form.unit} onChange={(e) => set({ unit: e.target.value as SizeUnit })} className="w-24">
                <option value="MiB">MiB</option>
                <option value="GiB">GiB</option>
              </Select>
            </div>
            <FieldError error={errors.size} />
          </Field>
          <Field
            label="Blob redirect"
            hint={
              form.blobRedirect === "auto"
                ? "auto: a download is a 307 to the registry's storage when it redirects there, so the bytes bypass Lajstrom."
                : "never: Lajstrom streams every blob itself, for clients that cannot follow a redirect to another host."
            }
          >
            <div>
              <Segmented
                aria-label="Blob redirect"
                value={form.blobRedirect}
                onChange={(blobRedirect) => set({ blobRedirect })}
                options={[
                  { value: "auto", label: "auto" },
                  { value: "never", label: "never" },
                ]}
              />
            </div>
          </Field>
          {maven ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Deploy session timeout" htmlFor={ids.timeout} hint="How long a deploy's session lives after its last request: 1m to 24h; empty, 30m.">
                  <Input id={ids.timeout} value={form.sessionTimeout} spellCheck={false} className="font-mono" placeholder="30m" onChange={(e) => set({ sessionTimeout: e.target.value })} />
                </Field>
                <Field label="Files per deploy" htmlFor={ids.files} hint="How many files a deploy's session stores, signatures included: 1 to 999; empty, 256.">
                  <Input id={ids.files} inputMode="numeric" value={form.maxSessionFiles} placeholder="256" onChange={(e) => set({ maxSessionFiles: e.target.value })} />
                  <FieldError error={errors.files} />
                </Field>
              </div>
              <Field
                label="Versions taken"
                hint={form.versionPolicy === "release" ? "Release versions; a SNAPSHOT build is refused." : "The builds of SNAPSHOT versions; a release is refused."}
              >
                <div>
                  <Segmented
                    aria-label="Versions taken"
                    value={form.versionPolicy}
                    onChange={(versionPolicy) => set({ versionPolicy })}
                    options={[
                      { value: "release", label: "release" },
                      { value: "snapshot", label: "snapshot" },
                    ]}
                  />
                </div>
              </Field>
            </>
          ) : null}
          {change?.error ? <FormError error={`The policy was not changed: ${errorText(change.error)}`} /> : null}
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={!patch || change?.pending}>
              <Save />
              {change?.pending ? "Saving…" : "Save the policy"}
            </Button>
            {patch ? (
              <Button type="button" variant="ghost" onClick={() => setForm(policyForm(repo.policy))}>
                Discard
              </Button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function UpstreamSettings({ repo }: { repo: Repo }) {
  const who = useQuery(callerQuery);
  const save = useRepoUpdate(repo);
  const [form, setForm] = useState(() => upstreamForm(repo.upstream));
  const patch = upstreamPatch(repo.upstream!, form);
  const errorField = fieldOf(save.error, repoFields());
  const errorAt = (field: string) => (errorField === field ? errorText(save.error) : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (patch) save.mutate({ upstream: patch });
  };
  return (
    <Card>
      <CardHeader title="Upstream" description="Merged into the proxy's settings and checked whole; the next request on every replica uses them." />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <UpstreamFields format={repo.format} value={form} onChange={setForm} errorAt={errorAt} nameLocked={!who.data?.admin} />
          <FormError error={errorField ? null : errorText(save.error)} />
          <SaveButtons pending={save.isPending} changed={patch !== null} label="Save the upstream" onDiscard={() => setForm(upstreamForm(repo.upstream))} />
        </form>
      </CardBody>
    </Card>
  );
}

function GroupSettings({ repo }: { repo: Repo }) {
  const who = useQuery(callerQuery);
  const save = useRepoUpdate(repo);
  const [form, setForm] = useState(() => groupForm(repo.group));
  const patch = groupPatch(repo.format, repo.group!, form);
  const errorField = fieldOf(save.error, repoFields(form.members));
  const errorAt = (field: string) => (errorField === field ? errorText(save.error) : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (patch) save.mutate({ group: patch });
  };
  return (
    <Card>
      <CardHeader
        title="Group"
        description={repo.format === "oci" ? "The members and the paths each serves; the server checks them whole." : "The members in order, and the merged names; the server checks them whole."}
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <MembersFields format={repo.format} self={repo.name} value={form} onChange={setForm} errorAt={errorAt} membersLocked={!who.data?.admin} />
          <FormError error={errorField ? null : errorText(save.error)} />
          <SaveButtons pending={save.isPending} changed={patch !== null} label="Save the members" onDiscard={() => setForm(groupForm(repo.group))} />
        </form>
      </CardBody>
    </Card>
  );
}

function SaveButtons({ pending, changed, label, onDiscard }: { pending: boolean; changed: boolean; label: string; onDiscard: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" variant="primary" disabled={!changed || pending}>
        <Save />
        {pending ? "Saving…" : label}
      </Button>
      {changed && !pending ? (
        <Button type="button" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      ) : null}
    </div>
  );
}

function DeleteCard({ repo }: { repo: Repo }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-danger/40">
      <CardHeader
        icon={<Trash2 />}
        title="Delete the repository"
        description={repo.kind === "group" ? "The group goes; its members stay as they are." : "The index forgets the repo; its artifacts stay in the registry."}
        actions={
          <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
            <Trash2 />
            Delete
          </Button>
        }
      />
      {open ? <DeleteRepoDialog repo={repo} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}

/** Names what goes and what stays (docs/api.md, Delete), and asks for the repo's path. */
function DeleteRepoDialog({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const del = useDeleteRepo(repo);
  const repos = useQuery(reposQuery);
  const id = useId();
  const [typed, setTyped] = useState("");
  const spec = formatSpec(repo.format);
  const group = repo.kind === "group";
  // A member of a group stays until the group's members change (proxy-and-group.md §2.5).
  const groups = (repos.data ?? []).filter((r) => r.kind === "group" && r.format === repo.format && r.group?.members.includes(repo.name));
  const s = repo.stats;
  return (
    <Dialog open onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <DialogContent title={`Delete ${repo.prefix}?`}>
        <div className="space-y-3 text-sm">
          {group ? (
            <p>
              The group goes, with its deploy tokens. It holds nothing: its members, {repo.group?.members.join(", ")}, stay as they are, and so does
              everything they hold. Clients that read through {repo.prefix} get 404.
            </p>
          ) : (
            <>
              <p>
                The index forgets it:{" "}
                {s
                  ? `${pluralize(s.packages, spec.noun.one, spec.noun.many)} and ${pluralize(s.versions, "version")} (${formatBytes(s.size)})`
                  : `its ${spec.noun.many} and their versions`}
                , the rendered indexes, its deploy tokens, signing keys, publication sessions and tag claims
                {repo.kind === "proxy" ? `, and its cache of the upstream ${repo.upstream?.name}` : ""}. Clients get 404.
              </p>
              <p>
                The artifacts stay in the registry <span className="font-mono">{repo.registry}</span>, untouched, below{" "}
                <span className="font-mono">{repo.prefix}/</span>
                {repo.kind === "proxy" ? ", what the proxy fetched included" : ""}. Deleting them there is the registry's business.
              </p>
            </>
          )}
          <p className="text-muted-foreground">Role bindings name repos by mask and stay: a repo created later under this name is theirs again.</p>
          {groups.length ? (
            <p className="text-warning">
              It is a member of{" "}
              {groups.map((g, i) => (
                <span key={g.prefix}>
                  {i > 0 ? ", " : null}
                  <Link to="/$format/$repo" params={{ format: g.format, repo: g.name }} search={{ tab: "settings" }} className="font-mono underline">
                    {g.prefix}
                  </Link>
                </span>
              ))}
              : the server keeps it until {groups.length > 1 ? "those groups' members change" : "that group's members change"}.
            </p>
          ) : null}
          <Field label={<>Type <span className="font-mono">{repo.prefix}</span> to delete it</>} htmlFor={id}>
            <Input id={id} value={typed} autoComplete="off" spellCheck={false} className="font-mono" onChange={(e) => setTyped(e.target.value)} />
          </Field>
          <FormError error={errorText(del.error)} />
        </div>
        <DialogActions>
          <Button disabled={del.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={del.isPending || typed.trim() !== repo.prefix || groups.length > 0}
            // The dialog has named the versions that go: force, which a repo with versions needs.
            onClick={() => del.mutate(!group)}
          >
            <Trash2 />
            {del.isPending ? "Deleting…" : `Delete ${repo.prefix}`}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
