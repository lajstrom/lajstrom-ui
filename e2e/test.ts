// What every end-to-end test shares: the admin of e2e/server.sh, the server's API as the test
// reads it, and a page that fails the test on an uncaught error or an answer of the API the UI
// does not expect.

import { readFileSync } from "node:fs";

import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { parse } from "yaml";

export { expect };

export const user = process.env.LAJSTROM_E2E_USER ?? "";
export const password = process.env.LAJSTROM_E2E_PASSWORD ?? "";

/**
 * Signs in through the form, as a person does. Each test signs in in its own browser context: the
 * token of a sign-in is bound to a DPoP key that the page keeps in IndexedDB, as a CryptoKey,
 * which a saved storageState cannot carry to another context.
 */
export async function signIn(page: Page): Promise<void> {
  expect(user && password, "LAJSTROM_E2E_USER and LAJSTROM_E2E_PASSWORD (e2e/server.sh writes them)").toBeTruthy();
  await page.goto("sign-in");
  await page.getByLabel("User name").fill(user);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: user })).toBeVisible();
}

type Spec = { paths: Record<string, Record<string, { "x-lajstrom-status"?: string }>> };

/** "GET" and a pattern of the path for each operation the UI proposes (public/openapi.yaml):
 * the server may not have them yet. */
const proposed = Object.entries((parse(readFileSync("public/openapi.yaml", "utf8")) as Spec).paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([, op]) => op["x-lajstrom-status"] === "proposed")
    .map(([method]) => ({ method: method.toUpperCase(), path: new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`) })),
);

/** An answer of the API that the UI handles as a state of the server: a proposed operation the
 * server does not have yet, or a resource that is not there yet. Any other path the server does
 * not know is a drift between the two. */
function expected(status: number, method: string, path: string, body: string): boolean {
  if (status !== 404) return false;
  // The server's answer to a path it does not know (notFound in internal/api/http.go).
  if (body.includes(" is not an endpoint of this version")) return proposed.some((op) => op.method === method && op.path.test(path));
  // No reindex run has covered the repo yet.
  return method === "GET" && /^\/api\/v1\/repos\/[^/]+\/[^/]+\/reindex$/.test(path);
}

export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      const reads: Promise<void>[] = [];
      page.on("pageerror", (err) => problems.push(`uncaught: ${err.message}`));
      page.on("response", (res) => {
        const url = new URL(res.url());
        if (!/^\/(api|-)\//.test(url.pathname) || res.status() < 400) return;
        const method = res.request().method();
        reads.push(
          res
            .text()
            .catch(() => "")
            .then((body) => {
              if (!expected(res.status(), method, url.pathname, body)) {
                problems.push(`${method} ${url.pathname}${url.search}: ${res.status()} ${body.slice(0, 300)}`);
              }
            }),
        );
      });
      await use(problems);
      await Promise.all(reads);
      expect(problems, "uncaught errors and answers of the API the UI does not expect").toEqual([]);
    },
    { auto: true },
  ],
});

/** GET of the API as the admin, which must answer 200. */
export async function api<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path, {
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` },
  });
  expect(res.status(), `GET ${path}`).toBe(200);
  return (await res.json()) as T;
}
