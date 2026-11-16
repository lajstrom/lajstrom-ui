// The end-to-end test of the UI against a real server: npm run e2e. e2e/README.md says how to
// start the server and the UI image it runs against.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]] : "list",
  outputDir: "e2e-results",
  use: {
    // The UI image, with LAJSTROM_API_UPSTREAM pointing at the server.
    baseURL: process.env.LAJSTROM_E2E_UI ?? "http://localhost:8080/ui/",
    // chrome takes the Chrome installed on the machine instead of Playwright's own Chromium.
    channel: process.env.LAJSTROM_E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "sign-in", testMatch: "sign-in.e2e.ts" },
    { name: "screens", testMatch: "screens.e2e.ts", dependencies: ["sign-in"] },
  ],
});
