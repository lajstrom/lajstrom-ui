// Creating a repo (docs/api.md, Create), for the admin: realistic, since the server checks every
// field; its refusal shows under the field it names, and the dialog stays open.

import { useQuery } from "@tanstack/react-query";
import { CloudDownload, Database, Layers, Plus } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import { infoQuery, registriesQuery } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions, DialogContent } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { errorText } from "@/lib/errors";
import { formatOrder, formatSpec } from "@/lib/formats";

import { useCreateRepo } from "./repo-changes";
import { MembersFields, ServerField, UpstreamFields } from "./repo-fields";
import { createBody, fieldOf, groupForm, repoFields, upstreamForm, type CreateForm, type RepoKind } from "./repo-form";

/** The formats a repo can have: the server's plugins, and oci, which needs none; the roadmap's
 * order first. */
function useFormats(): string[] {
  const info = useQuery(infoQuery);
  const names = new Set([...(info.data?.formats.map((f) => f.name) ?? formatOrder), "oci"]);
  const rank = (f: string) => (formatOrder.includes(f as never) ? formatOrder.indexOf(f as never) : formatOrder.length);
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** "New repository" and its dialog; `format` preselects the list's filter. */
export function CreateRepoButton({ format }: { format?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        New repository
      </Button>
      {open ? <CreateRepoDialog format={format} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const kinds: { value: RepoKind; label: ReactNode }[] = [
  { value: "hosted", label: <span className="inline-flex items-center gap-1"><Database className="size-3.5" />Hosted</span> },
  { value: "proxy", label: <span className="inline-flex items-center gap-1"><CloudDownload className="size-3.5" />Proxy</span> },
  { value: "group", label: <span className="inline-flex items-center gap-1"><Layers className="size-3.5" />Group</span> },
];

const kindHint: Record<RepoKind, string> = {
  hosted: "Holds what is published to it.",
  proxy: "Serves an upstream of the server's configuration and keeps what it fetches; takes no publish.",
  group: "One address for several repos of its format; holds nothing itself. A format has proxies and groups when its plugin has them; oci repos have both.",
};

function CreateRepoDialog({ format, onClose }: { format?: string; onClose: () => void }) {
  const ids = { format: useId(), name: useId(), registry: useId(), anon: useId() };
  const formats = useFormats();
  const registries = useQuery(registriesQuery);
  const create = useCreateRepo();
  const [form, setForm] = useState<CreateForm>(() => ({
    format: format ?? "raw",
    name: "",
    kind: "hosted",
    registry: "",
    anonymousRead: false,
    upstream: upstreamForm(),
    group: groupForm(),
  }));
  const set = (patch: Partial<CreateForm>) => setForm((f) => ({ ...f, ...patch }));
  // The registries endpoint is proposed: without it, the name is typed.
  const registryNames = registries.data?.map((r) => r.name);
  const registry = form.registry || registryNames?.[0] || "";
  const body = createBody({ ...form, registry });

  const fields = repoFields(form.group.members);
  const errorField = fieldOf(create.error, fields, "name");
  const errorAt = (field: string) => (errorField === field ? errorText(create.error) : null);
  const ready = body.name !== "" && (form.kind !== "group" ? registry !== "" : form.group.members.length > 0) && (form.kind !== "proxy" || form.upstream.name.trim() !== "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) create.mutate(body);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !create.isPending && onClose()}>
      <DialogContent
        className="max-w-2xl"
        title="New repository"
        description="One format and one name; its path on every protocol is <format>/<name>. The format, the name and the registry never change."
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <ServerField label="Format" htmlFor={ids.format} error={errorAt("format")}>
              <Select id={ids.format} value={form.format} onChange={(e) => set({ format: e.target.value, group: groupForm() })}>
                {formats.map((f) => (
                  <option key={f} value={f}>
                    {formatSpec(f).name === f ? formatSpec(f).label : f}
                  </option>
                ))}
              </Select>
            </ServerField>
            <ServerField
              label="Name"
              htmlFor={ids.name}
              error={errorAt("name")}
              hint="Lowercase letters and digits separated by single '.', '_' or '-', at most 64 characters."
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-sm text-muted-foreground">{form.format}/</span>
                <Input
                  id={ids.name}
                  value={form.name}
                  autoFocus
                  maxLength={64}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                  placeholder="releases"
                  onChange={(e) => set({ name: e.target.value })}
                />
              </div>
            </ServerField>
          </div>
          <ServerField label="Kind" error={errorAt("kind")} hint={kindHint[form.kind]}>
            <div>
              <Segmented aria-label="Kind" value={form.kind} onChange={(kind) => set({ kind })} options={kinds} />
            </div>
          </ServerField>
          {form.kind !== "group" ? (
            <ServerField
              label="Registry"
              htmlFor={ids.registry}
              error={errorAt("registry")}
              hint="The backend registry that stores its artifacts, one of the server's configuration. It never changes: the artifacts stay where they were pushed."
            >
              {registryNames ? (
                <Select id={ids.registry} value={registry} onChange={(e) => set({ registry: e.target.value })} className="font-mono">
                  {registries.data!.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} ({r.product})
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id={ids.registry} value={form.registry} spellCheck={false} className="font-mono" placeholder="local" onChange={(e) => set({ registry: e.target.value })} />
              )}
            </ServerField>
          ) : null}
          {form.kind === "proxy" ? (
            <fieldset className="space-y-3 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Upstream</legend>
              <UpstreamFields format={form.format} value={form.upstream} onChange={(upstream) => set({ upstream })} errorAt={errorAt} />
            </fieldset>
          ) : null}
          {form.kind === "group" ? (
            <fieldset className="space-y-3 rounded-md border border-border p-3">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Group</legend>
              <MembersFields format={form.format} self={form.name.trim()} value={form.group} onChange={(group) => set({ group })} errorAt={errorAt} />
            </fieldset>
          ) : null}
          <div className="flex items-start gap-2.5">
            <Switch id={ids.anon} checked={form.anonymousRead} onCheckedChange={(anonymousRead) => set({ anonymousRead })} className="mt-0.5" />
            <label htmlFor={ids.anon} className="text-sm">
              <span className="font-medium">Anonymous read</span>
              <span className="block text-xs text-muted-foreground">Clients read without credentials, where the server allows it. Can be changed later.</span>
            </label>
          </div>
          <FormError error={errorField ? null : errorText(create.error)} />
          <DialogActions>
            <Button type="button" disabled={create.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || create.isPending}>
              <Plus />
              {create.isPending ? "Creating…" : `Create ${form.format}/${form.name.trim() || "…"}`}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}
