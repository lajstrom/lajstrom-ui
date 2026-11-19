// The required attachments of a repo, a card of its Settings (docs/spec/policy.md §11): the
// attachments a version must have, each verified of a predicate type and signed by one of some
// names, before the repo serves it. A key of the repo's policy, set and lifted with manage.
// Realistic, unlike the policy's other keys: the server checks the names against its trust, and
// a change withholds versions, so the form waits for the server and keeps what was typed when it
// refuses (docs/adr/0003-changes-realistic-by-default.md).

import { useMutation } from "@tanstack/react-query";
import { FileCheck2, Plus, Save, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { realistic } from "@/api/change";
import { updateRepo } from "@/api/mutations";
import { knownTypes, requirementText } from "@/api/requirements";
import type { Repo, Requirement } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorText } from "@/lib/errors";
import { notify } from "@/lib/notices";

type Row = { type: string; signers: string };

const rowsOf = (reqs: Requirement[] | undefined): Row[] => (reqs ?? []).map((r) => ({ type: r.predicateType, signers: r.signedBy.join(", ") }));

const namesOf = (signers: string) => signers.split(/[\s,]+/).filter(Boolean);

/** What the form cannot send, by row; the server checks the rest, the names against its trust. */
function rowProblem(r: Row): string | null {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(r.type.trim())) return "The predicate type is an absolute URI, such as https://spdx.dev/Document.";
  const names = namesOf(r.signers);
  if (names.length === 0) return "At least one signer: a name of the server's attachments.trust or attachments.keyless.identities.";
  if (names.length > 16) return "At most 16 signers.";
  return null;
}

export function RequirementsCard({ repo }: { repo: Repo }) {
  const { onSuccess: refetch } = realistic(["repos"]);
  const save = useMutation({
    mutationFn: (reqs: Requirement[]) => updateRepo(repo.format, repo.name, { policy: { requireAttachments: reqs.length ? reqs : null } }),
    onSuccess: async (data, reqs, result, context) => {
      await refetch(data, reqs, result, context);
      notify({ tone: "success", title: reqs.length ? `Saved the required attachments of ${repo.prefix}` : `Removed the required attachments of ${repo.prefix}` });
    },
  });
  const listId = useId();
  const current = repo.policy?.requireAttachments;
  const [rows, setRows] = useState<Row[]>(() => rowsOf(current));
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const problems = rows.map(rowProblem);
  const next: Requirement[] = rows.map((r) => ({ predicateType: r.type.trim(), signedBy: namesOf(r.signers) }));
  const changed = JSON.stringify(next) !== JSON.stringify(current ?? []);
  const ready = changed && problems.every((p) => p === null) && rows.length <= 16;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) save.mutate(next);
  };
  return (
    <Card>
      <CardHeader
        icon={<FileCheck2 />}
        title="Required attachments"
        description="The repo serves a version only once its manifest has each of these, verified and signed by one of the names: every version, those pushed before too. A version that lacks one is left out of the indexes and its download refused; its upload is never refused, and no allow rule lets it through."
      />
      <CardBody>
        <form onSubmit={submit} className="space-y-3">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">None: the repo serves every version the rest of its policy lets through.</p> : null}
          {rows.map((r, i) => (
            <div key={i} className="space-y-1.5 rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto]">
                <Input
                  aria-label={`Predicate type of requirement ${i + 1}`}
                  list={listId}
                  value={r.type}
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder="https://spdx.dev/Document"
                  onChange={(e) => set(i, { type: e.target.value })}
                />
                <Input
                  aria-label={`Signers of requirement ${i + 1}`}
                  value={r.signers}
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder="release, release-2027"
                  onChange={(e) => set(i, { signers: e.target.value })}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove requirement ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              </div>
              <p className={problems[i] ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
                {problems[i] ?? `Requires ${requirementText(next[i]!)}; a longer version of the type counts too.`}
              </p>
            </div>
          ))}
          <datalist id={listId}>
            {knownTypes.map((k) => (
              <option key={k.type} value={k.type} label={k.label} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            Signers are the names of the server&apos;s attachments.trust and attachments.keyless.identities, separated by commas. Whoever manages the repo
            may lift a requirement, as every change of its policy is a repo.update row of the audit log. A package&apos;s page lists the versions a
            requirement leaves out.
          </p>
          {save.error ? <FormError error={`The required attachments were not changed: ${errorText(save.error)}`} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={rows.length >= 16} onClick={() => setRows((rs) => [...rs, { type: "", signers: "" }])}>
              <Plus />
              Add a requirement
            </Button>
            <Button type="submit" variant="primary" disabled={!ready || save.isPending}>
              <Save />
              {save.isPending ? "Saving…" : next.length || !current ? "Save the requirements" : "Remove the requirements"}
            </Button>
            {changed ? (
              <Button type="button" variant="ghost" onClick={() => setRows(rowsOf(current))}>
                Discard
              </Button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
