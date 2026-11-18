// The access review, a tab of Access (docs/spec/rbac.md §14): the server's access report, who
// has what at one moment, with the flags a reviewer looks for, and the record of a review, the
// audit row access.review that names the report by the sha256 of its bytes. Lajstrom keeps no
// report: the reviewer downloads it, keeps it with the ticket, and records the review here.
// ?scope=, ?unusedDays= and ?flag= are in the URL; the report is read again only when asked.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ClipboardCheck, Download, FileSearch, KeyRound, RefreshCw, Users, Workflow } from "lucide-react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { accessReportQuery } from "@/api/access-report";
import { realistic } from "@/api/change";
import { recordAccessReview } from "@/api/mutations";
import { auditQuery } from "@/api/queries";
import type { AccessFlag, AccessReport } from "@/api/types";
import { ErrorState, Principal, RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { Field, FormError } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState, Properties, Property, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { errorText } from "@/lib/errors";
import { formatBytes, formatDateTime, pluralize } from "@/lib/format";
import { notify } from "@/lib/notices";

type Scope = "all" | "people" | "systems";
type ReviewSearch = { tab?: string; scope?: Scope; unusedDays?: string; flag?: AccessFlag };

const scopes: { value: Scope; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "people", label: "People" },
  { value: "systems", label: "Systems" },
];

/** What each flag means, as rbac.md §14 says it. */
const flagHelp: Record<AccessFlag, string> = {
  admin: "A binding of the role admin, its own or a current group's",
  allRepos: "A binding on */*, a deploy token over */*, or a CI grant on */*",
  adminWithoutEffect: "An admin binding of a service account or a local user under the admin mode, which counts for nothing until it is off",
  noExpiry: "A token or a CI trust policy without an expiry",
  unused: "No use for more than the days of the report",
  beyondMaxTTL: "A token beyond the bound of its kind, to be replaced",
  ownerDisabled: "A service account whose user owner is disabled",
  inactive: "A user inactive under auth.disableInactiveUsersAfter",
};

const FLAGS = Object.keys(flagHelp) as AccessFlag[];

const flagTone = (f: AccessFlag) => (f === "admin" || f === "allRepos" || f === "ownerDisabled" ? "warning" : f === "beyondMaxTTL" || f === "inactive" ? "danger" : "neutral");

