// Every screen of the UI against a real server, as the admin that e2e/server.sh made: the
// repositories, a package and a version of each, tokens, the audit log, access and its CI trust
// policies, the registries, search and the API page. A test fails on an uncaught error, an answer of the API the UI does
// not expect (e2e/test.ts) or a page that stays empty.

import type { Page } from "@playwright/test";

import type { Schemas } from "../src/api/openapi.gen";
import { api, expect, signIn, test, user } from "./test";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

/** The page has its title and has stopped loading: no skeleton is left. */
async function shown(page: Page, title?: string | RegExp) {
  // The page's own title; the API page has Swagger's below it.
  const h1 = page.getByRole("heading", { level: 1 }).first();
  await expect(h1).not.toBeEmpty();
  if (title !== undefined) await expect(h1).toContainText(title);
  await expect(page.locator("main .animate-pulse")).toHaveCount(0);
}

const segment = encodeURIComponent;

test("the repository list names every repo", async ({ page, request }) => {
  const { repos } = await api<Schemas["RepoList"]>(request, "/api/v1/repos");
  expect(repos.length).toBeGreaterThanOrEqual(6);
  await page.goto("./");
  for (const r of repos) await expect(page.getByRole("link", { name: `${r.format}/${r.name}`, exact: true })).toBeVisible();
});

test("each repo, its first package and that package's newest version", async ({ page, request }) => {
  const { repos } = await api<Schemas["RepoList"]>(request, "/api/v1/repos");
  for (const r of repos) {
    await test.step(`${r.format}/${r.name}`, async () => {
      await page.goto(`${r.format}/${r.name}`);
      await shown(page, r.name);
      const path = `/api/v1/repos/${segment(r.format)}/${segment(r.name)}/packages`;
      const { packages } = await api<Schemas["PackageList"]>(request, path);
      const pkg = packages[0];
      if (!pkg) return;

      // A raw repo shows its files a directory at a time, each by its name in the directory.
      const slash = r.format === "raw" ? pkg.name.lastIndexOf("/") + 1 : 0;
      if (slash > 0) {
        await page.goto(`${r.format}/${r.name}?dir=${pkg.name.slice(0, slash)}`);
        await shown(page, r.name);
      }
      await page.getByRole("link", { name: pkg.name.slice(slash), exact: true }).first().click();
      await expect(page).toHaveURL((url) => url.pathname.startsWith(`/ui/${r.format}/${r.name}/`));
      await shown(page);
      const { versions } = await api<Schemas["VersionList"]>(request, `${path}/${segment(pkg.name)}/versions`);
      const newest = versions[0];
      expect(newest, `a version of ${pkg.name}`).toBeDefined();

      await page.getByRole("link", { name: newest!.version, exact: true }).first().click();
      await expect(page).toHaveURL((url) => decodeURIComponent(url.pathname).endsWith(`/-/${newest!.version}`));
      await shown(page, newest!.version);
    });
  }
});

test("personal access tokens", async ({ page }) => {
  await page.goto("tokens");
  await shown(page, "Personal access tokens");
  await expect(page.getByText("e2e npm publish").first()).toBeVisible();
});

test("the audit log", async ({ page }) => {
  await page.goto("audit");
  await shown(page);
  await expect(page.getByRole("cell", { name: "push", exact: true }).first()).toBeVisible();
});

test("access: users and role bindings", async ({ page }) => {
  await page.goto("access");
  await shown(page);
  await expect(page.getByText(user).first()).toBeVisible();
});

test("access: CI trust policies, the configuration's, and one that reads made and deleted", async ({ page }) => {
  await page.goto("access?tab=ci");
  await shown(page);
  await expect(page.getByRole("button", { name: "e2e-config-read", exact: true })).toBeVisible();
  // A policy that reads takes no step: the server takes it at once, with its revision.
  await page.getByRole("button", { name: "New policy" }).click();
  await page.getByLabel("Name").fill("e2e-read");
  await page.getByLabel("Values of repository_id").fill("42");
  await page.getByLabel("Mask 1").fill("raw/files");
  await page.getByRole("button", { name: "Create policy" }).click();
  const panel = page.getByRole("region", { name: "Policy e2e-read" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "e2e-read", exact: true })).toHaveCount(0);
});

test("a user's page: its bindings and its tokens", async ({ page }) => {
  await page.goto(`access/users/${segment(user)}`);
  await shown(page, user);
  await expect(page.getByRole("cell", { name: "admin", exact: true }).first()).toBeVisible();
  await expect(page.getByText("e2e npm publish").first()).toBeVisible();
});

test("the registries, with what the probe found", async ({ page, request }) => {
  const { registries } = await api<Schemas["RegistryList"]>(request, "/api/v1/registries");
  await page.goto("registries");
  await shown(page, "Registries");
  for (const r of registries) await expect(page.getByText(r.name, { exact: true }).first()).toBeVisible();
});

test("search finds the packages of every format by name", async ({ page }) => {
  await page.goto("search?q=hello");
  await shown(page, "Search");
  await expect(page.getByText("hello-e2e", { exact: true }).first()).toBeVisible();
});

test("the API page shows the server's own description", async ({ page }) => {
  await page.goto("api-docs");
  await shown(page, "API");
  await expect(page.getByText("Lajstrom management API").first()).toBeVisible();
});
