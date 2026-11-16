import { describe, expect, it } from "vitest";

import specText from "../../public/openapi.yaml?raw";
import { generate } from "../../scripts/openapi-types.ts";
import generated from "./openapi.gen.ts?raw";

describe("src/api/openapi.gen.ts", () => {
  it("is what npm run gen:api makes of public/openapi.yaml", () => {
    expect(generated).toBe(generate(specText));
  });

  it("refuses a schema it cannot type rather than guessing", () => {
    const header = "# Vendored from lajstrom/lajstrom@" + "0".repeat(40) + ", internal/api/openapi.yaml.\n";
    expect(() => generate(header + "components: {schemas: {A: {$ref: 'other.yaml#/A'}}}")).toThrow(/unsupported \$ref/);
    expect(() => generate(header + "components: {schemas: {A: {type: file}}}")).toThrow(/unsupported type/);
    expect(() => generate("components: {}")).toThrow(/lajstrom\/lajstrom@<commit>/);
  });

  it("types nullable unions, enums with null and intersections", () => {
    const header = "# Vendored from lajstrom/lajstrom@" + "0".repeat(40) + ", internal/api/openapi.yaml.\n";
    const out = generate(
      header +
        `components:
  schemas:
    A:
      type: object
      required: [a]
      properties:
        a: {type: [string, "null"]}
        b: {type: [string, "null"], enum: [x, y, null]}
        c: {type: array, items: {anyOf: [{type: string}, {type: integer}]}}
        "d.e": {type: object, additionalProperties: {type: string}}
        g: {type: object, required: [h], properties: {h: {type: integer}}, additionalProperties: {type: integer}}
    B:
      allOf:
        - $ref: "#/components/schemas/A"
        - {type: object, properties: {f: {type: boolean}}}
`,
    );
    expect(out).toContain("    a: string | null;\n");
    expect(out).toContain('    b?: "x" | "y" | null;\n');
    expect(out).toContain("    c?: (string | number)[];\n");
    expect(out).toContain('    "d.e"?: Record<string, string>;\n');
    expect(out).toContain("    g?: {\n      h: number;\n      [key: string]: number;\n    };\n");
    expect(out).toContain('  B: Schemas["A"] & {\n    f?: boolean;\n  };\n');
  });
});
