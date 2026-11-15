import type { FormatName, Repo, ServerInfo } from "@/api/types";

import { apt } from "./apt";
import { generic } from "./generic";
import { maven } from "./maven";
import { npm } from "./npm";
import { oci } from "./oci";
import { pypi } from "./pypi";
import { raw } from "./raw";
import { rpm } from "./rpm";
import type { FormatSpec, SnippetContext, SnippetGroup } from "./types";

export const formats: Record<FormatName, FormatSpec> = { raw, pypi, apt, maven, npm, rpm };

/** Formats in the order of the roadmap: raw → pypi → apt → maven → npm (M4) → rpm (M6). */
export const formatOrder: FormatName[] = ["raw", "pypi", "apt", "maven", "npm", "rpm"];

/** The module of a format; a format the UI does not know gets the generic one: names, versions
 * and files, no snippets. */
export function formatSpec(name: string): FormatSpec {
  if (name === "oci") return oci;
  return isFormat(name) ? formats[name] : generic(name);
}

export function isFormat(name: string): name is FormatName {
  return Object.hasOwn(formats, name);
}

export function snippetContext(
  info: ServerInfo | undefined,
  repo: Repo,
  facets?: SnippetContext["facets"],
): SnippetContext {
  const baseUrl = (info?.externalURL || window.location.origin).replace(/\/+$/, "");
  return {
    baseUrl,
    host: new URL(baseUrl).host,
    repo,
    readNeedsAuth: !(repo.anonymousRead && (info?.anonymousRead ?? false)),
    facets,
  };
}

/** How to configure a client for the repo: the format's snippets, without those that publish on
 * a proxy or a group, which take no publish of their own (docs/spec/proxy-and-group.md §1). */
export function connectFor(spec: FormatSpec, ctx: SnippetContext): SnippetGroup[] {
  const groups = spec.connect(ctx);
  if ((ctx.repo.kind ?? "hosted") === "hosted") return groups;
  return groups
    .filter((g) => !g.publish)
    .map((g) => ({ ...g, snippets: g.snippets.filter((s) => !s.publish) }))
    .filter((g) => g.snippets.length > 0);
}

export type { FormatSpec, Snippet, SnippetContext, SnippetGroup, MetadataRow } from "./types";
