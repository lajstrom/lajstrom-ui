import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import specText from "../../public/openapi.yaml?raw";
import handlersSource from "./handlers.ts?raw";

type Operation = { "x-lajstrom-status"?: string; responses?: Record<string, unknown> };
type Spec = { paths: Record<string, Record<string, Operation>>; components: Record<string, Record<string, unknown>> };

const spec = parse(specText) as Spec;
const METHODS = ["get", "post", "put", "patch", "delete"];

/** "get /api/v1/repos/{format}/{repo}" for every operation of the spec. */
const specOps = new Set(
  Object.entries(spec.paths).flatMap(([path, item]) => Object.keys(item).filter((m) => METHODS.includes(m)).map((m) => `${m} ${path}`)),
);

/** The same for the routes of the mock, from its source: get("*\/api/v1/repos/:format/:repo", …). */
const mockOps = new Set(
  [...handlersSource.matchAll(/^\s+(get|post|put|patch|del)\("\*([^"]+)"/gm)]
    .filter(([, , path]) => !path!.endsWith("/*"))
    .map(([, method, path]) => `${method === "del" ? "delete" : method} ${path!.replace(/:([a-zA-Z]+)/g, "{$1}")}`),
);

describe("public/openapi.yaml against the mock", () => {
  it("documents every route the mock answers", () => {
    expect([...mockOps].filter((op) => !specOps.has(op))).toEqual([]);
  });

  it("has a mock answer for every operation, so that Try it out works in the demo", () => {
    expect([...specOps].filter((op) => !mockOps.has(op))).toEqual([]);
  });

  it("resolves every $ref", () => {
    const refs = [...specText.matchAll(/\$ref: "#\/components\/([a-zA-Z]+)\/([a-zA-Z]+)"/g)];
    expect(refs.length).toBeGreaterThan(20);
    const missing = refs.filter(([, kind, name]) => !(name! in (spec.components[kind!] ?? {}))).map(([ref]) => ref);
    expect(missing).toEqual([]);
  });

  it("gives every operation at least one response", () => {
    const empty = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([m, op]) => METHODS.includes(m) && !Object.keys(op.responses ?? {}).length)
        .map(([m]) => `${m} ${path}`),
    );
    expect(empty).toEqual([]);
  });

  it("names no ticket numbers", () => {
    expect(specText).not.toMatch(/(^|[^&\w])#\d+\b|\b[MP]\d?-\d{2}\b/m);
  });
});
