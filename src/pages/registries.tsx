import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Minus, Server } from "lucide-react";

import { registriesQuery } from "@/api/queries";
import type { Capabilities, Registry } from "@/api/types";
import { ErrorState, PageHeader, RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyText } from "@/components/ui/code-block";
import { Properties, Property, Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";

// What each capability means for Lajstrom, and the fallback when it is missing
// (docs/architecture.md §5, internal/provider/provider.go).
const capabilityInfo: { key: keyof Omit<Capabilities, "maxBlobSize">; label: string; yes: string; no: string; fallback: string }[] = [
  {
    key: "createOnPush",
    label: "Create on push",
    yes: "Pushing to a new repository creates it.",
    no: "The adapter creates each repository first (EnsureRepository), e.g. ECR CreateRepository.",
    fallback: "adapter creates repos",
  },
  {
    key: "referrers",
    label: "Referrers API",
    yes: "Signatures and SBOMs are listed with the OCI 1.1 referrers API.",
    no: "Falls back to the sha256-<digest> tag schema, as cosign does.",
    fallback: "tag-schema fallback",
  },
  {
    key: "catalog",
    label: "Repository listing",
    yes: "Reindex lists repositories through the registry's catalog.",
    no: "No catalog: reindex uses the oci_repos table and the adapter's own listing.",
    fallback: "via oci_repos",
  },
  {
    key: "deleteManifest",
    label: "Delete manifests",
    yes: "Versions can be deleted; blob GC stays the registry's job.",
    no: "DELETE answers 405 UNSUPPORTED with a message about the backend.",
    fallback: "delete → 405",
  },
  {
    key: "immutableTags",
    label: "Immutable tags",
    yes: "The registry itself refuses to re-point a tag, on top of Lajstrom's 409.",
    no: "Only Lajstrom enforces append-only tags (409 on a different digest).",
    fallback: "Lajstrom enforces",
  },
  {
    key: "blobRedirect",
    label: "Blob redirect",
    yes: "Downloads get a 307 to the registry's storage (S3); bytes bypass Lajstrom.",
    no: "Lajstrom streams every download.",
    fallback: "streamed",
  },
];

const supportLabel: Record<Registry["support"], { label: string; tone: "success" | "primary" | "neutral" }> = {
  ci: { label: "tested in CI", tone: "success" },
  manual: { label: "tested manually", tone: "primary" },
  untested: { label: "untested", tone: "neutral" },
};

function StatusDot({ state }: { state: Registry["status"]["state"] }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        state === "ok" && "bg-success",
        state === "degraded" && "bg-warning",
        state === "down" && "bg-danger",
      )}
    />
  );
}

export function RegistriesPage() {
  const regs = useQuery(registriesQuery);
  return (
    <>
      <PageHeader
        title="Registries"
        description="The OCI registries that hold every byte. Lajstrom keeps only the index; what each backend can do decides which fallbacks apply."
      />
      {regs.isError ? (
        <Card>
          <ErrorState error={regs.error} onRetry={() => void regs.refetch()} />
        </Card>
      ) : !regs.data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {regs.data.map((r) => (
            <Card key={r.name} className="flex flex-col">
              <CardHeader
                icon={<Server />}
                title={<span className="font-mono">{r.name}</span>}
                description={r.product}
                actions={<Badge tone={supportLabel[r.support].tone}>{supportLabel[r.support].label}</Badge>}
              />
              <CardBody className="space-y-4">
                <div className="flex items-start gap-2 rounded-md bg-surface px-3 py-2 text-sm">
                  <span className="mt-1.5">
                    <StatusDot state={r.status.state} />
                  </span>
                  <div>
                    <div>
                      <span className="font-medium">{r.status.state === "ok" ? "Reachable" : r.status.state === "degraded" ? "Degraded" : "Down"}</span>
                      {r.status.latencyMs !== null ? <span className="text-muted-foreground"> · /v2/ in {r.status.latencyMs} ms</span> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.status.message ? `${r.status.message} · ` : null}checked <RelativeTime iso={r.status.checkedAt} />; /-/readyz needs an answer within 60 s
                    </div>
                  </div>
                </div>
                <Properties className="grid-cols-[6.5rem_1fr]">
                  <Property label="Type">{r.type}</Property>
                  <Property label="URL">
                    <CopyText value={r.url} />
                  </Property>
                  <Property label="Prefix">
                    <span className="font-mono text-[12.5px]">{r.prefix || "—"}</span>
                  </Property>
                  <Property label="Max blob">{r.capabilities.maxBlobSize ? formatBytes(r.capabilities.maxBlobSize) : "unknown"}</Property>
                  <Property label="Repos">
                    {r.repos.length ? (
                      <span className="flex flex-wrap gap-x-2">
                        {r.repos.map((key) => {
                          const [format, repo] = key.split("/") as [string, string];
                          return (
                            <Link key={key} to="/$format/$repo" params={{ format, repo }} className="font-mono text-[12.5px] text-primary hover:underline">
                              {key}
                            </Link>
                          );
                        })}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Property>
                </Properties>
                <ul className="space-y-1.5 border-t border-border pt-3">
                  {capabilityInfo.map((c) => {
                    const on = r.capabilities[c.key];
                    return (
                      <li key={c.key} className="flex items-start gap-2 text-sm">
                        {on ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                        <Tooltip content={on ? c.yes : c.no}>
                          <span className={cn("cursor-help", !on && "text-muted-foreground")}>{c.label}</span>
                        </Tooltip>
                        {!on ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{c.fallback}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Capabilities come from the spikes of M0-11…M0-15 (docs/registries/); registries are configured in lajstrom.yaml, not through the API.
      </p>
    </>
  );
}
