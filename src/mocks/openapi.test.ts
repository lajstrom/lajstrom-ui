import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import proposedText from "../../openapi/proposed.yaml?raw";
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

/** The same for the routes of the mock, from its source: get("*\/api/v1/repos/:format/:repo", …);
 * an escaped colon, written "\\:" in the source, is the colon of a custom method (versions:delete). */
const mockOps = new Set(
  [...handlersSource.matchAll(/^\s+(get|post|put|patch|del)\("\*([^"]+)"/gm)]
    .filter(([, , path]) => !path!.endsWith("/*"))
    .map(([, method, path]) => `${method === "del" ? "delete" : method} ${path!.replace(/(?<!\\):([a-zA-Z]+)/g, "{$1}").replaceAll("\\\\:", ":")}`),
);

/** The server's operations the mock does not answer yet: "Try it out" gets the 404 the server
 * answers to a path it does not know. The UI does none of them yet. */
const notMocked = new Set([
  "get /api/v1/openapi.yaml",
  // Policy rules, verdicts and the denylist (lajstrom/lajstrom#101): no screen yet.
  "get /api/v1/policy/rules",
  "post /api/v1/policy/rules",
  "delete /api/v1/policy/rules/{id}",
  "get /api/v1/policy/verdicts",
  "get /api/v1/policy/key",
  "get /api/v1/policy/denylist",
  "post /api/v1/repos/{format}/{repo}/packages/{name}/versions/{version}/deny",
  "delete /api/v1/repos/{format}/{repo}/packages/{name}/versions/{version}/deny",
  // The lockout of local passwords (rbac.md §1): no screen yet.
  "post /api/v1/users/{user}/unlock",
  // CI trust policies (lajstrom/lajstrom#937, #74): no screen yet.
  "get /api/v1/ci/policies",
  "post /api/v1/ci/policies",
  "get /api/v1/ci/policies/{name}",
  "put /api/v1/ci/policies/{name}",
  "delete /api/v1/ci/policies/{name}",
  "post /api/v1/ci/policies/{name}/renew",
  "post /api/v1/ci/policies/{name}/approve",
]);

describe("public/openapi.yaml against the mock", () => {
  it("documents every route the mock answers", () => {
    expect([...mockOps].filter((op) => !specOps.has(op))).toEqual([]);
  });

  it("has a mock answer for every operation but those listed, so that Try it out works in the demo", () => {
    expect([...specOps].filter((op) => !mockOps.has(op) && !notMocked.has(op))).toEqual([]);
    expect([...notMocked].filter((op) => mockOps.has(op) || !specOps.has(op))).toEqual([]);
  });

  it("has a mock answer for every proposed operation", () => {
    const proposed = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([m, op]) => METHODS.includes(m) && op["x-lajstrom-status"] === "proposed")
        .map(([m]) => `${m} ${path}`),
    );
    expect(proposed.filter((op) => !mockOps.has(op))).toEqual([]);
    // The merge marks what the proposal adds, an operation or a field.
    expect(specText).toContain("x-lajstrom-status: proposed");
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

  // The proposal's text names lajstrom/lajstrom#…, never a bare number; the server's own text is
  // the server's.
  it("names no bare ticket numbers in the proposal", () => {
    expect(proposedText).not.toMatch(/(^|[^&\w/])#\d+\b|\b[MP]\d?-\d{2}\b/m);
  });
});
