import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { History } from "lucide-react";

import { auditQuery, reposQuery, usersQuery, type AuditParams } from "@/api/queries";
import type { AuditEvent } from "@/api/types";
import { CursorPagination, ErrorState, PageHeader, Principal, RelativeTime } from "@/components/common";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { EmptyState, Segmented, Skeleton } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { auditActions, auditStates } from "@/lib/audit";
import { shortDigest } from "@/lib/format";


function actionTone(action: string): BadgeProps["tone"] {
  if (action === "push") return "primary";
  if (action === "delete" || action === "proxy.reject" || /\.(delete|revoke|disable|drop)$/.test(action)) return "danger";
  if (action.startsWith("token.") || action.startsWith("binding.") || action.startsWith("key.")) return "warning";
  return "neutral";
}

/** What a row's state means (docs/operations.md, Audit). */
const stateHelp: Record<AuditEvent["state"], string> = {
  ok: "Done",
  pending: "A write to the registry that is still running",
  failed: "The write failed, and the client was answered with this error",
  unknown: "Its writer stopped before it knew the outcome",
};

const ranges = [
  { value: "all", label: "Any time" },
  { value: "1d", label: "24 h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

/** The start of a time range, rounded down to the minute so the query key stays stable. */
function sinceOf(range: string | undefined): string | undefined {
  const days = { "1d": 1, "7d": 7, "30d": 30 }[range ?? ""];
  if (!days) return undefined;
  const t = Date.now() - days * 86_400_000;
  return new Date(t - (t % 60_000)).toISOString();
}

type AuditSearch = { action?: string; principal?: string; repo?: string; state?: string; range?: string; cursor?: string };

export function AuditPage() {
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every write, control-plane change and token issuance, newest first; append-only. Reads are not audited."
      />
      <AuditTable />
    </>
  );
}

const selectClass =
  "h-7 cursor-pointer rounded-md border border-border bg-background px-2 text-xs text-foreground shadow-card outline-none focus-visible:border-primary";

/** The audit table with its filters; fixedRepo pins it to one repo (the repo's Activity tab). */
export function AuditTable({ fixedRepo }: { fixedRepo?: string }) {
  const search = useSearch({ strict: false }) as AuditSearch;
  const navigate = useNavigate();
  const repos = useQuery({ ...reposQuery, enabled: !fixedRepo });
  const users = useQuery(usersQuery);
  const set = (patch: Partial<AuditSearch>) =>
    void navigate({ to: ".", search: (p: AuditSearch) => ({ ...p, cursor: undefined, ...patch }), replace: true });

  const params: AuditParams = {
    action: search.action,
    principal: search.principal,
    repo: fixedRepo ?? search.repo,
    state: search.state,
    since: sinceOf(search.range),
    cursor: search.cursor,
  };
  const audit = useQuery(auditQuery(params));

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <select aria-label="Action" className={selectClass} value={search.action ?? ""} onChange={(e) => set({ action: e.target.value || undefined })}>
          <option value="">All actions</option>
          {auditActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          aria-label="Principal"
          className={selectClass}
          value={search.principal ?? ""}
          onChange={(e) => set({ principal: e.target.value || undefined })}
        >
          <option value="">Everyone</option>
          {principalOptions(users.data?.map((u) => u.name) ?? [], search.principal).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select aria-label="State" className={selectClass} value={search.state ?? ""} onChange={(e) => set({ state: e.target.value || undefined })}>
          <option value="">Any state</option>
          {auditStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {!fixedRepo ? (
          <select aria-label="Repository" className={selectClass} value={search.repo ?? ""} onChange={(e) => set({ repo: e.target.value || undefined })}>
            <option value="">All repositories</option>
            {repos.data?.map((r) => (
              <option key={r.prefix} value={r.prefix}>
                {r.prefix}
              </option>
            ))}
          </select>
        ) : null}
        <Segmented aria-label="Time range" value={search.range ?? "all"} onChange={(v) => set({ range: v === "all" ? undefined : v })} options={ranges} />
      </div>
      {audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : !audit.data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : audit.data.events.length === 0 ? (
        <EmptyState icon={<History />} title="No events" className="py-10">
          Nothing matches these filters.
        </EmptyState>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>When</TH>
              <TH>Who</TH>
              <TH>Action</TH>
              {!fixedRepo ? <TH>Repository</TH> : null}
              <TH>Subject</TH>
              <TH>Digest</TH>
              <TH>From</TH>
            </TR>
          </THead>
          <TBody>
            {audit.data.events.map((e) => (
              <AuditRow key={e.id} event={e} showRepo={!fixedRepo} />
            ))}
          </TBody>
        </Table>
      )}
      {audit.data ? (
        <CursorPagination
          shown={audit.data.events.length}
          next={audit.data.next}
          cursor={search.cursor}
          // Pushed, not replaced: the browser's Back is the page before.
          onCursor={(cursor) => void navigate({ to: ".", search: (p: AuditSearch) => ({ ...p, cursor }) })}
          noun="events"
        />
      ) : null}
    </Card>
  );
}

/** Users by name, which the server takes as `user:<name>`, and anonymous; the filter set from a
 * link, such as `token:12`, stays in the list. */
function principalOptions(names: string[], current: string | undefined): string[] {
  const options = [...names.map((n) => `user:${n}`), "anonymous"];
  return current && !options.includes(current) ? [current, ...options] : options;
}

function AuditRow({ event: e, showRepo }: { event: AuditEvent; showRepo: boolean }) {
  const details = Object.entries(e.details ?? {})
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n");
  const [format, repo] = e.repo ? (e.repo.split("/") as [string, string]) : ["", ""];
  return (
    <TR>
      <TD className="text-muted-foreground">
        <RelativeTime iso={e.at} />
      </TD>
      <TD>
        <Principal value={e.principal} name={e.principalName} />
      </TD>
      <TD>
        <span className="flex items-center gap-1">
          <Tooltip content={details ? <pre className="font-mono text-[11px] whitespace-pre-wrap">{details}</pre> : null}>
            <span>
              <Badge tone={actionTone(e.action)} shape="square" className="font-mono">
                {e.action}
              </Badge>
            </span>
          </Tooltip>
          {e.state !== "ok" ? (
            <Tooltip content={stateHelp[e.state] + (e.error ? `: ${e.error}` : "")}>
              <span>
                <Badge tone={e.state === "failed" ? "danger" : "warning"}>{e.state}</Badge>
              </span>
            </Tooltip>
          ) : null}
        </span>
      </TD>
      {showRepo ? (
        <TD>
          {e.repo ? (
            <Link to="/$format/$repo" params={{ format, repo }} className="font-mono text-xs text-primary hover:underline">
              {e.repo}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">system</span>
          )}
        </TD>
      ) : null}
      <TD className="max-w-[20rem]">
        {e.subject ? (
          <span className="block truncate font-mono text-xs" title={e.subject}>
            {e.subject}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TD>
      <TD>{e.digest ? <CopyText value={e.digest} display={shortDigest(e.digest, 8)} label="digest" /> : <span className="text-muted-foreground">—</span>}</TD>
      <TD className="font-mono text-xs text-muted-foreground">{e.ip ?? "—"}</TD>
    </TR>
  );
}
