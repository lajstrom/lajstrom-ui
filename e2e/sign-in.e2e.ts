// Signs in through the form, as a person does, and keeps the session for the screens.

import { expect, password, session, test, user } from "./test";

test("signs in with a password", async ({ page }) => {
  expect(user && password, "LAJSTROM_E2E_USER and LAJSTROM_E2E_PASSWORD (e2e/server.sh writes them)").toBeTruthy();
  await page.goto("sign-in");
  await page.getByLabel("User name").fill(user);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: user })).toBeVisible();
  await page.context().storageState({ path: session });
});