function Flags({ flags }: { flags: readonly AccessFlag[] }) {
  if (!flags.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => (
        <Tooltip key={f} content={flagHelp[f] ?? f}>
          <span>
            <Badge tone={flagTone(f)} shape="square" className="font-mono">
              {f}
            </Badge>
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

export function AccessReview() {
  const search = useSearch({ strict: false }) as ReviewSearch;
  const navigate = useNavigate();
  const client = useQueryClient();
  const scope: Scope = scopes.some((s) => s.value === search.scope) ? search.scope! : "all";
  const days = Number(search.unusedDays);
  const unusedDays = Number.isInteger(days) && days >= 1 && days <= 3650 ? days : 90;
  const setSearch = (patch: Partial<ReviewSearch>) => navigate({ to: "/access", search: (p: ReviewSearch) => ({ ...p, tab: "review", ...patch }), replace: true });
  const query = accessReportQuery(scope, unusedDays);
  const report = useQuery(query);
  const readAgain = () => void client.resetQueries({ queryKey: query.queryKey, exact: true });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          icon={<FileSearch />}
          title="Access report"
          description="Who has what at one moment, with the flags a reviewer looks for (PCI DSS 7.2.4 for people, 7.2.5.1 for systems). The server keeps no report: download it, keep it with the ticket, and record the review below."
          actions={
            <Button size="sm" disabled={report.isFetching} onClick={readAgain}>
              <RefreshCw />
              Read again
            </Button>
          }
        />
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Field label="Scope">
            <Segmented aria-label="Scope" value={scope} onChange={(v) => void setSearch({ scope: v === "all" ? undefined : v, flag: undefined })} options={scopes} />
          </Field>
          <UnusedDays value={unusedDays} onChange={(n) => void setSearch({ unusedDays: n === 90 ? undefined : String(n) })} />
        </div>
        {report.isError ? (
          <ErrorState error={report.error} onRetry={readAgain} />
        ) : report.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (
          <ReportBody report={report.data.report} bytes={report.data.bytes} sha256={report.data.sha256} flag={search.flag} onFlag={(flag) => void setSearch({ flag })} />
        )}
      </Card>
      {report.data ? <RecordReview report={report.data.report} sha256={report.data.sha256} /> : null}
      <PastReviews />
    </div>
  );
}

/** The days after which a user or a token without a use is unused, set on Enter or on leaving. */
function UnusedDays({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const id = useId();
  const apply = (raw: string) => {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 3650 && n !== value) onChange(n);
  };
  return (
    <Field label="Unused after" htmlFor={id}>
      <span className="flex items-center gap-2 text-sm">
        <Input
          id={id}
          key={value}
          type="number"
          min={1}
          max={3650}
          defaultValue={value}
          className="w-24"
          onBlur={(e) => apply(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && apply(e.currentTarget.value)}
        />
        days (PCI DSS 8.2.6: 90)
      </span>
    </Field>
  );
}

/** Saves the bytes as the server sent them, which the sha256 names. */
function download(bytes: Uint8Array, report: AccessReport) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `access-report-${report.scope}-${report.generatedAt.replaceAll(":", "")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Entry = { key: string; who: ReactNode; kind: string; flags: AccessFlag[]; what: ReactNode };

function ReportBody({ report: r, bytes, sha256, flag, onFlag }: { report: AccessReport; bytes: Uint8Array; sha256: string; flag?: AccessFlag; onFlag: (f?: AccessFlag) => void }) {
  const sections = useMemo(() => entriesOf(r), [r]);
  const all = sections.flatMap((s) => s.entries);
  const counts = new Map<AccessFlag, number>(FLAGS.map((f) => [f, all.filter((e) => e.flags.includes(f)).length]));
  return (
    <>
      <Properties className="border-b border-border px-4 py-3">
        <Property label="Generated">
          {formatDateTime(r.generatedAt)} (<RelativeTime iso={r.generatedAt} />)
        </Property>
        <Property label="sha256">
          <CopyText value={sha256} display={`${sha256.slice(0, 16)}…`} label="sha256" />
        </Property>
        <Property label="Document">
          <Button size="sm" onClick={() => download(bytes, r)}>
            <Download />
            Download, {formatBytes(bytes.length)}
          </Button>
        </Property>
        <Property label="Settings">
          <span className="text-xs">
            admin mode {r.settings.adminMFA ? "on" : "off"} · anonymous read {r.settings.anonymousRead ? "on" : "off"} · inactive after{" "}
            {r.settings.disableInactiveUsersAfter ? `${Math.round(r.settings.disableInactiveUsersAfter / 86400)} days` : "never"} · deploy tokens at most{" "}
            {r.settings.deployTokensMaxTTL ? `${Math.round(r.settings.deployTokensMaxTTL / 86400)} days` : "unbounded"}
          </span>
        </Property>
      </Properties>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3 text-xs">
        <span className="mr-1 text-muted-foreground">Flagged:</span>
        <Button size="sm" variant={flag ? "secondary" : "primary"} onClick={() => onFlag(undefined)}>
          Everything, {all.length}
        </Button>
        {FLAGS.filter((f) => counts.get(f)).map((f) => (
          <Tooltip key={f} content={flagHelp[f]}>
            <Button size="sm" variant={flag === f ? "primary" : "secondary"} className="font-mono" onClick={() => onFlag(flag === f ? undefined : f)}>
              {f}, {counts.get(f)}
            </Button>
          </Tooltip>
        ))}
      </div>
      {sections.map((s) => {
        const shown = flag ? s.entries.filter((e) => e.flags.includes(flag)) : s.entries;
        if (!shown.length && flag) return null;
        return (
          <section key={s.title} className="border-b border-border last:border-b-0">
            <h3 className="flex items-center gap-2 px-4 pt-3 pb-1 text-sm font-semibold">
              {s.icon}
              {s.title}
              <span className="font-normal text-muted-foreground">{shown.length}</span>
            </h3>
            {shown.length ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Who</TH>
                    <TH>What it has</TH>
                    <TH>Flags</TH>
                  </TR>
                </THead>
                <TBody>
                  {shown.map((e) => (
                    <TR key={e.key}>
                      <TD className="whitespace-nowrap">
                        {e.who}
                        <span className="block text-xs text-muted-foreground">{e.kind}</span>
                      </TD>
                      <TD className="max-w-[32rem] text-xs">{e.what}</TD>
                      <TD>
                        <Flags flags={e.flags} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-4 pb-3 text-xs text-muted-foreground">None.</p>
            )}
          </section>
        );
      })}
      {r.anonymous ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Anonymous reads {r.anonymous.repos.length ? r.anonymous.repos.join(", ") : "no repo"} (auth.anonymousRead and each repo&apos;s anonymousRead).
        </p>
      ) : null}
    </>
  );
}

type Binding = AccessReport["users"][number]["bindings"][number];

/** A user's current groups in the report, each {name, expiresAt}. The proposed User.groups of the
 * users API, names only (docs/api-proposal.md), meets the report's in the generated type, which
 * so reads as both: the report's are objects. */
const memberships = (u: AccessReport["users"][number]) => u.groups as unknown as { name: string; expiresAt: string }[];

const bindingsText = (bindings: readonly Binding[]) =>
  bindings.length ? bindings.map((b) => `${b.role} on ${b.repoMask}${b.via ? ` via ${b.via}` : ""}`).join(" · ") : "no binding";

/** The entries of each section of the report, with what each has in words; a user's tokens are
 * entries of their own, flagged on their own. */
function entriesOf(r: AccessReport): { title: string; icon: ReactNode; entries: Entry[] }[] {
  const users: Entry[] = r.users.flatMap((u) => [
    {
      key: u.principal,
      who: <Principal value={u.principal} name={u.name} />,
      kind: `${u.kind}${u.disabled ? ", disabled" : ""}${u.lastSeenAt ? "" : ", never seen"}`,
      flags: u.flags,
      what: (
        <>
          {bindingsText(u.bindings)}
          {u.groups.length ? <span className="block text-muted-foreground">groups: {memberships(u).map((g) => g.name).join(", ")}</span> : null}
        </>
      ),
    },
    ...u.tokens.map((t) => ({
      key: `token:${t.id}`,
      who: (
        <span className="inline-flex items-center gap-1">
          <KeyRound className="size-3.5 text-muted-foreground" />
          {t.name}
        </span>
      ),
      kind: `token of ${u.name}`,
      flags: t.flags,
      what: <>{t.scopes.length ? t.scopes.join(", ") : "every right of its user"}{t.expiresAt ? `, expires ${formatDateTime(t.expiresAt)}` : ", no expiry"}</>,
    })),
  ]);
  const sections = [{ title: "Users and their tokens", icon: <Users className="size-4 text-muted-foreground" />, entries: users }];
  if (r.groups) {
    sections.push({
      title: "Groups",
      icon: <Users className="size-4 text-muted-foreground" />,
      entries: r.groups.map((g) => ({
        key: g.principal,
        who: <Principal value={g.principal} />,
        kind: pluralize(g.members.length, "member"),
        flags: g.flags,
        what: <>{bindingsText(g.bindings)}{g.members.length ? <span className="block text-muted-foreground">{g.members.map((m) => m.name).join(", ")}</span> : null}</>,
      })),
    });
  }
  if (r.workloads?.length) {
    sections.push({
      title: "Workloads",
      icon: <Workflow className="size-4 text-muted-foreground" />,
      entries: r.workloads.map((w) => ({ key: w.principal, who: <span className="font-mono">{w.principal}</span>, kind: w.pattern ? "pattern" : "principal", flags: w.flags, what: bindingsText(w.bindings) })),
    });
  }
  if (r.deployTokens) {
    sections.push({
      title: "Deploy tokens",
      icon: <KeyRound className="size-4 text-muted-foreground" />,
      entries: r.deployTokens.map((t) => ({
        key: `deploy:${t.id}`,
        who: <span>{t.name}</span>,
        kind: t.repoMask ? `over ${t.repoMask}` : `of ${t.repo}`,
        flags: t.flags,
        what: <>{t.scopes.join(", ")}{t.expiresAt ? `, expires ${formatDateTime(t.expiresAt)}` : ", no expiry"}{t.lastUsedAt ? "" : ", never used"}</>,
      })),
    });
  }
  if (r.ciPolicies) {
    sections.push({
      title: "CI trust policies",
      icon: <Workflow className="size-4 text-muted-foreground" />,
      entries: r.ciPolicies.map((p) => ({
        key: `ci:${p.source}:${p.name}`,
        who: (
          <Link to="/access" search={{ tab: "ci", policy: p.name }} className="text-primary hover:underline">
            {p.name}
          </Link>
        ),
        kind: `${p.source}, ${p.issuer}`,
        flags: p.flags,
        what: p.grants.map((g) => `${g.role} on ${g.mask}`).join(" · "),
      })),
    });
  }
  return sections;
}

/** Records the review of the report shown: its sha256, generatedAt and scope, and a note. */
function RecordReview({ report, sha256 }: { report: AccessReport; sha256: string }) {
  const id = useId();
  const [note, setNote] = useState("");
  const record = useMutation({
    mutationFn: () => recordAccessReview({ sha256, generatedAt: report.generatedAt, scope: report.scope, note }),
    ...realistic(["audit"]),
  });
  const bytes = new TextEncoder().encode(note).length;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    record.mutate(undefined, {
      onSuccess: () => {
        notify({ tone: "success", title: "Recorded the review", description: `Of the report ${sha256.slice(0, 12)}…, in the audit log as access.review.` });
        setNote("");
      },
    });
  };
  return (
    <Card>
      <CardHeader
        icon={<ClipboardCheck />}
        title="Record the review"
        description="An audit row that names the report above by its sha256: who reviewed it, when, and the note. It changes no access, and takes no reason."
      />
      <form onSubmit={submit} className="space-y-3 px-4 py-3">
        <Field label="Note" htmlFor={id} hint={`What was found and done, who acknowledged, the ticket. ${bytes} of 4096 bytes; line breaks allowed.`}>
          <Textarea id={id} value={note} rows={4} placeholder="CHG-2300: quarterly review of people. carol's admin binding removed; management acknowledged on the ticket." onChange={(e) => setNote(e.target.value)} />
        </Field>
        <FormError error={errorText(record.error)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!note.trim() || bytes > 4096 || record.isPending}>
            <ClipboardCheck />
            {record.isPending ? "Recording…" : "Record the review"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Of the report generated {formatDateTime(report.generatedAt)}, scope {report.scope}, sha256 <span className="font-mono">{sha256.slice(0, 12)}…</span>
          </span>
        </div>
      </form>
    </Card>
  );
}

/** The reviews recorded, newest first: GET /api/v1/audit?action=access.review. */
function PastReviews() {
  const reviews = useQuery(auditQuery({ action: "access.review" }));
  const rows = reviews.data?.events ?? [];
  return (
    <Card>
      <CardHeader
        icon={<ClipboardCheck />}
        title="Past reviews"
        description={
          <>
            The rows access.review of the{" "}
            <Link to="/audit" search={{ action: "access.review" }} className="text-primary hover:underline">
              audit log
            </Link>
            , newest first.
          </>
        }
      />
      {reviews.isError ? (
        <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : reviews.isPending ? (
        <div className="p-4">
          <Skeleton className="h-9" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck />} title="No review recorded yet" className="py-6" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>Report</TH>
              <TH>Note</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((e) => (
              <TR key={e.id}>
                <TD className="whitespace-nowrap text-muted-foreground">
                  <RelativeTime iso={e.at} />
                </TD>
                <TD>
                  <Principal value={e.principal} name={e.principalName} />
                </TD>
                <TD className="text-xs whitespace-nowrap">
                  <span className="font-mono">{String(e.details?.sha256 ?? "").slice(0, 12)}…</span>
                  <span className="block text-muted-foreground">
                    {String(e.details?.scope ?? "all")}, {formatDateTime(String(e.details?.generatedAt ?? ""))}
                  </span>
                </TD>
                <TD className="max-w-[28rem] text-xs whitespace-pre-line">{String(e.details?.note ?? "")}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
