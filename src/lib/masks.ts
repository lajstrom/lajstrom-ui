// Repo masks of bindings and deploy tokens (docs/spec/rbac.md §3): <format>/<repo>, each segment
// a name or * for any, never a part of one.

/** The two segments of a mask, or null when it is not two non-empty segments. */
export function parseMask(mask: string): [string, string] | null {
  const parts = mask.split("/");
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

/** Whether the mask matches the repo `<format>/<name>`: each segment * or the repo's. */
export function maskMatches(mask: string, repo: string): boolean {
  const m = parseMask(mask);
  const r = parseMask(repo);
  return m !== null && r !== null && (m[0] === "*" || m[0] === r[0]) && (m[1] === "*" || m[1] === r[1]);
}

/** Masks to offer for these repos, the widest first: every repo, each format, each name across
 * formats, then each repo. */
export function maskSuggestions(repos: string[]): string[] {
  const parsed = repos.map(parseMask).filter((r): r is [string, string] => r !== null);
  const formats = [...new Set(parsed.map(([f]) => f))].sort();
  const names = [...new Set(parsed.map(([, n]) => n))].sort();
  return ["*/*", ...formats.map((f) => `${f}/*`), ...names.map((n) => `*/${n}`), ...[...repos].sort()];
}
