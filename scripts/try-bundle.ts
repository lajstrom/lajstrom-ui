// node scripts/try-bundle.ts <url of the bundle> [...]: opens a served bundle in Chromium and
// fails unless the UI starts there. It follows a deep link, which the host answers with
// index.html, so the bundle has to find its files from there; signs in to the demo; and checks
// that the link's page shows, that the about dialog names the server API of the build, and that
// the API page loads its own chunk, its styles and the demo's openapi.yaml.
//
// The release workflow runs it on the tar.gz at the root of a static origin and below /ui/ of the
// image, both with "mock": true in config.json, so no server is needed. LAJSTROM_E2E_CHANNEL=chrome
// takes the installed Chrome instead of Playwright's Chromium.

import { chromium, expect } from "@playwright/test";

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error("usage: node scripts/try-bundle.ts <url of the bundle, such as http://localhost:8080/ui/> [...]");
  process.exit(2);
}

const browser = await chromium.launch({ channel: process.env.LAJSTROM_E2E_CHANNEL || undefined });
let failed = 0;
for (const url of urls) {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400) problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
  });
  try {
    const deep = new URL("apt/ubuntu-internal", url);
    await page.goto(deep.href);
    // The demo starts signed out, at its sign-in page, and goes on to the link afterwards.
    await page.getByLabel("User name").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill("admin");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(deep.href, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "ubuntu-internal" })).toBeVisible({ timeout: 15_000 });
    // The router's base is the bundle's directory, not a guess from the address.
    await expect(page.getByRole("banner").getByRole("link", { name: "Repositories" })).toHaveAttribute("href", new URL(url).pathname);
    await page.getByRole("button", { name: "About" }).click();
    await expect(page.getByRole("dialog").getByText(/\/api\/v\d+ of Lajstrom/)).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("banner").getByRole("link", { name: "API" }).click();
    await expect(page.locator(".swagger-ui .info .title")).toContainText("Lajstrom management API", { timeout: 20_000 });
    if (problems.length > 0) throw new Error(problems.join("\n"));
    console.log(`ok    ${url}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${url}\n${err instanceof Error ? err.message : String(err)}`);
    if (problems.length > 0) console.error(problems.join("\n"));
  } finally {
    await page.close();
  }
}
await browser.close();
process.exit(failed > 0 ? 1 : 0);
