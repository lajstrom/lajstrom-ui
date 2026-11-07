import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The UI is served below /ui/ (docs/spec/http-routing.md reserves the segment), both by the
// dev server and by the nginx image. Without the mock, the dev server forwards the API to a
// running Lajstrom: LAJSTROM_API_UPSTREAM=http://localhost:8080 npm run dev.
const apiUpstream = process.env.LAJSTROM_API_UPSTREAM ?? "http://localhost:8080";

export default defineConfig({
  base: "/ui/",
  plugins: [react(), tailwindcss()],
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
