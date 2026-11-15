// public/openapi.yaml: the server's OpenAPI description (openapi/server.yaml) with what the UI
// proposes (openapi/proposed.yaml) merged in. The proposal only adds. What it adds is marked
// x-lajstrom-status: proposed and its summary or description starts with "Proposed:". A value
// the server has already stops the merge: the server answers it now, so it leaves the proposal.
// Descriptions are the exception; the proposal's text is appended to the server's.

import { parse, stringify } from "yaml";

type Node = Record<string, unknown>;

const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];

/** The text of public/openapi.yaml for the texts of openapi/server.yaml and openapi/proposed.yaml. */
export function mergeSpec(serverText: string, proposedText: string): string {
  const commit = /^# Vendored from lajstrom\/lajstrom@([0-9a-f]{40})\b/.exec(serverText)?.[1];
  if (!commit) throw new Error("openapi/server.yaml lacks its first line, # Vendored from lajstrom/lajstrom@<commit>");
  const merged = merge(parse(serverText) as unknown, parse(proposedText) as unknown, []);
  return [
    `# Generated from openapi/server.yaml, lajstrom/lajstrom@${commit}, and openapi/proposed.yaml.`,
    "# Do not edit: npm run gen:api.",
    stringify(merged, { lineWidth: 100, aliasDuplicateObjects: false }),
  ].join("\n");
}

function merge(server: unknown, proposed: unknown, path: string[]): unknown {
  if (server === undefined) return mark(proposed, path);
  if (isNode(server) && isNode(proposed)) {
    const out: Node = { ...server };
    for (const [key, value] of Object.entries(proposed)) out[key] = merge(server[key], value, [...path, key]);
    return out;
  }
  if (Array.isArray(server) && Array.isArray(proposed)) {
    const out = [...(server as unknown[])];
    for (const item of proposed as unknown[]) {
      const same = (server as unknown[]).find((s) => sameItem(s, item));
      if (same !== undefined) throw new Error(`the server has ${where(path)} ${label(item)} now: take it out of openapi/proposed.yaml`);
      out.push(path.at(-1) === "parameters" ? markParameter(item) : item);
    }
    return out;
  }
  if (path.at(-1) === "description" && typeof server === "string" && typeof proposed === "string") {
    return `${server.trimEnd()}\n\n${proposed.trim()}`;
  }
  throw new Error(`the server has ${where(path)} now: take it out of openapi/proposed.yaml`);
}

/** Marks what the proposal adds where the server has nothing: an operation, a schema, a
 * property; a path item's operations. */
function mark(value: unknown, path: string[]): unknown {
  if (!isNode(value)) return value;
  const [root, , last] = path;
  if (root === "paths" && path.length === 2) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, METHODS.includes(k) ? markOperation(v) : v]));
  }
  if (root === "paths" && path.length === 3 && METHODS.includes(last!)) return markOperation(value);
  if ((root === "components" && path[1] === "schemas" && path.length === 3) || path.at(-2) === "properties") {
    return { ...value, description: proposedText(value.description), "x-lajstrom-status": "proposed" };
  }
  return value;
}

function markOperation(op: unknown): unknown {
  if (!isNode(op)) return op;
  return { ...op, summary: proposedText(op.summary), "x-lajstrom-status": "proposed" };
}

function markParameter(p: unknown): unknown {
  if (!isNode(p) || "$ref" in p) return p;
  return { ...p, description: proposedText(p.description), "x-lajstrom-status": "proposed" };
}

function proposedText(text: unknown): string {
  return typeof text === "string" && text.trim() ? `Proposed: ${text.trim()}` : "Proposed.";
}

/** A parameter or a tag is the same by its name (and place); anything else by its value. */
function sameItem(a: unknown, b: unknown): boolean {
  if (isNode(a) && isNode(b) && typeof b.name === "string") return a.name === b.name && a.in === b.in;
  return JSON.stringify(a) === JSON.stringify(b);
}

function label(item: unknown): string {
  return isNode(item) && typeof item.name === "string" ? item.name : JSON.stringify(item);
}

function where(path: string[]): string {
  return path.join(" ");
}

function isNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
