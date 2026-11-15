// What a proxy and a group are (docs/spec/proxy-and-group.md): the kind in the list and the
// header, a proxy's upstream, a group's members in order with its merged names or its routes.

import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CloudDownload, Database, Layers, PackageOpen, Route, WifiOff } from "lucide-react";
import { Fragment } from "react";

import { reposQuery } from "@/api/queries";
import type { Repo } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Properties, Property } from "@/components/ui/misc";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import type { FormatSpec } from "@/lib/formats";

const kindIcon = { hosted: Database, proxy: CloudDownload, group: Layers } as const;

/** What the kind means for this repo, one sentence. */
function kindText(repo: Repo): string {
  if (repo.kind === "proxy") {
    return `A proxy of the upstream ${repo.upstream?.name ?? "?"}: it fetches what it does not hold and keeps it in the registry${repo.upstream?.offline ? ". Offline now: it asks the upstream nothing" : ""}.`;
  }
  if (repo.kind === "group") return `A group of ${repo.group?.members.join(", ") ?? "?"}: one address for its members; it holds nothing itself.`;
  return "A hosted repo: it holds what is published to it.";
}

/** The kind of a repo as a badge; nothing for a hosted repo unless `always`. */
export function KindBadge({ repo, always = false }: { repo: Repo; always?: boolean }) {
  if (repo.kind === "hosted" && !always) return null;
  const Icon = kindIcon[repo.kind];
  return (
    <Tooltip content={kindText(repo)}>
      <Badge tone={repo.kind === "hosted" ? "outline" : "primary"}>
        <Icon />
        {repo.kind}
        {repo.upstream?.offline ? <WifiOff /> : null}
      </Badge>
    </Tooltip>
  );
}

/** A repo of the caller's list, linked; one it cannot read, as a plain name. */
function RepoName({ format, name, readable }: { format: string; name: string; readable: boolean }) {
  if (!readable) {
    return (
      <Tooltip content="You cannot read this repo at its own URL; through the group you read what the group sends to it.">
        <span className="font-mono">{name}</span>
      </Tooltip>
    );
  }
  return (
    <Link to="/$format/$repo" params={{ format, repo: name }} className="font-mono text-primary hover:underline">
      {name}
    </Link>
  );
}

/** "a proxy of the upstream X, stored in Y" or "a group of A, B, C", for the header. */
export function KindSummary({ repo }: { repo: Repo }) {
  const repos = useQuery(reposQuery);
  const readable = new Set(repos.data?.map((r) => r.prefix));
  if (repo.kind === "group") {
    const members = repo.group?.members ?? [];
    return (
      <>
        a group of{" "}
        {members.map((m, i) => (
          <Fragment key={m}>
            {i > 0 ? ", " : null}
            <RepoName format={repo.format} name={m} readable={readable.has(`${repo.format}/${m}`)} />
          </Fragment>
        ))}
      </>
    );
  }
  return (
    <>
      {repo.kind === "proxy" ? (
        <>
          a proxy of the upstream <span className="font-mono text-foreground">{repo.upstream?.name}</span>
          {repo.upstream?.offline ? <span className="text-warning"> (offline)</span> : null},{" "}
        </>
      ) : null}
      stored in <span className="font-mono text-foreground">{repo.registry}</span>
    </>
  );
}

function Patterns({ list, empty }: { list: string[] | undefined; empty: string }) {
  if (!list?.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((p) => (
        <Badge key={p} tone="outline" shape="square" className="font-mono">
          {p}
        </Badge>
      ))}
    </span>
  );
}

/** A duration of the upstream's settings, and what 0s means for it. */
function Ttl({ value, zero }: { value: string | undefined; zero: string }) {
  if (value === undefined) return <span className="text-muted-foreground">the default</span>;
  return (
    <>
      <span className="font-mono">{value}</span>
      {/^0+[a-zµ]*$/.test(value) ? <span className="ml-1 text-xs text-muted-foreground">({zero})</span> : null}
    </>
  );
}

/** A proxy's upstream (proxy-and-group.md §2.2): its name, the TTLs of its cache, offline, and
 * the names it mirrors. The URL and the credentials are the configuration's, never the API's. */
