// The fields of a proxy's upstream and of a group's members, in the create dialog and on the
// Settings tab. A refusal of the server shows under the field its message names.

import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { reposQuery } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { KindBadge } from "./repo-kinds";
import { memberCandidates, type GroupForm, type UpstreamForm } from "./repo-form";

/** The refusal of the server that belongs to a field, or nothing. */
export type ErrorAt = (field: string) => string | null;

/** The server's refusal under a field. */
export function FieldError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-xs text-danger">
      {error}
    </p>
  );
}

/** A Field with the refusal of the server that names it. */
export function ServerField({ label, htmlFor, hint, error, children }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; error: string | null; children: ReactNode }) {
  return (
    <Field label={label} htmlFor={htmlFor} hint={error ? undefined : hint}>
      {children}
      <FieldError error={error} />
    </Field>
  );
}

type UpstreamFieldsProps = {
  format: string;
  value: UpstreamForm;
  onChange: (value: UpstreamForm) => void;
  errorAt: ErrorAt;
  /** Choosing the upstream needs the admin role (rbac.md §7). */
  nameLocked?: boolean;
};

/** A proxy's upstream (proxy-and-group.md §2.2): its name in the configuration, the TTLs of its
 * cache, offline, and the names it mirrors and refuses. */
export function UpstreamFields({ format, value, onChange, errorAt, nameLocked = false }: UpstreamFieldsProps) {
  const ids = { name: useId(), list: useId(), meta: useId(), neg: useId(), offline: useId(), allow: useId(), deny: useId() };
  const repos = useQuery(reposQuery);
  // The configuration's upstreams have no endpoint: the names the caller's proxies use are hints.
  const known = [...new Set(repos.data?.filter((r) => r.format === format && r.upstream).map((r) => r.upstream!.name))];
  const set = (patch: Partial<UpstreamForm>) => onChange({ ...value, ...patch });
  const oci = format === "oci";
  return (
    <div className="space-y-4">
      <ServerField
        label="Upstream"
        htmlFor={ids.name}
        error={errorAt("upstream.name") ?? errorAt("upstream")}
        hint={
          nameLocked
            ? "Choosing the upstream needs the admin role."
            : "As the server's configuration names it (upstreams[].name); its URL and credentials stay there. Another upstream drops the repo's cache of this one."
        }
      >
        <Input
          id={ids.name}
          list={ids.list}
          value={value.name}
          disabled={nameLocked}
          spellCheck={false}
          className="font-mono"
          placeholder={oci ? "dockerhub" : "npmjs"}
          onChange={(e) => set({ name: e.target.value })}
        />
        <datalist id={ids.list}>
          {known.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </ServerField>
      <div className="grid gap-4 sm:grid-cols-2">
        <ServerField label="Metadata TTL" htmlFor={ids.meta} error={errorAt("upstream.metadataTTL")} hint={`How long ${oci ? "a tag's digest" : "a document"} is used: 0s to 168h; empty, 10m.`}>
          <Input id={ids.meta} value={value.metadataTTL} spellCheck={false} className="font-mono" placeholder="10m" onChange={(e) => set({ metadataTTL: e.target.value })} />
        </ServerField>
        <ServerField label="Negative TTL" htmlFor={ids.neg} error={errorAt("upstream.negativeTTL")} hint="How long what the upstream lacks is remembered: 0s to 24h; empty, 2m.">
          <Input id={ids.neg} value={value.negativeTTL} spellCheck={false} className="font-mono" placeholder="2m" onChange={(e) => set({ negativeTTL: e.target.value })} />
        </ServerField>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <Switch id={ids.offline} checked={value.offline} onCheckedChange={(offline) => set({ offline })} />
          <label htmlFor={ids.offline} className="text-sm font-medium">
            Offline
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Ask the upstream nothing: serve what the repo holds and its cache, however old.</p>
        <FieldError error={errorAt("upstream.offline")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <ServerField label="Mirrors" htmlFor={ids.allow} error={errorAt("upstream.allow")} hint={`${oci ? "Path" : "Name"} patterns, one a line; empty, everything. * matches any run.`}>
          <Textarea id={ids.allow} value={value.allow} rows={3} spellCheck={false} className="font-mono text-xs" placeholder={oci ? "library/*" : "@acme/*"} onChange={(e) => set({ allow: e.target.value })} />
        </ServerField>
        <ServerField label="Never fetches" htmlFor={ids.deny} error={errorAt("upstream.deny")} hint="Patterns that are never fetched, nor forwarded; they win over Mirrors.">
          <Textarea id={ids.deny} value={value.deny} rows={3} spellCheck={false} className="font-mono text-xs" placeholder="acme/*" onChange={(e) => set({ deny: e.target.value })} />
        </ServerField>
      </div>
    </div>
  );
}

type MembersFieldsProps = {
  format: string;
  /** The group's own name, never a member of itself. */
  self: string;
  value: GroupForm;
  onChange: (value: GroupForm) => void;
  errorAt: ErrorAt;
  /** Members and an oci group's paths need the admin role (rbac.md §7); merge needs manage. */
  membersLocked?: boolean;
};

/** A group's members in order (proxy-and-group.md §2.3): add, move, remove; the merged names,
 * or each member's path patterns on oci (§12.1). */
export function MembersFields({ format, self, value, onChange, errorAt, membersLocked = false }: MembersFieldsProps) {
  const ids = { add: useId(), merge: useId() };
  const repos = useQuery(reposQuery);
  const [adding, setAdding] = useState("");
  const oci = format === "oci";
  const byName = new Map(repos.data?.filter((r) => r.format === format).map((r) => [r.name, r]));
  const candidates = memberCandidates(repos.data ?? [], format, self, value.members);
  const choice = candidates.some((r) => r.name === adding) ? adding : (candidates[0]?.name ?? "");
  const setMembers = (members: string[]) => onChange({ ...value, members });
  const move = (i: number, by: number) => {
    const members = [...value.members];
    const [m] = members.splice(i, 1);
    members.splice(i + by, 0, m!);
    setMembers(members);
  };
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="text-sm font-medium">Members</div>
        <p className="text-xs text-muted-foreground">
          {membersLocked
            ? "Changing the members needs the admin role."
            : oci
              ? "oci repos, hosted or proxies; their order means nothing here: each path goes to the member whose pattern is the most specific. Path patterns: <path>, <prefix>/* or *, separated by spaces."
              : "Hosted and proxy repos of the format, read in this order, one hosted at most."}
        </p>
        {value.members.length ? (
          <ol className="divide-y divide-border rounded-md border border-border">
            {value.members.map((m, i) => (
              <li key={m} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="w-5 text-xs text-muted-foreground tabular">{i + 1}</span>
                <span className="min-w-28 font-mono text-sm">{m}</span>
                {byName.get(m) ? <KindBadge repo={byName.get(m)!} always /> : null}
                {oci ? (
                  <Input
                    aria-label={`Paths of ${m}`}
                    value={value.paths[m] ?? ""}
                    disabled={membersLocked}
                    spellCheck={false}
                    className="h-7 min-w-40 flex-1 font-mono text-xs"
                    placeholder="acme/*"
                    onChange={(e) => onChange({ ...value, paths: { ...value.paths, [m]: e.target.value } })}
                  />
                ) : (
                  <span className="flex-1" />
                )}
                {membersLocked ? null : (
                  <span className="flex gap-0.5">
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move ${m} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move ${m} down`} disabled={i === value.members.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${m}`} onClick={() => setMembers(value.members.filter((x) => x !== m))}>
                      <X />
                    </Button>
                  </span>
                )}
                {oci ? <FieldError error={errorAt(`group.paths.${m}`)} /> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">No members yet: a group has 1 to 16.</p>
        )}
        {membersLocked ? null : (
          <div className="flex gap-2">
            <Select id={ids.add} aria-label="A repo to add" value={choice} disabled={!candidates.length} onChange={(e) => setAdding(e.target.value)} className="font-mono">
              {candidates.length ? (
                candidates.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.kind})
                  </option>
                ))
              ) : (
                <option value="">no other hosted or proxy repo of {format}</option>
              )}
            </Select>
            <Button type="button" disabled={!choice || value.members.length >= 16} onClick={() => choice && setMembers([...value.members, choice])}>
              <Plus />
              Add
            </Button>
          </div>
        )}
        <FieldError error={errorAt("group.members") ?? errorAt("group.paths") ?? errorAt("group")} />
      </div>
      {oci ? null : (
        <ServerField
          label="Merged names"
          htmlFor={ids.merge}
          error={errorAt("group.merge")}
          hint="Name patterns, one a line, whose versions are merged across the members even when the hosted member holds the name; otherwise its names hide the proxies' versions."
        >
          <Textarea id={ids.merge} value={value.merge} rows={2} spellCheck={false} className="font-mono text-xs" placeholder="lodash" onChange={(e) => onChange({ ...value, merge: e.target.value })} />
        </ServerField>
      )}
    </div>
  );
}
