import type { Repo, RepoFormat } from "@/api/types";

/** What snippets need to know about where and how the client talks to Lajstrom. */
export type SnippetContext = {
  /** server.externalURL without a trailing slash, e.g. https://art.example.com */
  baseUrl: string;
  /** host[:port] of baseUrl, for OCI references. */
  host: string;
  repo: Repo;
  /** False when the repo is readable anonymously: read snippets then need no credentials. */
  readNeedsAuth: boolean;
  /** Filter values of the repo (deb.suite, deb.component, …), when the page has loaded them. */
  facets?: Record<string, { value: string }[]>;
};

export type Snippet = {
  id: string;
  /** Tab title: "pip", "uv", "pip.conf", "Upload with twine". */
  title: string;
  /** Caption above the code: a file name or "shell". */
  caption?: string;
  code: string;
  shell?: boolean;
  /** One sentence under the code. */
  note?: string;
};

export type SnippetGroup = { title: string; description?: string; snippets: Snippet[] };

/** A package as the snippets need it: its name, and what the proposed package facts add. */
export type InstallPackage = { name: string; latestVersion?: string | null; attrs?: Record<string, string> };

/** One manifest of a version: its tag, digest, lajstrom.* attributes by their full key, and its
 * metadata layer. */
export type InstallVersion = {
  version: string;
  tag: string;
  digest: string;
  attrs?: Record<string, string>;
  metadata?: Record<string, unknown> | null;
};

export type MetadataRow = { label: string; value: string | string[]; mono?: boolean; href?: string };

export type FormatSpec = {
  name: RepoFormat;
  /** Display name of the format: "PyPI", "APT", "Maven", "Raw". */
  label: string;
  /** Short mark for the format badge. */
  mark: string;
  /** Tailwind classes for the format mark: background and text. */
  markClass: string;
  /** What a package is called in this format. */
  noun: { one: string; many: string };
  /** Name of the variant dimension, or null for formats without variants. */
  variantLabel: string | null;
  artifactType: string;
  /** Attribute keys offered as filters on the repo page, with labels. */
  facets: { key: string; label: string }[];
  /** Extra columns of the package table: attribute key → header. */
  columns: { key: string; label: string }[];
  /** How to configure a client for the whole repo. */
  connect(ctx: SnippetContext): SnippetGroup[];
  /** How to install or fetch one package, optionally one version of it. */
  install(ctx: SnippetContext, pkg: InstallPackage, version?: InstallVersion): Snippet[];
  /** The path below externalURL a client downloads a file of a manifest from (http-routing.md
   * §3); null for a format without one. `files` are the manifest's file layers, in order. */
  filePath(repo: string, pkg: string, version: InstallVersion & { files: { digest: string }[] }, file: string): string | null;
  /** Human name of a file layer: "Wheel", "Sources jar", "Debian package". */
  fileRole(mediaType: string, attrs: Record<string, string>): string;
  /** The interesting fields of the metadata layer, in reading order. */
  metadataRows(metadata: Record<string, unknown> | null): MetadataRow[];
};
