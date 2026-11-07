import { Link } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Globe, KeyRound, Lock, RefreshCw, ShieldCheck, User, UserX } from "lucide-react";
import type { ReactNode } from "react";

import { ApiError } from "@/api/client";
import type { FormatName, Repo } from "@/api/types";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import { formatSpec } from "@/lib/formats";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/misc";
import { Tooltip } from "./ui/tooltip";

export function FormatMark({ format, className }: { format: FormatName | string; className?: string }) {
  const spec = formatSpec(format);
  return (
    <Tooltip content={`${spec.label} repository`}>
      <span
        className={cn(
          "inline-flex h-5 min-w-8 shrink-0 items-center justify-center rounded px-1 font-mono text-[10px] font-bold tracking-wide",
          spec.markClass,
          className,
        )}
      >
        {spec.mark}
      </span>
    </Tooltip>
  );
}

export function RelativeTime({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <Tooltip content={formatDateTime(iso)}>
      <time dateTime={iso} className={cn("whitespace-nowrap", className)}>
        {formatRelative(iso)}
      </time>
    </Tooltip>
  );
}

/** A principal in canonical form (rbac.md §1): user:alice, token:12, anonymous. */
export function Principal({ value, className }: { value: string | null | undefined; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const [kind, name] = value.includes(":") ? (value.split(":", 2) as [string, string]) : [value, ""];
  const Icon = kind === "token" ? KeyRound : kind === "anonymous" ? UserX : User;
  const label = kind === "token" ? `deploy token #${name}` : kind === "anonymous" ? "anonymous" : name;
  return (
    <Tooltip content={value}>
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}>
        <Icon className="size-3.5 text-muted-foreground" />
        {label}
      </span>
    </Tooltip>
  );
}

export function AccessBadge({ repo }: { repo: Pick<Repo, "anonymousRead"> }) {
  return repo.anonymousRead ? (
    <Tooltip content="Anonymous read: clients need no credentials to download">
      <Badge tone="success">
        <Globe />
        Public
      </Badge>
    </Tooltip>
  ) : (
    <Tooltip content="Every request needs credentials: a user and token, or a deploy token">
      <Badge tone="neutral">
        <Lock />
        Private
      </Badge>
    </Tooltip>
  );
}

export function SignedBadge({ count, compact = false }: { count: number; compact?: boolean }) {
  if (!count) return null;
  return (
    <Tooltip content={`${count} signature${count > 1 ? "s" : ""} attached as OCI referrers`}>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <ShieldCheck className="size-3.5" />
        {compact ? null : "Signed"}
      </span>
    </Tooltip>
  );
}

export type Crumb = { label: ReactNode; to?: string; params?: Record<string, string>; search?: Record<string, unknown> };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 ? <ChevronRight className="size-3.5 shrink-0 opacity-60" /> : null}
          {c.to ? (
            <Link
              to={c.to}
              params={c.params as never}
              search={c.search as never}
              className="truncate rounded hover:text-foreground hover:underline"
            >
              {c.label}
            </Link>
          ) : (
            <span className="truncate text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

type PageHeaderProps = {
  crumbs?: Crumb[];
  title: ReactNode;
  icon?: ReactNode;
  badges?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ crumbs, title, icon, badges, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-5">
      {crumbs ? <Breadcrumbs items={crumbs} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {icon}
            <h1 className="min-w-0 text-xl font-semibold tracking-tight break-all">{title}</h1>
            {badges}
          </div>
          {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const api = error instanceof ApiError ? error : null;
  if (api?.status === 404) {
    return (
      <EmptyState className={className} icon={<AlertTriangle />} title="Not found">
        {api.message}. It may have been deleted, or you may not have access to it.
      </EmptyState>
    );
  }
  if (api?.status === 403) {
    return (
      <EmptyState className={className} icon={<Lock />} title="Not allowed">
        {api.message}
      </EmptyState>
    );
  }
  return (
    <EmptyState
      className={className}
      icon={<AlertTriangle />}
      title="Something went wrong"
      action={
        onRetry ? (
          <Button onClick={onRetry}>
            <RefreshCw />
            Try again
          </Button>
        ) : null
      }
    >
      {api ? `${api.code}: ${api.message}` : error instanceof Error ? error.message : "Unknown error"}
    </EmptyState>
  );
}

type PaginationProps = {
  total: number;
  limit: number;
  shown: number;
  next: string | null;
  prev: string | null;
  /** Index of the first row on this page, counted from 0. */
  start: number;
  onCursor: (cursor: string | undefined) => void;
  noun?: string;
};

export function Pagination({ total, shown, next, prev, start, onCursor, noun = "items" }: PaginationProps) {
  if (total === 0 || (!next && !prev)) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span className="tabular">
        {shown === total ? `${total} ${noun}` : `${start + 1}–${start + shown} of ${total} ${noun}`}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" disabled={!prev} onClick={() => onCursor(prev ?? undefined)}>
          Previous
        </Button>
        <Button size="sm" disabled={!next} onClick={() => onCursor(next ?? undefined)}>
          Next
        </Button>
      </div>
    </div>
  );
}
