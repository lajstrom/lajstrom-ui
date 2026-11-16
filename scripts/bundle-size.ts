// node scripts/bundle-size.ts [dir of the build, dist/ui]: fails when the main chunk, gzipped, is
// larger than LIMIT_KIB. npm run check runs it after the build, so CI does on every pull request.
//
// The main chunk is the JavaScript every visit loads before its first page: the module script of
// index.html and the chunks index.html preloads for it, its static imports. Each page is a chunk
// of its own (src/app/router.tsx), the demo's mock is loaded in the demo only (src/main.tsx) and
// Swagger UI on the API page only (src/pages/api-docs.tsx); a static import of any of them would
// put it back here. Raising the limit is a decision of the pull request that does it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const LIMIT_KIB = 195;

const dir = process.argv[2] ?? "dist/ui";
const html = readFileSync(join(dir, "index.html"), "utf8");
const srcs = [
  ...[...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]!),
  ...[...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]!),
];
if (srcs.length === 0) {
  console.error(`bundle-size: no module script in ${join(dir, "index.html")}`);
  process.exit(2);
}

const kib = (n: number) => `${(n / 1024).toFixed(1)} KiB`;
let total = 0;
for (const src of srcs) {
  // ./assets/x.js in a build with relative paths, /lajstrom-ui/assets/x.js below a base.
  const file = src.slice(src.lastIndexOf("assets/"));
  const size = gzipSync(readFileSync(join(dir, file))).length;
  total += size;
  console.log(`${kib(size).padStart(10)}  ${file}`);
}
console.log(`${kib(total).padStart(10)}  the main chunk, gzipped; the limit is ${LIMIT_KIB} KiB`);
if (total > LIMIT_KIB * 1024) {
  console.error(`bundle-size: the main chunk is ${kib(total)} gzipped, more than ${LIMIT_KIB} KiB (scripts/bundle-size.ts)`);
  process.exit(1);
}
