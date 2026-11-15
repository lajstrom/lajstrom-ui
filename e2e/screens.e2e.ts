// Every screen of the UI against a real server, as the admin that e2e/server.sh made: the
// repositories, a package and a version of each, tokens, the audit log, access, the proposed
// screens and the API page. A test fails on an uncaught error, an answer of the API the UI does
// not expect (e2e/test.ts) or a page that stays empty.

import type { Page } from "@playwright/test";

import type { Schemas } from "../src/api/openapi.gen";
import { api, expect, test, user } from "./test";

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

      await page.getByRole("link", { name: pkg.name, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/${r.format}/${r.name}/.+`));
      await shown(page);
      const { versions } = await api<Schemas["VersionList"]>(request, `${path}/${segment(pkg.name)}/versions`);
      const newest = versions[0];
      expect(newest, `a version of ${pkg.name}`).toBeDefined();

      await page.getByRole("link", { name: newest!.version, exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/-/${newest!.version.replace(/[.+]/g, "\\$&")}`));
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

test("the screens of proposed endpoints say the server lacks them", async ({ page }) => {
  for (const path of ["registries", "search?q=hello"]) {
    await test.step(path, async () => {
      await page.goto(path);
      await shown(page);
      await expect(page.getByText("Not in this server version yet")).toBeVisible();
    });
  }
});

test("the API page shows the server's own description", async ({ page }) => {
  await page.goto("api-docs");
  await shown(page, "API");
  await expect(page.getByText("Lajstrom management API").first()).toBeVisible();
});
