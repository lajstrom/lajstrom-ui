import type { FormatName, Repo, ServerInfo } from "@/api/types";

import { apt } from "./apt";
import { maven } from "./maven";
import { oci } from "./oci";
import { pypi } from "./pypi";
import { raw } from "./raw";
import type { FormatSpec, SnippetContext } from "./types";

export const formats: Record<FormatName, FormatSpec> = { raw, pypi, apt, maven };

/** Formats in the order of the roadmap: raw → pypi → apt → maven. */
export const formatOrder: FormatName[] = ["raw", "pypi", "apt", "maven"];

export function formatSpec(name: string): FormatSpec {
  if (name === "oci") return oci;
  return formats[name as FormatName] ?? raw;
}

export function isFormat(name: string): name is FormatName {
  return name in formats;
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

export type { FormatSpec, Snippet, SnippetContext, SnippetGroup, MetadataRow } from "./types";
