// npm run gen:api: writes src/api/server.gen.ts from openapi/server.yaml.

import { readFileSync, writeFileSync } from "node:fs";

import { generate } from "./openapi-types.ts";

const root = new URL("../", import.meta.url);
writeFileSync(new URL("src/api/server.gen.ts", root), generate(readFileSync(new URL("openapi/server.yaml", root), "utf8")));
