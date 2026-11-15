// The report of a reindex run on the repo's Maintenance tab: its counts, then a table for each
// list that has entries (ReindexRun.report in the server's openapi.yaml; docs/operations.md,
// Reindex, says what a run does).

import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { ReindexDrift, ReindexFinding, ReindexReport, ReindexRepositoryUnknown, ReindexSplit, RepairedReferrersIndex } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { CopyText } from "@/components/ui/code-block";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatNumber, shortDigest } from "@/lib/format";

import { isCut, MAX_FINDINGS, reportCounts, reportFindings, reportRepo, shortTag, type FindingKey, type FindingSection } from "./reindex-report-model";

const sectionId = (key: FindingKey) => `reindex-${key}`;

/** The counts of a report, the lists that have entries, and whether the lists stopped. */
export function ReindexSummary({ report }: { report: ReindexReport }) {
  const counts = reportCounts(report);
  const findings = reportFindings(report);
  const warned = counts.filter((c) => c.warn);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {counts.map((c) => (
          <div key={c.label} className="rounded-md border border-border px-3 py-2">
            <dt className="text-xs text-muted-foreground">
              <Tooltip content={c.hint} wrap>
                <span className="cursor-help">{c.label}</span>
              </Tooltip>
            </dt>
            <dd className={cn("text-base font-semibold tabular", c.warn && "text-warning")}>{formatNumber(c.value)}</dd>
          </div>
        ))}
      </dl>
      {warned.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {warned.map((c) => (
            <li key={c.label}>
              <span className="font-medium text-foreground">{c.label}:</span> {c.hint.charAt(0).toLowerCase() + c.hint.slice(1)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
        {findings.length ? (
          <>
            <span className="text-muted-foreground">Found</span>
            {findings.map((f) => (
              <FindingChip key={f.key} finding={f} />
            ))}
          </>
        ) : (
          <span className="text-muted-foreground">
            No errors, drift, split packages, unknown repositories, foreign manifests or orphans.
          </span>
        )}
      </div>
      {report.truncated ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          The lists stop at {formatNumber(MAX_FINDINGS)} entries each, and at least one did: those marked + are not complete. The
          counts are exact.
        </p>
      ) : null}
    </>
  );
}

function FindingChip({ finding: f }: { finding: FindingSection }) {
  return (
    <button
      type="button"
      onClick={() => document.getElementById(sectionId(f.key))?.scrollIntoView({ block: "start" })}
      className="cursor-pointer rounded-full"
    >
      <Badge tone={f.tone} className="hover:underline">
        {f.label}
        <span className="tabular">
          {formatNumber(f.count)}
          {f.cut ? "+" : ""}
        </span>
      </Badge>
    </button>
  );
}

/** A table for each list of the report that has entries, in the order of the summary. */
export function ReindexFindings({ report }: { report: ReindexReport }) {
  const { format, name } = reportRepo(report);
  const table: Record<FindingKey, () => ReactNode> = {
    errors: () => <FindingTable findings={report.errors} columns={["repository", "tag", "digest", "error"]} />,
    drift: () => <DriftTable drift={report.drift} format={format} repo={name} />,
    split: () => <SplitTable split={report.split ?? []} format={format} repo={name} truncated={report.truncated} />,
    repositoryUnknown: () => <UnknownTable versions={report.repositoryUnknown ?? []} format={format} repo={name} />,
    foreign: () => <FindingTable findings={report.foreign} columns={["repository", "tag", "digest", "type"]} />,
    orphanReferrers: () => <FindingTable findings={report.orphanReferrers} columns={["repository", "tag", "digest", "subject", "type"]} />,
    orphanJournal: () => <FindingTable findings={report.orphanJournal ?? []} columns={["repository", "tag", "digest", "type"]} />,
    repairedReferrers: () => <RepairedTable indexes={report.repairedReferrers ?? []} />,
  };
  return (
    <>
      {reportFindings(report).map((f) => (
        <section key={f.key} id={sectionId(f.key)} aria-labelledby={`${sectionId(f.key)}-title`} className="scroll-mt-28 border-t border-border">
          <h3 id={`${sectionId(f.key)}-title`} className="flex items-center gap-2 px-4 pt-3 pb-1 text-sm font-medium">
            {f.label}
            <Badge tone={f.tone}>
              {formatNumber(f.count)}
              {f.cut ? "+" : ""}
            </Badge>
          </h3>
          <p className="max-w-4xl px-4 pb-2 text-xs text-muted-foreground">{explanations[f.key]}</p>
          {table[f.key]()}
        </section>
      ))}
    </>
  );
}

/** What each list holds, and what to do about it (docs/operations.md, Reindex). */
const explanations: Record<FindingKey, ReactNode> = {
  errors: "What the run could not read, check or write, each with its error. An entry without an OCI repository is a failure of the whole repo.",
  drift: (
    <>
      Tags that name another manifest in the registry than in the index, re-pointed past Lajstrom. The index keeps its digest and
      serves it; Lajstrom never re-points a tag, so whoever re-pointed it decides which one is right.
    </>
  ),
  split: (
    <>
      Packages stored at two forms of their OCI name (ADR 0017). The versions at the other form are served from there, a tag at both
      forms from the indexed one; a run copies or moves nothing. To keep one, copy each tag of the other form into the indexed one (
      <code className="font-mono">oras cp</code>), then delete the other form in the registry.
    </>
  ),
  repositoryUnknown: (
    <>
      Versions whose OCI repository the registry does not know, as after a delete of the repository in the registry's console. Prune
      keeps their rows and every run lists them, until the repository comes back or the version is deleted through the API: the
      request of each row, or Delete on the version's page.
    </>
  ),
  foreign: (
    <>
      Found under this repo's path in the registry but not written by Lajstrom: they have no{" "}
      <code className="font-mono">lajstrom.schema</code> annotation, and are never indexed or served.
    </>
  ),
  orphanReferrers: "Signatures, SBOMs and attestations whose subject no version of the repo has: counted, and attached to nothing.",
  orphanJournal: (
    <>
      Journal entries (npm dist-tags and deprecations, pypi yanks) in an OCI repository without versions, such as a pypi package's
      after its last version was deleted: not indexed, and adopted by the next entry appended to a package of that name.
    </>
  ),
  repairedReferrers: (
    <>
      The <code className="font-mono">sha256-&lt;hex&gt;</code> indexes of subjects that lacked referrers the audit log has as
      pushed, or were missing, pushed again with them: on a registry without the referrers API.
    </>
  ),
};

type Column = "repository" | "tag" | "digest" | "subject" | "type" | "error";

const columnTitles: Record<Column, string> = {
  repository: "OCI repository",
  tag: "Tag",
  digest: "Digest",
  subject: "Subject",
  type: "Type",
  error: "Error",
};

function FindingTable({ findings, columns }: { findings: ReindexFinding[]; columns: Column[] }) {
  const cell: Record<Column, (f: ReindexFinding) => ReactNode> = {
    repository: (f) =>
      f.repository ? (
        <span className="font-mono text-xs whitespace-nowrap">{f.repository}</span>
      ) : (
        <span className="text-xs whitespace-nowrap text-muted-foreground">the whole repo</span>
      ),
    tag: (f) => (f.tag ? <CopyText value={f.tag} display={shortTag(f.tag)} label="tag" className="text-xs" /> : null),
    digest: (f) => (f.digest ? <CopyText value={f.digest} display={shortDigest(f.digest)} label="digest" /> : null),
    subject: (f) => (f.subject ? <CopyText value={f.subject} display={shortDigest(f.subject)} label="subject" /> : null),
    type: (f) => (
      <span className="font-mono text-xs text-muted-foreground" title={[f.artifactType, f.mediaType].filter(Boolean).join("\n")}>
        {f.artifactType || f.mediaType}
      </span>
    ),
    error: (f) => <span className="block min-w-64 text-xs break-words">{f.error}</span>,
  };
  return (
    <Table>
      <THead>
        <TR>
          {columns.map((c) => (
            <TH key={c}>{columnTitles[c]}</TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {findings.map((f, i) => (
          <TR key={i}>
            {columns.map((c) => (
              <TD key={c} className={c === "error" ? "align-top" : undefined}>
                {cell[c](f)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function PackageLink({ format, repo, name }: { format: string; repo: string; name: string }) {
  return (
    <Link to="/$format/$repo/$" params={{ format, repo, _splat: name }} className="font-medium text-primary hover:underline">
      {name}
    </Link>
  );
}

function DriftTable({ drift, format, repo }: { drift: ReindexDrift[]; format: string; repo: string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Package</TH>
          <TH>Tag</TH>
          <TH>The index has</TH>
          <TH>The registry's tag names</TH>
        </TR>
      </THead>
      <TBody>
        {drift.map((d) => (
          <TR key={`${d.package}:${d.tag}`}>
            <TD>
              <PackageLink format={format} repo={repo} name={d.package} />
            </TD>
            <TD>
              <CopyText value={d.tag} label="tag" className="text-xs" />
            </TD>
            <TD>
              <CopyText value={d.index} display={shortDigest(d.index)} label="digest" />
            </TD>
            <TD>
              <CopyText value={d.registry} display={shortDigest(d.registry)} label="digest" className="text-warning" />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** A form of a package's OCI name and the tags there; a long list shows its first tags. */
function FormCell({ path, tags, cut }: { path: string; tags: string[]; cut: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = open ? tags : tags.slice(0, 4);
  return (
    <div className="space-y-1">
      <CopyText value={path} label="OCI name" className="text-xs" />
      <div className="flex flex-wrap items-center gap-1">
        {shown.map((t) => (
          <Badge key={t} tone="outline" shape="square" className="font-mono font-normal">
            {t}
          </Badge>
        ))}
        {tags.length > shown.length ? (
          <button type="button" onClick={() => setOpen(true)} className="cursor-pointer text-xs text-primary hover:underline">
            {formatNumber(tags.length - shown.length)} more
          </button>
        ) : null}
        {cut ? <span className="text-xs text-muted-foreground">and more, not listed</span> : null}
        {!tags.length ? <span className="text-xs text-muted-foreground">no tags</span> : null}
      </div>
    </div>
  );
}

function SplitTable({ split, format, repo, truncated }: { split: ReindexSplit[]; format: string; repo: string; truncated: boolean }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Package</TH>
          <TH>Indexed form, and its tags</TH>
          <TH>Other form, and its tags</TH>
        </TR>
      </THead>
      <TBody>
        {split.map((s) => (
          <TR key={`${s.package}:${s.other}`}>
            <TD className="align-top">
              <PackageLink format={format} repo={repo} name={s.package} />
            </TD>
            <TD className="align-top">
              <FormCell path={s.indexed} tags={s.indexedTags} cut={isCut({ truncated }, s.indexedTags)} />
            </TD>
            <TD className="align-top">
              <FormCell path={s.other} tags={s.otherTags} cut={isCut({ truncated }, s.otherTags)} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

/** A request line that may wrap after each "/" and before its query. */
function breakable(request: string): ReactNode {
  return request.split(/(?<=\/)|(?=\?)/).map((part, i) => (
    <span key={i}>
      {i ? <wbr /> : null}
      {part}
    </span>
  ));
}

function UnknownTable({ versions, format, repo }: { versions: ReindexRepositoryUnknown[]; format: string; repo: string }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Version</TH>
          <TH>OCI repository and tag</TH>
          <TH>Digest</TH>
          <TH>The request that deletes it</TH>
        </TR>
      </THead>
      <TBody>
        {versions.map((v) => (
          <TR key={v.digest}>
            <TD className="whitespace-nowrap">
              <Link
                to="/$format/$repo/$"
                params={{ format, repo, _splat: `${v.package}/-/${v.version}` }}
                search={v.variant ? { variant: v.variant } : {}}
                className="font-medium text-primary hover:underline"
              >
                {v.package} {format === "raw" ? shortDigest(v.version, 8) : v.version}
              </Link>
              {v.variant ? <div className="font-mono text-xs text-muted-foreground">{v.variant}</div> : null}
            </TD>
            <TD>
              <CopyText value={`${v.repository}:${v.tag}`} label="reference" className="text-xs" />
            </TD>
            <TD>
              <CopyText value={v.digest} display={shortDigest(v.digest)} label="digest" />
            </TD>
            <TD>
              <CopyText
                value={v.delete}
                display={<span className="whitespace-normal">{breakable(v.delete)}</span>}
                label="request"
                className="min-w-72 text-xs text-muted-foreground"
              />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function RepairedTable({ indexes }: { indexes: RepairedReferrersIndex[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>OCI repository</TH>
          <TH>Subject</TH>
          <TH>Index</TH>
          <TH>Referrers added</TH>
        </TR>
      </THead>
      <TBody>
        {indexes.map((x) => (
          <TR key={x.index}>
            <TD className="font-mono text-xs whitespace-nowrap">{x.repository}</TD>
            <TD>
              <CopyText value={x.subject} display={shortDigest(x.subject)} label="subject" />
            </TD>
            <TD>
              <CopyText value={x.index} display={shortDigest(x.index)} label="index" />
            </TD>
            <TD className="tabular">{x.added.length}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
