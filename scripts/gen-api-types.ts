// npm run gen:api: writes public/openapi.yaml from openapi/server.yaml and openapi/proposed.yaml,
// and src/api/openapi.gen.ts from it.

import { readFileSync, writeFileSync } from "node:fs";

import { mergeSpec } from "./openapi-merge.ts";
import { generate } from "./openapi-types.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const spec = mergeSpec(read("openapi/server.yaml"), read("openapi/proposed.yaml"));
writeFileSync(new URL("public/openapi.yaml", root), spec);
writeFileSync(new URL("src/api/openapi.gen.ts", root), generate(spec));
