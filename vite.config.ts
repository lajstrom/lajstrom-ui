import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// The UI is served below /ui/ (docs/spec/http-routing.md reserves the segment), both by the
// dev server and by the nginx image. Without the mock, the dev server forwards the API to a
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

export default defineConfig({
  base: "/ui/",
  plugins: [devConfigOverride(), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiUpstream, changeOrigin: true },
      "/-": { target: apiUpstream, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
