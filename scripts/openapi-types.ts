// TypeScript types from the schemas of public/openapi.yaml: the server's OpenAPI description
// with the UI's proposal merged in (scripts/openapi-merge.ts). It covers what those use: objects,
// arrays, enums, $ref, allOf, anyOf, oneOf and type lists with "null". Anything else fails
// loudly, so a new construct is noticed when the server's file is vendored again. Written here rather than taken from openapi-typescript, which wants
// TypeScript 5 (ADR 0002: few dependencies).

import { parse } from "yaml";

type Schema = {
  $ref?: string;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  description?: string;
};

type Spec = { components?: { schemas?: Record<string, Schema> } };

const WIDTH = 100;

/** The source of src/api/openapi.gen.ts for the text of public/openapi.yaml. */
export function generate(specText: string): string {
  const commit = /^#[^\n]*\blajstrom\/lajstrom@([0-9a-f]{40})\b/.exec(specText)?.[1];
  if (!commit) throw new Error("the spec lacks its first line, naming the server's commit as lajstrom/lajstrom@<commit>");
  const spec = parse(specText) as Spec;
  const entries = Object.entries(spec.components?.schemas ?? {}).map(
    ([name, s]) => `${doc(s.description, "  ")}  ${key(name)}: ${type(s, "  ")};`,
  );
  return [
    "// Generated from public/openapi.yaml by scripts/gen-api-types.ts. Do not edit: npm run gen:api.",
    "",
    "/** The commit of lajstrom/lajstrom whose /api/v1 these types describe. */",
    `export const serverApiCommit = "${commit}";`,
    "",
    "/**",
    " * components.schemas of the server's openapi.yaml with the UI's proposal; what the proposal adds",
    " * starts with \"Proposed:\". src/api/types.ts names them for the UI.",
    " */",
    "export type Schemas = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

function type(s: Schema, indent: string): string {
  if (s.$ref !== undefined) {
    const name = /^#\/components\/schemas\/(\w+)$/.exec(s.$ref)?.[1];
    if (!name) throw new Error(`unsupported $ref ${s.$ref}`);
    return `Schemas[${JSON.stringify(name)}]`;
  }
  if (s.allOf) return s.allOf.map((p) => group(type(p, indent))).join(" & ");
  const alternatives = s.anyOf ?? s.oneOf;
  if (alternatives) return alternatives.map((p) => group(type(p, indent))).join(" | ");
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (!types.length) return s.properties ? object(s, indent) : "unknown";
  return types.map((t) => single(t, s, indent)).join(" | ");
}

function single(t: string, s: Schema, indent: string): string {
  switch (t) {
    case "null":
      return "null";
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return `${group(type(s.items ?? {}, indent))}[]`;
    case "object":
      return object(s, indent);
    default:
      throw new Error(`unsupported type ${t}`);
  }
}

function object(s: Schema, indent: string): string {
  const props = Object.entries(s.properties ?? {});
  const extra = s.additionalProperties;
  if (!props.length) {
    if (extra === false) return "Record<string, never>";
    return extra === undefined || extra === true ? "Record<string, unknown>" : `Record<string, ${type(extra, indent)}>`;
  }
  if (typeof extra === "object") throw new Error("unsupported: properties together with an additionalProperties schema");
  const inner = indent + "  ";
  const required = new Set(s.required ?? []);
  const lines = props.map(
    ([name, p]) => `${doc(p.description, inner)}${inner}${key(name)}${required.has(name) ? "" : "?"}: ${type(p, inner)};`,
  );
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** Parentheses around a union or an intersection that becomes part of a bigger type. */
function group(t: string): string {
  let depth = 0;
  for (const c of t) {
    if ("{([<".includes(c)) depth++;
    else if ("})]>".includes(c)) depth--;
    else if (depth === 0 && (c === "|" || c === "&")) return `(${t})`;
  }
  return t;
}

function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

/** A JSDoc comment of the description, wrapped at WIDTH columns. */
function doc(text: string | undefined, indent: string): string {
  if (!text?.trim()) return "";
  const words = text.trim().replaceAll("*/", "*\\/").split(/\s+/);
  const single = `${indent}/** ${words.join(" ")} */`;
  if (single.length <= WIDTH) return single + "\n";
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && indent.length + 3 + line.length + 1 + word.length > WIDTH) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  lines.push(line);
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`).join("\n")}\n${indent} */\n`;
}