export function UpstreamCard({ repo, className }: { repo: Repo; className?: string }) {
  const u = repo.upstream;
  if (!u) return null;
  const oci = repo.format === "oci";
  return (
    <Card className={className}>
      <CardHeader
        icon={<CloudDownload />}
        title="Upstream"
        description="What the proxy asks for what it does not hold, and how long it keeps the answers. Its URL and credentials are the server's configuration."
      />
      <CardBody>
        <Properties>
          <Property label="Upstream">
            <span className="font-mono">{u.name}</span>
          </Property>
          <Property label="Metadata TTL">
            <Ttl value={u.metadataTTL} zero="asks again on every read" />
            <span className="ml-1 text-xs text-muted-foreground">{oci ? "a tag's digest is used this long" : "a cached document is used this long"}</span>
          </Property>
          <Property label="Negative TTL">
            <Ttl value={u.negativeTTL} zero="keeps no negative entry" />
            <span className="ml-1 text-xs text-muted-foreground">what the upstream does not have is remembered this long</span>
          </Property>
          <Property label="Offline">
            {u.offline ? (
              <span className="text-warning">yes: it asks the upstream nothing and serves what it holds</span>
            ) : (
              "no"
            )}
          </Property>
          <Property label="Mirrors">
            <Patterns list={u.allow} empty={oci ? "every path" : "every name"} />
          </Property>
          <Property label="Never fetches">
            <Patterns list={u.deny} empty="nothing refused" />
          </Property>
        </Properties>
        <p className="mt-3 text-xs text-muted-foreground">
          {oci ? "A path" : "A name"} is fetched when Mirrors is empty or one of its patterns matches it, and no pattern of Never fetches does. *
          matches any run of characters{oci ? " within one component of the path" : ""}, ignoring case.
        </p>
      </CardBody>
    </Card>
  );
}

/** A group's members in order, each linked, with the merged names, or an oci group's routes
 * (proxy-and-group.md §2.3, §8, §12). */
export function MembersCard({ repo, className }: { repo: Repo; className?: string }) {
  const repos = useQuery(reposQuery);
  const g = repo.group;
  if (!g) return null;
  const oci = repo.format === "oci";
  const byName = new Map(repos.data?.filter((r) => r.format === repo.format).map((r) => [r.name, r]));
  return (
    <Card className={className}>
      <CardHeader
        icon={<Layers />}
        title="Members"
        description={
          oci
            ? "Each path comes from the one member whose pattern is the most specific: the path itself, then the longest prefix, then *. No other member is asked."
            : "Read in this order: the union of their versions, the first member's entry for a version several have. A name the hosted member holds hides the proxies' versions of it, but for the merged names."
        }
      />
      <Table>
        <THead>
          <TR>
            <TH className="w-0">#</TH>
            <TH>Member</TH>
            <TH>Kind</TH>
            {oci ? <TH>Paths</TH> : null}
          </TR>
        </THead>
        <TBody>
          {g.members.map((m, i) => {
            const member = byName.get(m);
            return (
              <TR key={m}>
                <TD className="text-muted-foreground tabular">{i + 1}</TD>
                <TD>
                  <span className="text-muted-foreground">{repo.format}/</span>
                  <RepoName format={repo.format} name={m} readable={member !== undefined} />
                </TD>
                <TD>{member ? <KindBadge repo={member} always /> : <span className="text-muted-foreground">—</span>}</TD>
                {oci ? (
                  <TD>
                    <Patterns list={g.paths?.[m]} empty="no route: no path reaches it" />
                  </TD>
                ) : null}
              </TR>
            );
          })}
        </TBody>
      </Table>
      {oci ? null : (
        <CardBody className="border-t border-border">
          <Properties>
            <Property label="Merged names">
              <Patterns list={g.merge} empty="none: a name the hosted member holds hides the proxies' versions of it" />
            </Property>
          </Properties>
        </CardBody>
      )}
    </Card>
  );
}

/** The packages tab of a proxy or a group that lists nothing: what it does instead. */
export function KindEmpty({ repo, spec }: { repo: Repo; spec: FormatSpec }) {
  if (repo.kind === "group") {
    return (
      <EmptyState icon={<Route />} title="A group holds nothing of its own" className="py-10">
        Its members' {spec.noun.many} are read through it{repo.format === "oci" ? ", each path from the member its routes choose" : ", in the order of its members"}. A
        group takes no publish here.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={<PackageOpen />} title={`No ${spec.noun.many} held yet`} className="py-10">
      A request for something the repo does not hold fetches it from the upstream {repo.upstream?.name} and keeps it in the registry. A maintainer can
      prefetch a list ahead of the clients, on the Maintenance tab.
    </EmptyState>
  );
}
