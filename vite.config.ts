import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

import { buildInfo } from "./scripts/build-info.ts";

// The UI is served below /ui/ (docs/spec/http-routing.md reserves the segment), both by the
// dev server and by the nginx image; a build runs below any path (lajstromBuild). Without the mock, the dev server forwards the API to a
// running Lajstrom:
//
//   LAJSTROM_UI_MOCK=false LAJSTROM_API_UPSTREAM=http://localhost:8080 npm run dev
const apiUpstream = process.env.LAJSTROM_API_UPSTREAM ?? "http://localhost:8080";

// LAJSTROM_UI_MOCK and LAJSTROM_UI_DEMO override "mock" and "demo" of public/config.json on the
// dev server, the way the variables of the same names do in the image, so switching to a real
// server needs no edit.
function devConfigOverride(): Plugin {
  const flag = (name: string): boolean | undefined => {
    const v = process.env[name];
    if (v === undefined) return undefined;
    if (v !== "true" && v !== "false") throw new Error(`${name} must be true or false, not '${v}'`);
    return v === "true";
  };
  return {
    name: "lajstrom-dev-config",
    apply: "serve",
    configureServer(server) {
      const mock = flag("LAJSTROM_UI_MOCK");
      const demo = flag("LAJSTROM_UI_DEMO");
      if (mock === undefined && demo === undefined) return;
      server.middlewares.use("/ui/config.json", (_req, res) => {
        const file = JSON.parse(readFileSync(new URL("./public/config.json", import.meta.url), "utf8")) as Record<string, unknown>;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify({ ...file, ...(mock === undefined ? {} : { mock }), ...(demo === undefined ? {} : { demo }) }));
      });
    },
  };
}

// What this build is and the server API it was built for (scripts/build-info.ts): defined for the
// app as __LAJSTROM_UI_BUILD__ (src/app/build.ts) and written next to index.html as build.json.
//
// A build has relative asset paths, so that one bundle serves at the root of a static origin and
// below /ui/ (src/app/base.ts). index.html gets <base href="/">: a host that answers a deep link
// such as /apt/ubuntu-internal with index.html then still loads ./assets from the root. Below
// another path the host sets that one tag; the image's nginx makes it /ui/ (docker/nginx.conf).
function lajstromBuild(): Plugin {
  const info = buildInfo(new URL("./", import.meta.url));
  let relative = false;
  return {
    name: "lajstrom-build",
    config: () => ({ define: { __LAJSTROM_UI_BUILD__: JSON.stringify(info) } }),
    configResolved(config) {
      relative = config.command === "build" && (config.base === "./" || config.base === "");
    },
    transformIndexHtml: () => (relative ? [{ tag: "base", attrs: { href: "/" }, injectTo: "head-prepend" }] : []),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build.json", source: `${JSON.stringify(info, null, 2)}\n` });
    },
  };
}

export default defineConfig(({ command }) => ({
  // The dev server serves below /ui/, as the image does.
  base: command === "build" ? "./" : "/ui/",
  plugins: [devConfigOverride(), lajstromBuild(), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    // With --host, other devices on the network may also use the Bonjour name of this machine
    // (http://<LocalHostName>.local:5173/ui/); Vite answers only localhost and IPs otherwise.
    allowedHosts: [".local"],
    proxy: {
      "/api": { target: apiUpstream, changeOrigin: true },
      "/-": { target: apiUpstream, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    sourcemap: true,
    // The largest chunk is Swagger UI (about 1.5 MB minified), loaded by the API page only. The
    // main chunk has a limit of its own, gzipped: scripts/bundle-size.ts, run by npm run check.
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
}));
