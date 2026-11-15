// npm run gen:api: writes src/api/server.gen.ts from openapi/server.yaml, and public/openapi.yaml
// from it and openapi/proposed.yaml.

import { readFileSync, writeFileSync } from "node:fs";

import { mergeSpec } from "./openapi-merge.ts";
import { generate } from "./openapi-types.ts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const server = read("openapi/server.yaml");
writeFileSync(new URL("src/api/server.gen.ts", root), generate(server));
writeFileSync(new URL("public/openapi.yaml", root), mergeSpec(server, read("openapi/proposed.yaml")));
