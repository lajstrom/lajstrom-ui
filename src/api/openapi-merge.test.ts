import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import merged from "../../public/openapi.yaml?raw";
import proposedText from "../../openapi/proposed.yaml?raw";
import serverText from "../../openapi/server.yaml?raw";
import { mergeSpec } from "../../scripts/openapi-merge.ts";

const header = "# Vendored from lajstrom/lajstrom@" + "0".repeat(40) + ", internal/api/openapi.yaml.\n";
const server = `${header}paths:
  /a:
    get:
      summary: A.
      description: The server's.
      parameters:
        - {name: limit, in: query, schema: {type: integer}}
components:
  schemas:
    A:
      type: object
      properties:
        x: {type: string}
`;

type Spec = {
  paths: Record<string, Record<string, Record<string, unknown> & { parameters?: Record<string, unknown>[] }>>;
  components: { schemas: Record<string, { description?: string; properties?: Record<string, Record<string, unknown>> }> };
};

describe("public/openapi.yaml", () => {
  it("is what npm run gen:api makes of openapi/server.yaml and openapi/proposed.yaml", () => {
    expect(merged).toBe(mergeSpec(serverText, proposedText));
  });

  it("marks what the proposal adds", () => {
    const spec = parse(
      mergeSpec(
        server,
        `paths:
  /a:
    get:
      description: The UI's.
      parameters:
        - {name: sort, in: query, schema: {type: string}}
  /b:
    get: {summary: B., responses: {"200": {description: B}}}
components:
  schemas:
    A:
      properties:
        y: {type: string, description: Y.}
    B: {type: object}
`,
      ),
    ) as Spec;
    expect(spec.paths["/a"]!.get!.summary).toBe("A.");
    expect(spec.paths["/a"]!.get!.description).toBe("The server's.\n\nThe UI's.");
    expect(spec.paths["/a"]!.get!.parameters).toEqual([
      { name: "limit", in: "query", schema: { type: "integer" } },
      { name: "sort", in: "query", schema: { type: "string" }, description: "Proposed.", "x-lajstrom-status": "proposed" },
    ]);
    expect(spec.paths["/b"]!.get).toMatchObject({ summary: "Proposed: B.", "x-lajstrom-status": "proposed" });
    expect(spec.components.schemas.A!.properties).toEqual({
      x: { type: "string" },
      y: { type: "string", description: "Proposed: Y.", "x-lajstrom-status": "proposed" },
    });
    expect(spec.components.schemas.B).toEqual({ type: "object", description: "Proposed.", "x-lajstrom-status": "proposed" });
  });

  it("stops at what the server has already", () => {
    expect(() => mergeSpec(server, "components: {schemas: {A: {properties: {x: {type: string}}}}}")).toThrow(
      /the server has components schemas A properties x type now/,
    );
    expect(() => mergeSpec(server, "paths: {/a: {get: {summary: Other.}}}")).toThrow(/paths \/a get summary/);
    expect(() => mergeSpec(server, "paths: {/a: {get: {parameters: [{name: limit, in: query}]}}}")).toThrow(
      /parameters limit now/,
    );
    expect(() => mergeSpec("paths: {}", "paths: {}")).toThrow(/Vendored from/);
  });

  it("refuses a description that a comma cut short", () => {
    expect(() => mergeSpec(server, "components: {schemas: {B: {type: string, description: One, two.}}}")).toThrow(
      /components schemas B "two\." has no value/,
    );
  });
});
